# React 流式聊天

应用管理传输和消息状态，渲染器接收完整累积文本。把网络片段直接逐个交给不同组件，会破坏跨片段的公式、围栏和引用语法。

## 接入步骤

1. 为每次请求创建 AbortController，并为消息保留稳定身份。
2. 使用流式 TextDecoder 解码字节，保留尚未完成的 UTF-8 字符。
3. 根据服务端协议缓冲与解析 SSE 事件；网络读取边界不等于事件边界。
4. 提取文本增量，追加到当前消息的完整 source。
5. 结束时清除生产端 streaming 状态；取消时同时中止网络。

## 完整示例

下面保留已校对的协议和实现代码。各文件名见代码注释；协议字段与服务端实现保持一致。示例服务端用于说明流式传输，应替换为实际模型服务。

### 安装

```sh
pnpm add @ai-markdown/react katex
```

### 传输事件格式

```text
data: {"type":"delta","text":"# Answer\n\n"}

data: {"type":"delta","text":"Hello **world**."}

data: {"type":"done"}

```

### 事件类型与解析

```ts
// chat-protocol.ts
export type ChatEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'error'; message: string };

export function parseChatEvent(data: string): ChatEvent {
  const value: unknown = JSON.parse(data);
  if (!value || typeof value !== 'object') throw new Error('Invalid chat event');
  const event = value as Record<string, unknown>;
  if (event.type === 'delta' && typeof event.text === 'string') {
    return { type: 'delta', text: event.text };
  }
  if (event.type === 'done') return { type: 'done' };
  if (event.type === 'error' && typeof event.message === 'string') {
    return { type: 'error', message: event.message };
  }
  throw new Error('Unknown chat event');
}
```

### 读取 SSE 数据

```ts
// read-sse.ts
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let reachedEof = false;

  function* takeLines(final: boolean): Generator<string> {
    while (true) {
      const at = buffer.search(/[\r\n]/);
      if (at < 0) break;
      // A final CR in a network read may be the first half of CRLF.
      if (buffer[at] === '\r' && at === buffer.length - 1 && !final) break;
      const width = buffer[at] === '\r' && buffer[at + 1] === '\n' ? 2 : 1;
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + width);
      if (line === '') {
        if (data.length > 0) yield data.join('\n');
        data = [];
        continue;
      }
      if (line.startsWith(':')) continue; // SSE comment / heartbeat
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      // event/id/retry are intentionally unused by this POST protocol.
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        reachedEof = true;
        buffer += decoder.decode();
        yield* takeLines(true);
        return; // An unterminated event is not dispatched at EOF.
      }
      buffer += decoder.decode(value, { stream: true });
      yield* takeLines(false);
    }
  } finally {
    // Leaving after `done` or an application error stops the body too.
    if (!reachedEof) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
```

### 聊天消息组件

```tsx
// ChatMessage.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-markdown/react';
import { readSseData } from './read-sse';
import { parseChatEvent } from './chat-protocol';

interface ChatMessageProps {
  id: string;
  prompt: string;
}

type Status = 'waiting' | 'streaming' | 'done' | 'stopped' | 'error';

export function ChatMessage({ id, prompt }: ChatMessageProps) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('waiting');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setContent('');
    setError(null);
    setStatus('waiting');

    async function run() {
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Chat request failed (${response.status})`);
        if (!response.body) throw new Error('Chat response has no body');
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
          throw new Error('Expected an SSE response');
        }

        for await (const data of readSseData(response.body)) {
          if (!active || controller.signal.aborted) return;
          const event = parseChatEvent(data);
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'done') {
            setStatus('done');
            return;
          }
          setContent((previous) => previous + event.text);
          setStatus('streaming');
        }
        throw new Error('Connection ended before completion');
      } catch (cause) {
        if (!active) return;
        if (controller.signal.aborted) {
          setStatus('stopped');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Chat request failed');
        setStatus('error');
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [id, prompt]);

  const pending = status === 'waiting' || status === 'streaming';
  return (
    <section className="chat-message" aria-label="Assistant message" aria-busy={pending}>
      {pending && content === '' && <p role="status">Waiting for a response…</p>}
      <AIMarkdown content={content} documentId={id} streaming={pending} streamingCursor={AIMarkdownStreamingCursor} />
      {pending && (
        <button type="button" onClick={() => abortRef.current?.abort()}>
          Stop
        </button>
      )}
      {status === 'stopped' && <p role="status">Response stopped.</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

### 每次请求使用独立组件身份

```tsx
<ChatMessage key={requestId} id={messageId} prompt={prompt} />
```

### RSC 宿主的全局样式

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import 'katex/dist/katex.min.css';
import '@ai-markdown/react/typography/default.css';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### 服务端流式响应示例

```ts
// app/api/chat/route.ts
export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Expected JSON' }, { status: 400 });
  }
  const prompt = input && typeof input === 'object' && 'prompt' in input ? input.prompt : undefined;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return Response.json({ error: 'A prompt is required' }, { status: 400 });
  }

  async function* generate() {
    const answer = `# Echo\n\n${prompt}\n`;
    // Replace this iterator with the provider's text-delta iterator.
    for (const character of answer) {
      if (request.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (request.signal.aborted) return;
      yield character;
    }
  }

  const iterator = generate();
  const encoder = new TextEncoder();
  let cancelled = false;
  const encode = (event: object) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        if (next.done) {
          controller.enqueue(encode({ type: 'done' }));
          controller.close();
        } else {
          controller.enqueue(encode({ type: 'delta', text: next.value }));
        }
      } catch {
        if (!cancelled) {
          controller.enqueue(encode({ type: 'error', message: 'Generation failed' }));
          controller.close();
        }
      }
    },
    async cancel() {
      cancelled = true;
      await iterator.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
```

## 呈现与排空

普通消息使用一个 AIMarkdown。要柔化突发到达的内容，可使用 AIMarkdownSmoothStream，或用 useSmoothStream 包装你现有的 React/Mantine 渲染器。不要叠加第二层独立的逐字定时器。

生产端结束后，平滑输出仍可能继续排空。等待首个字符的占位属于应用 UI，光标不会在空内容上寻找锚点。用户取消、重新生成或切换消息时，应明确是否保留已经收到的文本。

RSC 宿主使用客户端边界。详细传输示例与变体见[英文完整指南](english:docs/guides/streaming-chat-example/)，SSR 规则见 [React SSR](react-ssr.md)。
