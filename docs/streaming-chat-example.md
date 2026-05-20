# Streaming Chat: End-to-End Example

A complete, copy-runnable example of an AI chat UI built on `<AIMarkdown>` — from a streaming HTTP endpoint to a React state machine to the rendered markdown. The pieces here are intentionally minimal so you can see the seams; substitute your own LLM client, state library, or styling at every layer.

> Pre-reading: [Streaming & performance](./streaming-and-performance.md) explains *why* the patterns below work. This document shows *how* to wire them together.

---

## What you'll build

A chat panel that:

- Sends a user message to a backend endpoint (`POST /api/chat`).
- Receives the assistant's reply as a Server-Sent Events stream (one token-ish chunk per event).
- Renders the in-progress reply with `streaming={true}` so custom components can adapt.
- Renders the finalized reply with `streaming={false}` so copy buttons and other UI become active.
- Coordinates cross-chunk references when the same logical message is delivered in multiple chunks (e.g. long replies split server-side).

The code below assumes `@ai-react-markdown/core` is installed and React 19 is your host framework. The only extra install is `katex` if your installer is strict-isolation (yarn PnP / `pnpm --node-linker=isolated`) — see the [main README's Peer Dependencies](../README.md#peer-dependencies) for details. Everything else (KaTeX CSS, the renderer itself, the SSE plumbing) is shown inline.

---

## Approach A: single `<AIMarkdown>` with growing content

The simplest pattern. Works for the 95% case where you control content assembly upstream of the renderer.

```tsx
// ChatMessage.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import AIMarkdown from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

interface ChatMessageProps {
  /** Stable id for this message (used as documentId). */
  id: string;
  /** The user's prompt that triggered this assistant turn. */
  prompt: string;
}

type Status = 'streaming' | 'done' | 'error';

export function ChatMessage({ id, prompt }: ChatMessageProps) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('streaming');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
          signal: ctrl.signal,
        });

        if (!res.body) throw new Error('No response body');

        // Parse SSE: each event is "data: <chunk>\n\n". We append <chunk> to content.
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          // Split on the SSE event boundary.
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? ''; // last item is partial; save for next iteration
          for (const e of events) {
            const line = e.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const chunk = line.slice('data: '.length);
            if (chunk === '[DONE]') {
              setStatus('done');
              return;
            }
            setContent((prev) => prev + chunk);
          }
        }
        setStatus('done');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStatus('error');
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [prompt]);

  return (
    <div className="chat-message">
      <AIMarkdown
        content={content}
        documentId={id}
        streaming={status === 'streaming'}
      />
      {status === 'error' && <div className="chat-error">Failed to load</div>}
    </div>
  );
}
```

### Why this works

- **Single `<AIMarkdown>` instance**, growing `content` string. No `<AIMarkdownDocuments>` wrapper needed — there's only one renderer instance per message.
- **Block-level memoization** keeps re-render cost proportional to the *delta* between renders. Adding a token to the tail of a 100-block document doesn't re-render the first 99 blocks.
- **`streaming` prop** is the signal for downstream renderers — a custom `pre` can show a streaming cursor, a custom `a` can defer prefetching, etc. See [Custom components](./custom-components.md) for adapting components to the streaming flag.
- **`documentId={id}`** keeps the per-document namespace for `id="…"` / `href="#…"` attributes stable across the message lifetime; if the user scrolls away and back, footnote anchors still resolve.

---

## Approach B: chunked rendering with `<AIMarkdownDocuments>`

Use this when the server returns content in *logical* chunks that you want to render as separate `<AIMarkdown>` instances — e.g. for virtualization, for incremental commit (one chunk per turn boundary), or because each chunk has its own metadata (token count, latency, …).

```tsx
// ChunkedChatMessage.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import AIMarkdown, { AIMarkdownDocuments } from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

interface Chunk {
  text: string;
  done: boolean;
}

export function ChunkedChatMessage({ id, prompt }: { id: string; prompt: string }) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      const res = await fetch('/api/chat-chunked', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
        signal: ctrl.signal,
      });
      if (!res.body) return;

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const e of events) {
          const data = e.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
          if (!data) continue;
          const parsed: { chunkIndex: number; text: string; done: boolean } = JSON.parse(data);
          setChunks((prev) => {
            const next = [...prev];
            next[parsed.chunkIndex] = { text: (next[parsed.chunkIndex]?.text ?? '') + parsed.text, done: parsed.done };
            return next;
          });
        }
      }
    })();

    return () => ctrl.abort();
  }, [prompt]);

  // The last chunk is streaming until its `done` flag flips; earlier chunks are finalized.
  return (
    <div className="chat-message">
      <AIMarkdownDocuments>
        {chunks.map((chunk, i) => (
          <AIMarkdown
            key={i}
            content={chunk.text}
            documentId={id}
            streaming={!chunk.done}
          />
        ))}
      </AIMarkdownDocuments>
    </div>
  );
}
```

### Why this works

- **`<AIMarkdownDocuments>`** wraps every chunk so footnote / link / image references in chunk B resolve against definitions in chunk D, even though they're separate `<AIMarkdown>` instances.
- **Same `documentId={id}` on every chunk** — this is the critical part. Without it, each chunk auto-generates its own id and coordination silently does nothing. See [Cross-chunk coordination](./cross-chunk-coordination.md#the-documentid-rule).
- **Only the last chunk has `streaming={true}`** at any moment. As chunks finalize, their `streaming` flips to `false`, which lets per-chunk custom components rehydrate (copy buttons appear, etc.).

> ⚠️ Keep `config.blockMemoEnabled: true` (the default). The cross-chunk path is only wired through the block-memo renderer; the legacy path silently disables coordination. See the warning at the top of [Cross-chunk coordination](./cross-chunk-coordination.md).

---

## Next.js App Router specifics

`<AIMarkdown>` and `<MantineAIMarkdown>` are **client components**. `@ai-react-markdown/core`'s entry declares `'use client'` at the top of its barrel; `@ai-react-markdown/mantine` doesn't declare it on its own entry, but its sub-components that need it (the Mermaid renderer, code-highlight integration) do. In practice this means: import them from a file you've marked `'use client'` yourself, or wrap them in a client component. Two common patterns:

### Pattern 1: client component file

```tsx
// app/components/ChatMessage.tsx
'use client';
import AIMarkdown from '@ai-react-markdown/core';
// … (full body from Approach A above)
```

Then use it freely from server components:

```tsx
// app/chat/page.tsx
import { ChatMessage } from '@/app/components/ChatMessage';

export default function ChatPage() {
  return <ChatMessage id="msg-1" prompt="Hello" />;
}
```

### Pattern 2: CSS imports go in `layout.tsx`

CSS imports must live at the layout level (or a parent), not inside the component file — otherwise webpack will try to bundle them with the client component code, which doesn't always work in App Router.

```tsx
// app/layout.tsx
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';
// or for Mantine:
// import '@mantine/core/styles.css';
// import '@mantine/code-highlight/styles.css';
// import '@ai-react-markdown/mantine/styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### Pattern 3: streaming API route

The backend endpoint that feeds Approach A / B is a standard Next.js Route Handler that returns a streaming `Response`:

```ts
// app/api/chat/route.ts
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();

  // Substitute your real LLM client. This example just echoes the prompt.
  async function* iterate() {
    const tokens = prompt.split(' ');
    for (const t of tokens) {
      await new Promise((r) => setTimeout(r, 50));
      yield `${t} `;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of iterate()) {
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no', // important for nginx
    },
  });
}
```

---

## Choosing between A and B

| Question | Approach A (growing content) | Approach B (chunked) |
|---|---|---|
| Simplest case | ✅ | |
| Cross-chunk references (`[^1]` in one chunk, `[^1]:` in another) | ✅ but only within the single instance | ✅ across instances via `<AIMarkdownDocuments>` |
| Virtualize a very long message | | ✅ |
| Per-chunk metadata (token timestamps, retry, …) | | ✅ (each chunk has its own React boundary) |
| Lowest memory footprint | ✅ | |
| Best block-memo behavior | ✅ (one cache per message) | ✅ (one cache per chunk; finer-grained) |

Start with A. Move to B only when you have a concrete reason (virtualization, per-chunk UI affordances, etc.).

---

## Footguns

- **New `documentId` every render** — `documentId={\`msg-${Date.now()}\`}` allocates a new id-namespace on every render. Use the message id, not a per-render value.
- **Forgetting `streaming` flips back to `false`** — if `streaming` stays `true` after the stream finishes, custom components that gate behavior on it (copy buttons, citation popovers) never activate.
- **Throttling `setContent`** — if you debounce the state setter to "save renders", you defeat block-memo's whole point. Block-level memoization makes per-token re-renders cheap; don't optimize what isn't slow.
- **Re-mounting `<AIMarkdown>` on every render** — if your parent passes a new `key` prop on every render, React tears down and rebuilds the renderer, throwing away the block cache. Keep `key` stable per logical message.
- **Mixing chunked and growing in the same instance** — pick A or B per message; don't switch mid-stream.

For broader streaming-related caveats see [Streaming & performance](./streaming-and-performance.md).
