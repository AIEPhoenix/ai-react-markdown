# Metadata Context

`metadata` carries application data to custom Markdown components through a dedicated React context. Use it for message IDs, callbacks, citation records, and other information that a renderer needs without changing the Markdown parser's configuration. The library passes the value through without cloning or deep comparison.

```tsx
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownCustomComponents } from '@ai-react-markdown/core';

interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
  onCitationClick: (label: string) => void;
}

const CopyablePre: NonNullable<AIMarkdownCustomComponents['pre']> = ({ node, children, ...props }) => {
  const meta = useAIMarkdownMetadata<ChatMeta>();
  const code = node?.children[0];
  const source =
    code?.type === 'element' && code.tagName === 'code'
      ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      : '';
  return (
    <div>
      <button type="button" disabled={!meta} onClick={() => meta?.onCopyCode(source)}>
        Copy code
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
};
const COMPONENTS = { pre: CopyablePre } satisfies AIMarkdownCustomComponents;

<AIMarkdown<ChatMeta>
  content={markdown}
  metadata={{ messageId: msg.id, onCopyCode: handleCopy, onCitationClick: handleCitation }}
  customComponents={COMPONENTS}
/>;
```

The hook returns `ChatMeta | undefined`. Handle the absent value even when supplying a generic type argument: a type argument cannot establish that a matching provider exists at runtime. For a general-purpose code-copy component, including raw-HTML fallback and clipboard errors, see [custom components](./custom-components.md#custom-code-block-with-copy-button-core-no-mantine).

## Why a separate context?

`<AIMarkdown>` provides five per-system React contexts (document, metadata, state, theme, behaviors — each with its own narrow hook). The one that matters here:

- **The metadata context** — holds the consumer's `metadata` opaquely. Read via `useAIMarkdownMetadata()`. The markdown body **does not** subscribe.

Why isolate it? Because metadata changes are typically common in chat UIs — a parent rebuilding `metadata={{ onCopy: …, messageId: … }}` on every render is the default React pattern. If metadata lived in the same context as, say, the theme or streaming state, **every metadata change would re-render the full markdown body**, defeating block-level memoization for streaming content.

The split prevents metadata identity changes from invalidating parsing and block conversion. It does not make metadata updates free: every component subscribed to that context can still render. Inline callbacks are valid, but stable values can help if metadata consumers themselves are expensive.

```text
parent render → new `metadata` object
  → the metadata context value changes
  → components that call `useAIMarkdownMetadata` re-render
  → the other four context values are unchanged
  → AIMarkdownContent is memoized on its own stable props
    and does NOT re-render
  → the per-block memo cache is untouched
```

What this guarantees in practice is the cache. `AIMarkdownContent` and its block-memoized output don't re-execute when `metadata` shifts. Some outer layers (the `<Typography>` wrapper, the two context providers themselves) do re-run once because their `children` JSX is a new element each render — that's a couple of cheap re-renders, not a re-pass of the markdown pipeline. The phrase "metadata changes don't re-render the markdown body" is shorthand for "they don't invalidate the block cache" — the actual performance guarantee.

This is also why `metadata` is **intentionally not stabilized** by the library. The library doesn't `useStableValue(metadata)` — that would require deep-comparing an arbitrary, possibly-huge object on every render (e.g. a chat session containing full message history). Stabilizing metadata is the consumer's responsibility _only_ if their custom components do reference-equal work on it.

---

## Recipes

### Pass copy / regenerate / edit callbacks to a code block

Keep application actions outside the `<pre>` element and extract text from the displayed code node rather than coercing React children to a string. This version uses a ref so it also works when the children contain nested formatting:

```tsx
import { useRef } from 'react';

interface ChatActions {
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
  onEdit: () => void;
}

function ChatCodeBlock({ children }: { children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<ChatActions>();
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div>
      <div className="toolbar">
        <button type="button" disabled={!meta} onClick={() => meta?.onCopyCode(pre.current?.textContent ?? '')}>
          Copy
        </button>
        <button type="button" disabled={!meta} onClick={() => meta?.onRegenerate()}>
          Regenerate
        </button>
        <button type="button" disabled={!meta} onClick={() => meta?.onEdit()}>
          Edit
        </button>
      </div>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}
```

This copies displayed text. If a highlighter or formatter changes presentation, pass the original code through the component's own props or read the appropriate hast text instead. Metadata transports the action; it does not determine which representation is copied.

### Resolve citations to UI state

```tsx
interface CitationMeta {
  citations: Map<string, { title: string; url: string }>;
}

function CitedLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<CitationMeta>();
  if (href?.startsWith('cite://')) {
    const id = href.slice('cite://'.length);
    const c = meta?.citations.get(id);
    if (c)
      return (
        <a href={c.url} title={c.title}>
          {children}
        </a>
      );
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

function TrackedLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<AnalyticsMeta>();
  return (
    <a
      href={href}
      onClick={() =>
        meta?.trackEvent('link_click', {
          href,
          messageId: meta.messageId,
          conversationId: meta.conversationId,
        })
      }
    >
      {children}
    </a>
  );
}
```

A new callback can be supplied without changing Markdown source or pipeline configuration. Metadata consumers still receive the new provider value, so prefer stable callbacks when repeated consumer work matters.

### Per-message "thinking" indicator while streaming

The `Spinner` below is an application component that accepts a start timestamp. Keep it outside the code element so copied code excludes status text.

```tsx
interface StreamMeta {
  thinkingStartedAt: number | null;
}

function CodeWithSpinner({ children }: { children?: React.ReactNode }) {
  const meta = useAIMarkdownMetadata<StreamMeta>();
  const { streaming } = useAIMarkdownState();
  return (
    <div>
      {streaming && meta?.thinkingStartedAt != null && <Spinner since={meta.thinkingStartedAt} />}
      <pre>{children}</pre>
    </div>
  );
}
```

Note `useAIMarkdownState()` and `useAIMarkdownMetadata()` can be combined freely — they're separate contexts but the component just uses both.

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

This mirrors the pattern `@ai-react-markdown/mantine` uses for `useMantineAIMarkdownMetadata`. See [TypeScript Generics](./typescript-generics.md) and [Extending via a Sub-package](./extending-via-subpackage.md) for the same idea applied to behavior groups.

---

## Metadata vs render-facing props vs prop drilling

| When you have…                                                                                             | Use…                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Data that's part of how markdown should _render_ (color scheme, font size, streaming flag, document id)    | Props on `<AIMarkdown>`, read via the matching narrow hook (`useAIMarkdownTheme`, `useAIMarkdownState`, `useAIMarkdownDocument`) |
| App-level callbacks, ids, or data that custom components need (rarely affects render of standard markdown) | Metadata (`metadata` prop, read via `useAIMarkdownMetadata`)                                                                     |
| One-off data passed to a single direct child                                                               | Plain prop on the custom component                                                                                               |
| Data already in a project-wide Context                                                                     | Just use that Context inside your custom components — no need to route through `metadata`                                        |

The library doesn't _force_ you to use `metadata`. If you already have a Redux/Zustand/Context for chat state, custom components can read from it directly. `metadata` is the path of least resistance when you don't have one — and it gives you the re-render isolation guarantee automatically.

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

Choose metadata identity according to the work its consumers perform. An inline object is valid for small, infrequently updated data. A memoized object is also useful: it prevents context notifications when its fields have not changed, even if consumers do not explicitly use metadata in a dependency array.

```tsx
// Inside your message component; include every reactive field in the dependencies.
const metadata = useMemo(() => ({ onCopy, messageId }), [onCopy, messageId]);
<AIMarkdown content={content} metadata={metadata} />;
```

This does not suppress a real callback or id change: changing either dependency creates a new provider value. Stabilization cannot rescue a callback recreated on every parent render; stabilize that callback at its source when appropriate. For per-token reactive data, a stable external-store handle and a selective subscription provide a more precise boundary.

### Storing huge state trees in `metadata`

`metadata` is opaque to the library — it doesn't deep-equal or stabilize. A new object reference changes the provider value. A parent that retains the same metadata object does not automatically trigger a context update; a parent that recreates it does. Consequently:

- Components reading `metadata` receive a context update whenever its reference changes, even if the fields that a particular component reads are unchanged.
- This is **fine** for typical chat metadata (a few callbacks, a few ids).
- Passing a newly allocated 10K-message transcript makes every metadata consumer observe that identity change, even if its selected message is unchanged. Passing the same reference avoids that notification but does not provide granular subscriptions.

For large state, keep `metadata` slim (selectors / ids) and read the big state from a dedicated store (Zustand, Jotai, Redux, your own Context with `useSyncExternalStore`).

### Calling `useAIMarkdownMetadata` outside a custom component

The hook only returns a value when called from within the `<AIMarkdown>` tree. Outside it (e.g. a sibling that just renders next to `<AIMarkdown>`), it returns `undefined`. Either move the consumer inside the tree (as a custom component) or read the same data from its original source (state, props, store).

## Stable containers and live subscriptions

For frequently changing values, passing a stable store handle through metadata can avoid replacing the whole metadata record on every token. The handle must expose a subscription if consumers should render when its contents change. Mutating `metadata.progress` in place does not notify React; a ref is not a reactive store.

```tsx
import { useSyncExternalStore } from 'react';

interface ProgressStore {
  subscribe: (notify: () => void) => () => void;
  getSnapshot: () => number;
  getServerSnapshot: () => number;
}
interface ProgressMeta {
  progress: ProgressStore;
}

const NO_SUBSCRIPTION = () => () => {};
const ZERO = () => 0;

function ProgressLabel() {
  const store = useAIMarkdownMetadata<ProgressMeta>()?.progress;
  const progress = useSyncExternalStore(
    store?.subscribe ?? NO_SUBSCRIPTION,
    store?.getSnapshot ?? ZERO,
    store?.getServerSnapshot ?? ZERO
  );
  return <span>{progress}%</span>;
}
```

The store's functions must be stable, and its snapshot must remain equal until the selected value changes. For server rendering, supply a server snapshot that matches the initial client value. This pattern lets the store own high-frequency updates while metadata provides the stable route to it.

## Provider boundaries and safe application data

Metadata belongs to the nearest Markdown instance's provider. A sibling outside that tree cannot read it merely because it shares the same `documentId`. Cross-chunk coordination shares reference data; it does not merge metadata between chunks. Give each chunk its own message data or a common store handle explicitly.

A custom citation component that replaces `cite://42` with a URL from metadata creates a new destination after the Markdown URL pass. Validate the citation store's destination according to the application's link policy. Permitting the marker protocol through both gates validates the marker's route through Markdown; it does not validate arbitrary values later read from application state.

When reviewing a metadata integration, change the callback while keeping `content` fixed, omit metadata entirely, and mount two messages with different IDs and callbacks. Those checks establish callback freshness, absent-value handling, and scope isolation. The implementation and regression references are [`context.tsx`](../packages/core/src/context.tsx), [`context.test.tsx`](../packages/core/src/context.test.tsx), and [`contextsV2.test.tsx`](../packages/core/src/contextsV2.test.tsx).
