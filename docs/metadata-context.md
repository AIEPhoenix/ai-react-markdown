# Metadata Context

`metadata` is a typed React context that lets you pass arbitrary app-level data — callbacks, ids, configuration — to deeply nested custom components **without prop drilling** and **without re-rendering the markdown body** when the metadata changes.

```tsx
import AIMarkdown, { useAIMarkdownMetadata } from '@ai-react-markdown/core';

interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
  onCitationClick: (label: string) => void;
}

function MyCodeBlock({ children }: { children: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  return (
    <pre>
      <button onClick={() => meta?.onCopyCode(String(children))}>Copy</button>
      {children}
    </pre>
  );
}

<AIMarkdown<typeof defaultConfig, ChatMeta>
  content={markdown}
  metadata={{
    messageId: msg.id,
    onCopyCode: handleCopy,
    onCitationClick: handleCitation,
  }}
  customComponents={{ pre: MyCodeBlock }}
/>
```

The hook returns `TMetadata | undefined`. Always handle the `undefined` case — it's exactly what you get when no `metadata` was supplied.

---

## Why a separate context?

`<AIMarkdown>` has two React contexts under the hood:

1. **`AIMarkdownRenderStateContext`** — holds `{ streaming, fontSize, variant, colorScheme, documentId, clobberPrefix, config }`. Read via `useAIMarkdownRenderState()`. The markdown body subscribes to this.
2. **`AIMarkdownMetadataContext`** — holds the consumer's `metadata` opaquely. Read via `useAIMarkdownMetadata()`. The markdown body **does not** subscribe.

Why two contexts? Because metadata changes are typically common in chat UIs — a parent rebuilding `metadata={{ onCopy: …, messageId: … }}` on every render is the default React pattern. If metadata lived in the same context as render state, **every metadata change would re-render the full markdown body**, defeating block-level memoization for streaming content.

The split is precisely the optimization that lets `metadata` carry callbacks (and other non-stabilized data) without performance penalty — callbacks are usually new references every render, and that's fine here.

```text
parent render → new `metadata` object
  → AIMarkdownMetadataContext.Provider value changes
  → components that call `useAIMarkdownMetadata` re-render
  → AIMarkdownRenderStateContext value is unchanged
  → AIMarkdownContent is memoized on its own stable props
    and does NOT re-render
  → the per-block memo cache is untouched
```

What this guarantees in practice is the cache. `AIMarkdownContent` and its block-memoized output don't re-execute when `metadata` shifts. Some outer layers (the `<Typography>` wrapper, the two context providers themselves) do re-run once because their `children` JSX is a new element each render — that's a couple of cheap re-renders, not a re-pass of the markdown pipeline. The phrase "metadata changes don't re-render the markdown body" is shorthand for "they don't invalidate the block cache" — the actual performance guarantee.

This is also why `metadata` is **intentionally not stabilized** by the library. The library doesn't `useStableValue(metadata)` — that would require deep-comparing an arbitrary, possibly-huge object on every render (e.g. a chat session containing full message history). Stabilizing metadata is the consumer's responsibility *only* if their custom components do reference-equal work on it.

---

## Recipes

### Pass copy / regenerate / edit callbacks to a code block

```tsx
interface ChatMeta {
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
  onEdit: () => void;
}

function ChatCodeBlock({ children }: { children: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  const code = String(children);
  return (
    <pre>
      <div className="toolbar">
        <button onClick={() => meta?.onCopyCode(code)}>Copy</button>
        <button onClick={() => meta?.onRegenerate()}>Regenerate</button>
        <button onClick={() => meta?.onEdit()}>Edit</button>
      </div>
      {children}
    </pre>
  );
}
```

### Resolve citations to UI state

```tsx
interface CitationMeta {
  citations: Map<string, { title: string; url: string }>;
}

function CitedLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<CitationMeta>();
  if (href?.startsWith('cite://')) {
    const id = href.slice('cite://'.length);
    const c = meta?.citations.get(id);
    if (c) return <a href={c.url} title={c.title}>{children}</a>;
  }
  return <a href={href}>{children}</a>;
}
```

This pairs well with [URL Sanitization](./url-sanitization.md) — opting `cite://` through both gates means the LLM can emit citations and the custom component resolves them at render time.

### Per-message identity for analytics

```tsx
interface AnalyticsMeta {
  messageId: string;
  conversationId: string;
  trackEvent: (event: string, props?: Record<string, unknown>) => void;
}

function TrackedLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<AnalyticsMeta>();
  return (
    <a
      href={href}
      onClick={() => meta?.trackEvent('link_click', {
        href,
        messageId: meta.messageId,
        conversationId: meta.conversationId,
      })}
    >
      {children}
    </a>
  );
}
```

The callback can change every render (it usually closes over local state) and the markdown body is unaffected.

### Per-message "thinking" indicator while streaming

```tsx
interface StreamMeta {
  thinkingStartedAt: number | null;
}

function CodeWithSpinner({ children }: { children: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<StreamMeta>();
  const { streaming } = useAIMarkdownRenderState();
  return (
    <pre>
      {streaming && meta?.thinkingStartedAt && (
        <Spinner since={meta.thinkingStartedAt} />
      )}
      {children}
    </pre>
  );
}
```

Note `useAIMarkdownRenderState()` and `useAIMarkdownMetadata()` can be combined freely — they're separate contexts but the component just uses both.

---

## Typing the metadata generic

`useAIMarkdownMetadata<TMetadata>()` is a **caller assertion**, not a derived type. TypeScript cannot verify that the `<AIMarkdown>` provider above actually received `metadata` of shape `TMetadata`. If you assert wrong, fields look fine at compile time and `undefined` at runtime.

The recommended pattern is to define your shape in one place and write a project-local wrapper hook:

```ts
// my-chat/metadata.ts
import { useAIMarkdownMetadata } from '@ai-react-markdown/core';

export interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
}

export const useChatMeta = () => useAIMarkdownMetadata<ChatMeta>();
```

Now every component imports `useChatMeta()` — the assertion lives in one file:

```tsx
function MyCodeBlock() {
  const meta = useChatMeta(); // typed as ChatMeta | undefined
}
```

This mirrors the pattern `@ai-react-markdown/mantine` uses for `useMantineAIMarkdownMetadata`. See [TypeScript Generics](./typescript-generics.md) and [Extending via a Sub-package](./extending-via-subpackage.md) for the same idea applied to config.

---

## Metadata vs render state vs prop drilling

| When you have… | Use… |
|---|---|
| Data that's part of how markdown should *render* (color scheme, font size, streaming flag, document id) | Render state (props on `<AIMarkdown>`, read via `useAIMarkdownRenderState`) |
| App-level callbacks, ids, or data that custom components need (rarely affects render of standard markdown) | Metadata (`metadata` prop, read via `useAIMarkdownMetadata`) |
| One-off data passed to a single direct child | Plain prop on the custom component |
| Data already in a project-wide Context | Just use that Context inside your custom components — no need to route through `metadata` |

The library doesn't *force* you to use `metadata`. If you already have a Redux/Zustand/Context for chat state, custom components can read from it directly. `metadata` is the path of least resistance when you don't have one — and it gives you the re-render isolation guarantee automatically.

---

## Footguns

### Forgetting that `metadata` can be `undefined`

```ts
// ⚠️ Crashes when no metadata was passed to the provider.
const meta = useAIMarkdownMetadata<ChatMeta>();
meta.onCopyCode(code);

// ✅ Optional-chain.
meta?.onCopyCode(code);

// ✅ Or assert defensively.
if (!meta) throw new Error('ChatMeta is required for this component');
```

The hook's return type is `TMetadata | undefined` for exactly this reason. The cost of optional-chaining is trivial; the alternative is intermittent crashes when the consumer forgets the prop.

### Stabilizing metadata when you don't need to

```tsx
// ⚠️ Unnecessary — markdown body doesn't re-render on metadata changes anyway.
const stableMeta = useMemo(() => ({ onCopy, messageId }), [onCopy, messageId]);
<AIMarkdown metadata={stableMeta} ... />

// ✅ Plain object is fine.
<AIMarkdown metadata={{ onCopy, messageId }} ... />
```

Only stabilize if your *custom components* do work that depends on `metadata` reference equality (e.g. inside their own `useMemo`/`useEffect`).

### Storing huge state trees in `metadata`

`metadata` is opaque to the library — it doesn't deep-equal or stabilize. Every render rebuilds the provider value (an object identity change), so:

- Components reading `metadata` re-render whenever the parent renders (always, with default React Context behavior).
- This is **fine** for typical chat metadata (a few callbacks, a few ids).
- It's **not fine** if metadata is, e.g., a 10K-message chat transcript — every render makes every metadata-consumer re-render, even if nothing they care about changed.

For large state, keep `metadata` slim (selectors / ids) and read the big state from a dedicated store (Zustand, Jotai, Redux, your own Context with `useSyncExternalStore`).

### Calling `useAIMarkdownMetadata` outside a custom component

The hook only returns a value when called from within the `<AIMarkdown>` tree. Outside it (e.g. a sibling that just renders next to `<AIMarkdown>`), it returns `undefined`. Either move the consumer inside the tree (as a custom component) or read the same data from its original source (state, props, store).
