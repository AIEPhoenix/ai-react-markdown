# Streaming Chat: End-to-End Example

This end-to-end recipe uses React and a Next.js-style route. The transport rules also apply to Vue; feed accumulated text to the Vue component instead of using React state or hooks. See the [Vue guide](../packages/vue/README.md#minimal-component) and [package setup](./getting-started.md).

A streaming chat integration needs three contracts: how the server frames a response, how the client accumulates and terminates it, and what the Markdown renderer receives. This example makes those contracts explicit. The renderer receives the full accumulated string; the transport owns deltas, cancellation, errors, and completion.

Start with one `<AIMarkdown>` per assistant message. Use separate renderers only for independently parseable logical sections that need their own UI or metadata. An HTTP read boundary is not a Markdown boundary: a read can end inside a UTF-8 character, an SSE event, a code fence, or a formula.

The examples use React 19, browser Fetch/Streams APIs, and a Next.js-compatible route handler. Install the React adapter and explicitly install KaTeX when importing its stylesheet:

```sh
pnpm add @ai-markdown/react@rc katex
```

## What you'll build

The complete single-message path below provides:

- `POST /api/chat` with a JSON request body.
- SSE events whose `data` is JSON, preserving newlines, backslashes, and whitespace inside Markdown deltas.
- An incremental event reader that handles network fragmentation, LF/CRLF/CR line endings, comments, and multiple `data:` lines.
- An explicit `done` event; an unexpected end of connection is an error rather than successful completion.
- A React effect that cancels old requests, ignores stale updates, clears state for a new turn, and retains partial text after an error.
- A waiting indicator before the first visible text, a streaming cursor, and a stop button.

The endpoint uses a deterministic echo generator so the example runs without an LLM account. Replace only that generator with your provider's delta iterator. Authentication, conversation persistence, and model selection belong to your application.

## Transport contract: JSON inside SSE

Each event contains one JSON object. A delta carries text; completion is a separate message:

```text
data: {"type":"delta","text":"# Answer\n\n"}

data: {"type":"delta","text":"Hello **world**."}

data: {"type":"done"}

```

The newlines inside `text` are JSON escapes. The blank line after each `data:` line terminates the SSE event. Sending raw Markdown directly after `data:` loses framing when a delta contains a newline; JSON encoding keeps the content distinct from the protocol.

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

This validates the application event rather than asserting that `JSON.parse` returned the expected interface. The reader below extracts SSE data; `parseChatEvent` validates what that data means.

## A reader that survives network boundaries

A streaming `TextDecoder` preserves UTF-8 characters split between reads. The line parser waits for a complete line, treats CRLF as one terminator even when split between reads, and dispatches data only at a blank line. Multiple `data:` lines are joined with a newline.

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

This is a reader for the documented POST protocol, not an EventSource reconnection client. It does not interpret event IDs, retry hints, or reconnect a request. If you use a transport library, keep its established framing and reconnect behavior rather than running two parsers over the same stream.

## Approach A: single `<AIMarkdown>` with growing content

The component starts a new request when `id` or `prompt` changes. The effect's `active` flag prevents an older request from writing into a newer message. Cleanup aborts the request, which also makes development Strict Mode effect replay safe on the client side.

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

Use a stable message key at the call site. For a new independent request or regeneration round, a new request key also prevents the previous round's state from appearing in the first render before the effect resets it:

```tsx
<ChatMessage key={requestId} id={messageId} prompt={prompt} />
```

Aborting a client request does not guarantee that a provider has stopped billable work. Pass the server request signal to your provider when its API supports cancellation. Strict Mode can start and abort a request during effect replay; a backend that performs persistent side effects should use its own request identity and idempotency policy.

### Why this works

The React adapter receives accumulated content, so unchanged prefixes are eligible for incremental parsing and block caching. Eligibility still depends on the source grammar: a long open construct or unresolved reference can keep the active tail large. The example does not claim constant work per token.

`streaming` remains true while waiting or receiving data, and becomes false for completion, stop, or error. The built-in cursor hides when there is no suitable text anchor, so the explicit waiting paragraph covers the pre-first-token state. `aria-busy` conveys message activity without making every token a live-region announcement.

`documentId` supplies a stable namespace for footnotes and admitted HTML IDs. A single instance needs no registry wrapper; references within the message already resolve against the same parsed source.

## Next.js App Router specifics

Place interactive request state and function-valued renderer configuration in a client component. The React adapter's published entry preserves its client boundary, but application Hooks and callbacks still need the appropriate client-side module. Do not send component functions, preprocessors, or URL callbacks through a server-to-client serializable prop boundary; define them in the client wrapper.

### CSS imports go in `layout.tsx`

A root layout is a predictable place to establish shared stylesheet order:

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

This is an organizational choice for the example, not a claim that all component-level stylesheet imports are forbidden. A Mantine integration also needs its provider/adapter setup and the three Mantine-related stylesheets shown in the [package README](../packages/react-mantine/README.md#css-dependencies).

### Streaming API route

This route uses Web `Request`, `Response`, and `ReadableStream` types. Each pull emits one event, so the producer follows stream demand rather than enqueueing the entire reply at once.

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

The buffering header is a hint to compatible proxies, not an end-to-end delivery guarantee. Check your deployed transport if chunks arrive in large bursts. Smooth rendering can change reveal cadence but cannot make text available before the network delivers it.

## Approach B: chunked rendering with `<AIMarkdownDocuments>`

Separate renderers are useful for independently parseable sections with individual metadata, controls, or lifecycle. The server must expose those logical boundaries. It must not label every network read as a separate Markdown document fragment.

A suitable application event is `{ type: 'chunk', index, text, done }`, where `text` is a delta for one logical section and `done` closes that section. Validate it before updating state. Keep the server's index stable and sort sections explicitly if they arrive out of order:

```tsx
interface Chunk {
  index: number;
  text: string;
  done: boolean;
}
interface ChunkEvent {
  type: 'chunk';
  index: number;
  text: string;
  done: boolean;
}

function applyChunk(previous: Chunk[], event: ChunkEvent): Chunk[] {
  if (!Number.isSafeInteger(event.index) || event.index < 0) throw new Error('Invalid chunk index');
  const existing = previous.find((chunk) => chunk.index === event.index);
  if (existing?.done) throw new Error('Received content for a completed chunk');
  const next = {
    index: event.index,
    text: (existing?.text ?? '') + event.text,
    done: event.done,
  };
  return [...previous.filter((chunk) => chunk.index !== event.index), next].sort((a, b) => a.index - b.index);
}
```

Use the same request cancellation, HTTP checks, SSE reader, and overall completion/error handling as Approach A. An overall `done` event should arrive only after all logical sections are complete. On error or cancellation, clear the active lifecycle flags in your state so no chunk remains permanently generating.

```tsx
import AIMarkdown, { AIMarkdownDocuments, AIMarkdownStreamingCursor } from '@ai-markdown/react';

function ChunkedMessage({ id, chunks, pending }: { id: string; chunks: Chunk[]; pending: boolean }) {
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk) => (
        <AIMarkdown
          key={chunk.index}
          documentId={id}
          documentIndex={chunk.index}
          content={chunk.text}
          streaming={pending && !chunk.done}
          streamingCursor={AIMarkdownStreamingCursor}
        />
      ))}
    </AIMarkdownDocuments>
  );
}
```

Each active chunk gets a cursor if it has an eligible text tail. The example allows several active chunks; only a sequential server contract guarantees that the last chunk alone is streaming. For one visual typewriter across concurrent section sources, use document smooth turn-taking.

Cross-chunk coordination shares footnote numbering and reference definitions. It does not join paragraphs, continue a list, or close a code fence opened in another instance. Keep `blockMemo` enabled; the non-memoized path renders each chunk with standalone semantics. `documentIndex` orders the mounted registry contributions, but it cannot preserve definitions belonging to unmounted sections. See [cross-chunk coordination](./cross-chunk-coordination.md) before adding virtualization.

## Add smooth reveal without changing the protocol

Pass raw accumulated source to the smooth shell, or use the hook for a custom wrapper. Its returned `streaming` describes the visible reveal, which can remain active after source completion:

```tsx
import AIMarkdown, { useSmoothStream, AIMarkdownStreamingCursor } from '@ai-markdown/react';

function SmoothMessage({ content, pending }: { content: string; pending: boolean }) {
  const { flush, ...visible } = useSmoothStream({ content, streaming: pending, pacing: 'balanced' });
  return (
    <div aria-busy={visible.streaming}>
      <AIMarkdown {...visible} streamingCursor={AIMarkdownStreamingCursor} />
      {visible.streaming && (
        <button type="button" onClick={flush}>
          Show available text
        </button>
      )}
    </div>
  );
}
```

Mount with empty content if new arrivals should animate. Non-empty mounts snap to the supplied text for hydration and scroll-back. In a coordinated queue, mount empty placeholders with `smoothWaiting` while awaiting input; otherwise an empty non-streaming chunk is already complete. See [smooth streaming](./smooth-streaming.md) for drain callbacks, completion, grapheme boundaries, and reduced-motion handling.

## Choosing between A and B

| Requirement                         | Growing message              | Logical chunks                              |
| ----------------------------------- | ---------------------------- | ------------------------------------------- |
| Simplest state and request handling | One string and one renderer  | Per-section state and ordering              |
| Syntax spanning transport deltas    | Accumulate before parsing    | Must accumulate within each logical section |
| References across the message       | One parser resolves them     | Registry wrapper and shared document ID     |
| Per-section controls or metadata    | Application structure needed | Natural component boundary                  |
| Virtualization                      | Keep the message mounted     | Account for lost contributions on unmount   |
| Smooth reveal                       | One hook or shell            | Optional mount-ordered turn-taking          |

## Integration checks

Test a response containing actual newlines, a Chinese character or emoji split across byte reads, an SSE boundary split across reads, and a delta followed immediately by `done`. The final text must match the concatenated delta strings exactly.

Also test HTTP failure, malformed JSON, EOF without `done`, cancellation, rapid prompt replacement, and an empty completed result. Old requests must not append into new turns; every terminal state must clear `streaming`. For chunks, verify late definitions, out-of-order arrivals, duplicate completion, and a section that never receives text.

Keep component and policy references stable, and never append a cursor glyph to the Markdown source. If updates overwhelm the page, bounded upstream batching is a legitimate latency/performance trade-off; measure it and flush the final value. Block caching reduces repeated work but does not eliminate the cost of every update.
