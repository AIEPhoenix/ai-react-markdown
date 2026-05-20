# Streaming & Performance

`<AIMarkdown>` is built for **streaming-first** rendering — the same component re-renders dozens of times per second as LLM tokens arrive, and the output must stay flicker-free at 60fps even on mid-tier devices. Two mechanisms make this work:

1. **Block-level memoization** (`blockMemoEnabled`, on by default) — splits the document into per-block units and memoizes each block's React subtree by source identity. Unchanged blocks skip `toJsxRuntime` and React reconcile work.
2. **The `streaming` flag** — propagated via context, lets custom components adapt their behavior (show cursors, hide copy buttons, skip animations).

This document covers both, plus the reference-stability rules that determine whether memoization helps or silently degrades into a full re-render per frame.

---

## The streaming flag

```tsx
<AIMarkdown content={chunk} streaming={!done} />
```

`streaming` is a plain boolean exposed via `useAIMarkdownRenderState()`. The library itself doesn't change rendering behavior based on the flag — it's a signal for **custom components** to use as they see fit.

### Common uses

```tsx
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';

function CodeWithCopy({ children }: { children: React.ReactNode }) {
  const { streaming } = useAIMarkdownRenderState();
  return (
    <pre>
      {!streaming && <button>Copy</button>}
      {children}
    </pre>
  );
}
```

- **Hide interactive UI while streaming** — copy buttons, edit buttons, expand buttons. Mid-stream code is rarely actionable.
- **Show typing/streaming cursor** at the end of partial content. The cursor element receives `display: inline-block` and a CSS blink animation; toggled off when `streaming === false`.
- **Skip animations** during streaming — e.g. Mermaid diagrams fade in only after streaming completes; mid-stream renders show source.
- **Defer heavy rehydration** — components that produce side effects (analytics, route prefetch) can skip while content is mutating.

### What `streaming` does NOT do

It does **not** alter the parsing pipeline. The same remark/rehype plugins run; the same sanitization applies. Block-memoization is on whether or not `streaming === true`. The flag is purely informational for downstream consumers.

---

## Block-level memoization

When `blockMemoEnabled === true` (the default), the rendering pipeline:

1. Parses the markdown to **mdast** (Markdown AST) and **hast** (HTML AST) in one unified pass.
2. Splits the hast into per-block units — each top-level child that maps 1:1 with an mdast block (paragraphs, headings, code blocks, lists, tables, …) plus an optional synthetic footnote section.
3. Memoizes each block's React subtree, keyed by:
   - `raw` (the source text of the block)
   - `occurrence` index (for blocks with identical text — e.g. multiple `---` HRs)
   - `ctx` digest (for blocks that depend on cross-block syntax like footnote refs / link defs)
   - `startOffset` and `startLine` (so identical content at different positions don't false-cache)

Cached blocks skip `hast-util-to-jsx-runtime` and React reconcile work entirely — the cached `ReactNode` is returned directly. Output is **byte-identical** to the disabled path.

### What invalidates a block

| Change | Affects |
|---|---|
| Block's raw text changes | Just that block |
| Block's position changes (lines/offset shift due to insertion before it) | Each repositioned block (position is part of the key) |
| `customComponents` reference changes | All blocks |
| `urlTransform` reference changes | All blocks |
| `sanitizeSchema` deep-equal changes | All blocks |
| Footnote/link/image definition or reference added/removed anywhere | All blocks containing refs/defs (via `ctx` digest) |
| Standard prose block (no refs/defs) | Unaffected by ref/def changes elsewhere |

The last point is the key win: in a chat document with a footnote at the end, typing into the body **doesn't** invalidate the footnote block's cache, and adding the footnote at the end **doesn't** invalidate prose blocks that don't reference it.

### Disabling block memoization

Set `config.blockMemoEnabled: false` to opt out:

```tsx
<AIMarkdown content={c} config={{ blockMemoEnabled: false }} />
```

Output is **structurally** unchanged for standalone use. Performance regresses to a full pipeline pass on every render. Useful for:

- Debugging — if you suspect a custom remark/rehype plugin interacts badly with the plan abstraction (rare), this is the escape hatch to confirm.
- Environments where the `useRef`-backed cache is undesirable.
- A/B comparing cost.

In production for streaming workloads: **leave it on**.

> ⚠️ **Cross-chunk coordination requires `blockMemoEnabled: true`.** When the flag is `false`, the renderer takes the legacy path which **does not wire `Registry` through**. Wrapping `<AIMarkdown>` in `<AIMarkdownDocuments>` while keeping `blockMemoEnabled: false` silently degrades — orphan footnote defs aren't protected, references across chunks resolve as empty placeholders, and the aggregate footnote footer doesn't render. If you need cross-chunk behavior, keep block memoization enabled (the default).

---

## Reference stability across props

Block-memoization treats several props as cache dependencies. A new identity on any of them invalidates the entire document cache:

| Prop | Internal stabilization | Best practice |
|---|---|---|
| `content` | None — strings deep-equal by value | Plain string, no special handling |
| `customComponents` | `useStableValue` (deep-equal) | Module scope or `useMemo` for zero-overhead |
| `contentPreprocessors` | `useStableValue` (deep-equal) | Module scope |
| `urlTransform` | None — functions can't be deep-compared | Module scope **required** |
| `sanitizeSchema` | `useStableValue` (deep-equal) | Module scope **recommended** |
| `config` / `defaultConfig` | `useStableValue` (deep-equal) | Module scope |
| `metadata` | None — opaque to library | Doesn't affect block-memo (lives in separate context) |

### The `urlTransform` exception

`urlTransform` is **the only** cache dependency without a safety net. Function identity can't be deep-compared (two closures with identical bodies are always non-equal), so an inline `urlTransform={(url) => …}` discards the entire cache on every parent render — and unlike the deep-equal'd props, there's no recovery.

```tsx
// ⚠️ Effectively disables block memoization for the whole document.
function MyApp() {
  return (
    <AIMarkdown
      content={c}
      urlTransform={(url) => /^myapp:/.test(url) ? url : ''}
    />
  );
}

// ✅ Module scope — stable, cache stays warm.
const URL_TRANSFORM = (url) => /^myapp:/.test(url) ? url : '';
function MyApp() {
  return <AIMarkdown content={c} urlTransform={URL_TRANSFORM} />;
}
```

Development builds emit a `console.warn` after 3+ identity flips on `urlTransform` or `sanitizeSchema`. The warning is dead-code-eliminated in production.

---

## The `useStableValue` hook

```ts
function useStableValue<T>(value: T): T
```

Returns a referentially stable version of `value` by deep-comparing (via lodash `isEqual`) against the previous render's value. If equal, the previous reference is returned; otherwise the new value is captured.

Use it when you can't memoize a complex prop at the parent and want to break a chain of unnecessary re-renders downstream:

```tsx
import { useStableValue } from '@ai-react-markdown/core';

function MyChat({ rawMeta }: { rawMeta: ChatMeta }) {
  const stableMeta = useStableValue(rawMeta);
  // stableMeta keeps the same reference across renders as long as rawMeta is deep-equal.
  return <AIMarkdown content={c} metadata={stableMeta} />;
}
```

Cost: an `isEqual` on every render. Cheap for small objects; not cheap for arbitrary blobs. Don't apply blindly — use the existing reference if it's already stable.

---

## Streaming patterns

Two main approaches, named consistently with [Streaming chat: end-to-end](./streaming-chat-example.md):

### Approach A — single `<AIMarkdown>` with growing content

```tsx
function GrowingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} />;
}
```

Simpler and usually faster — one instance, one cache, no wrapper. Use this when you control content assembly upstream of `<AIMarkdown>` and don't need to virtualize chunks. **Start here unless you have a concrete reason to chunk.**

### Approach B — chunked, with `<AIMarkdownDocuments>`

```tsx
<AIMarkdownDocuments>
  {chunks.map((chunk, i) => (
    <AIMarkdown
      key={i}
      content={chunk}
      documentId={messageId}
      streaming={!done && i === chunks.length - 1}
    />
  ))}
</AIMarkdownDocuments>
```

Each chunk has its own block-memo cache. Cross-chunk references coordinate via [`<AIMarkdownDocuments>`](./cross-chunk-coordination.md). Use when virtualizing, when the server emits logical chunks, or when each chunk needs its own metadata.

### Variant: streaming cursor on Approach A

```tsx
function StreamingMessage({ content, done }: { content: string; done: boolean }) {
  return (
    <AIMarkdown
      content={done ? content : content + '▍'}
      streaming={!done}
    />
  );
}
```

Append a cursor character to the last block while streaming. The trailing `▍` is part of the last block's source — block memoization invalidates only that one block per frame.

---

## Profiling

The library is structured so the dominant work during streaming is:

1. Parsing (`unified.parse` + `mdast-util-from-markdown`) — proportional to total content length, not delta.
2. Walking mdast/hast to build the block plan — proportional to number of blocks.
3. Rendering only the changed block(s) — proportional to delta.

The first two are unavoidable per-frame work; the third is what block memoization optimizes. For a long document with small per-token deltas, (3) approaches zero and (1)+(2) dominate.

If profiling shows `<AIMarkdown>` as the bottleneck:

1. Check that `customComponents`, `urlTransform`, `sanitizeSchema`, `config` are all module-scope or stable. Inline props are the most common cause of perf regressions.
2. Try `blockMemoEnabled: false` to isolate whether the issue is in memoization or upstream.
3. Profile with React DevTools — a tree with most blocks under "Did not render" is healthy.

### Validating output equivalence

If you suspect `blockMemoEnabled: true` is producing different output than `false`, the library's test suite includes a `byteEquivalence.test.tsx` harness that asserts byte-identical HTML across every plugin permutation. Failures should be reported as bugs.

---

## Footguns

### Per-render closure-as-prop

Already covered above for `urlTransform`. The same anti-pattern applies to any prop with reference identity:

```tsx
import AIMarkdown, {
  type AIMarkdownCustomComponents,
  type AIMDContentPreprocessor,
  type AIMarkdownRenderConfig,
} from '@ai-react-markdown/core';

// ⚠️ All of these are new objects/functions every render.
function Bad({ content }: { content: string }) {
  return (
    <AIMarkdown
      content={content}
      customComponents={{ a: ({ href, children }) => <a href={href} className="link">{children}</a> }}
      contentPreprocessors={[(c) => c.trim()]}
      config={{ blockMemoEnabled: true }}
    />
  );
}

// ✅ Hoist — define once at module scope.
const Link = ({ href, children }: { href?: string; children: React.ReactNode }) => (
  <a href={href} className="link">{children}</a>
);
const trim: AIMDContentPreprocessor = (c) => c.trim();

const COMPONENTS: AIMarkdownCustomComponents = { a: Link };
const PREPROCESSORS: AIMDContentPreprocessor[] = [trim];
const CONFIG: Partial<AIMarkdownRenderConfig> = { blockMemoEnabled: true };

function Good({ content }: { content: string }) {
  return (
    <AIMarkdown
      content={content}
      customComponents={COMPONENTS}
      contentPreprocessors={PREPROCESSORS}
      config={CONFIG}
    />
  );
}
```

The `useStableValue` deep-equal safety net rescues `customComponents` and the others — but the deep-compare itself costs time, and `urlTransform` has no safety net at all.

### Disabling block-memo as a "perf fix"

If something feels slow, the instinct may be to disable block-memo to "see if it helps." Almost always:

- Disabling it makes things **slower**, not faster, for streaming content.
- The actual culprit is usually a non-stable prop reference (above).
- Disable `blockMemoEnabled` only for debugging correctness issues.

### Building a giant single-block document

Block memoization wins by dividing work into many small caches. If your content is one giant paragraph with no blank lines (one block from CommonMark's perspective), there's nothing to subdivide and memoization can't help. This is rare in practice — LLM output is almost always multi-block — but for pathological inputs the per-frame cost is dominated by parsing, not by render.

### Mistaking `streaming` for an in-progress signal that pauses rendering

`streaming === true` does not delay rendering. Content is rendered immediately as it arrives. The flag is purely a *signal* to your custom components that more content is coming. If you need a paused/buffered render (e.g. only update every 100ms), implement that in **your** component upstream of `<AIMarkdown>` — debounce the `content` you pass.
