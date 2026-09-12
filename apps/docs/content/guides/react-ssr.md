# React SSR and hydration

The React adapter supports server rendering and client hydration. Use the [React quick start](react-quick-start.md) for installation and CSS. Server/build consumers require Node `^20.19.0 || >=22.12.0`.

## Render a stable initial document

Pass the same initial `content`, document identity and rendering configuration on the server and first client render. Start applying transport updates after your application has established its client lifecycle. Do not derive the initial Markdown from browser-only values when the server rendered a different string.

Server rendering uses the full pipeline. Incremental parsing is a client optimization and is effective only with `blockMemo` enabled. Smooth components display initial content immediately, including server output; future appends can animate. Mounting an already completed answer does not replay it.

## Use a client boundary in RSC applications

The package's React entry retains its `use client` directive. In a React Server Components application, keep application hooks and function-valued renderer configuration inside a client component. Pass serializable source data across the server/client boundary.

```tsx
'use client';

import AIMarkdown from '@ai-markdown/react';

export function MarkdownAnswer({ content }: { content: string }) {
  return <AIMarkdown content={content} />;
}
```

Import global typography and KaTeX styles from the location permitted by your application framework. A client component can still participate in server-generated initial HTML; the directive identifies the component boundary, not a request to disable SSR.

Keep callbacks, custom component maps and preprocessor functions on the client side of that boundary. The [streaming chat recipe](streaming-chat-example.md) separates the application transport from the renderer and includes a server route example.

## Account for shared references

For coordinated sections, the server and hydration render use local reference semantics. Definitions supplied only by other mounted chunks become available after contribution effects commit. A late-hydrating boundary must initially match the server snapshot even if another boundary has already contributed.

If server-only output must resolve all references, pass the complete document to one renderer. Use [document coordination](cross-chunk-coordination.md) when independently mounted sections are a layout requirement, and keep React's `blockMemo` enabled for that path.

## Own mutable state per consumer

Keep application-owned sessions and document state scoped to the request or component that owns them. Custom components must produce compatible initial markup on the server and client. Prefer effects for browser measurements instead of reading layout during render.

The adapter's registry registration and contribution work follows committed React effects. Its server snapshot deliberately hides live cross-chunk registry data during hydration. Custom wrappers should preserve that lifecycle rather than publishing registry changes from render.

See the [React reference](../reference/react.md#integration-checks-and-implementation-boundaries) for integration checks and the [core contracts](api/core-engine-contracts.md) for lower-level ownership rules. The standalone SSR example does not by itself establish every host framework's routing, bundling or deployment configuration.
