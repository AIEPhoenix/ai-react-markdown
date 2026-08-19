# Cross-Chunk Coordination

When a single logical markdown document is rendered by **multiple** `<AIMarkdown>` instances (e.g. one `<AIMarkdown>` per streamed chunk in a chat UI), references that span chunks would normally break:

- footnote `[^1]` in chunk B → footnote def `[^1]: …` in chunk D fails to resolve
- link `[click][docs]` in chunk A → `[docs]: https://…` in chunk C produces an empty link
- image `![alt][hero]` in chunk C → `[hero]: …` in chunk A renders nothing

`<AIMarkdownDocuments>` is the wrapper that coordinates these references across chunks. It's opt-in — wrap your `<AIMarkdown>` instances, pass the **same** `documentId` to every chunk of the same logical document, and references resolve correctly across chunks.

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-react-markdown/core';

interface Message {
  id: string; // stable per logical message
  chunks: string[]; // markdown chunks as they arrived from the LLM
}

function StreamedMessage({ message }: { message: Message }) {
  return (
    <AIMarkdownDocuments>
      {message.chunks.map((chunk, i) => (
        <AIMarkdown key={i} content={chunk} documentId={message.id} />
      ))}
    </AIMarkdownDocuments>
  );
}
```

Without the wrapper, each `<AIMarkdown>` is independent — its references resolve only within its own content (standalone behavior, unchanged).

> ⚠️ **Prerequisite: keep `blockMemo` at `true` (the default).** Cross-chunk coordination is wired only through the block-memo render path. Setting `blockMemo={false}` falls back to the legacy renderer which does not connect to `Registry`, and coordination silently degrades — orphan defs are not protected, refs across chunks resolve as empty placeholders, and the aggregate footnote footer is not emitted.

---

## When to use

| Scenario                                                                                   | Use `<AIMarkdownDocuments>`?                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Single `<AIMarkdown>` per logical document (most non-streaming apps)                       | **No** — overhead with no benefit                                                             |
| One `<AIMarkdown>` per chat message, references stay within the message                    | **No**                                                                                        |
| Streamed message split into multiple `<AIMarkdown>` instances (e.g. one per network chunk) | **Yes** — same `documentId` across chunks                                                     |
| Multiple distinct messages on the same page, each with its own internal references         | **No** — but auto-generated `documentId` namespaces still prevent cross-message id collisions |
| One conceptual document split visually (collapsible sections, virtualized list rows)       | **Yes** if references span the splits                                                         |

---

## The `documentId` rule

`documentId` is the **id namespace** for clobberable attributes (`id="…"`, `href="#…"`). Two semantics:

1. **Within a single document**, the prefix ensures footnote backrefs and anchor links navigate correctly.
2. **Between documents on the same page**, distinct prefixes prevent `<a href="#fn-1">` from one message hijacking the `<li id="fn-1">` in another.

When you wrap chunks in `<AIMarkdownDocuments>` and pass the same `documentId`, the wrapper allocates a shared `Registry` keyed by that id, and the chunks see each other's contributions.

### Long ids are auto-hashed

If you pass UUIDs / nanoids (>16 chars), the library hashes them via MurmurHash3 → Base62 so the rendered HTML stays compact:

```text
documentId="550e8400-e29b-41d4-a716-446655440000"
  → state.documentId is the raw value
  → state.clobberPrefix becomes "Abc123-user-content-" (≤6-char hash)
  → registry keying uses the raw value
```

The shortening is purely a **rendered-HTML** concern. `useDocumentRegistry(documentId)` and `state.documentId` see the raw value, so deep linking and registry interop are unaffected.

### Auto-generated ids

Omit `documentId` and the library calls `useId()` to generate one. SSR-safe, stable across re-renders of the same instance. Different `<AIMarkdown>` instances get different ids — which is what you want for standalone mode, and exactly what you **don't** want for chunked-streaming mode.

> **The single most common mistake**: wrapping chunks in `<AIMarkdownDocuments>` but forgetting to pass a shared `documentId`. Each chunk gets its own auto-generated id, the registry partitions them, and coordination silently does nothing.

---

## What gets coordinated

Three independent reference kinds, each in its own namespace:

| Kind      | Markdown syntax                           | Coordinated across chunks?                                |
| --------- | ----------------------------------------- | --------------------------------------------------------- |
| Footnote  | `[^label]` + `[^label]: text`             | ✅ Numbering, anchor href, backref href, aggregate footer |
| Link ref  | `[click][label]` + `[label]: url "title"` | ✅ URL + title resolution                                 |
| Image ref | `![alt][label]` + `[label]: url "title"`  | ✅ URL + title resolution                                 |

**Inline links** (`[click](https://…)`) and **inline images** (`![alt](https://…)`) need no coordination — they carry their URL inline. The registry only matters for reference-style markup.

The footnote section is rendered **once** at the end of the document's last chunk, aggregating definitions from all chunks. There's no per-chunk footnote footer — the wrapper's `AggregateFootnotesIfLast` component detects when its chunk is the last one and emits the full footnote list. If chunk order changes (chunks unmount/remount during streaming), the footer follows the new "last" chunk automatically.

---

## `<AIMarkdownDocuments>` props

| Prop                       | Type        | Default | Purpose                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `preserveOrphanReferences` | `boolean`   | `true`  | **Unconditionally** overrides each chunk's own `preserveOrphanReferences` prop. When `true`, orphan `[^label]: …` definitions (no matching `[^label]`) are protected from being silently dropped by `mdast-util-to-hast`. Crucial for streaming — references may arrive in a later chunk.                                                        |
| `smoothTurnTaking`         | `boolean`   | `true`  | Wrapper-level switch for smooth-stream turn-taking: `<AIMarkdownSmoothStream>` chunks sharing this `documentId` type one at a time in mount order. `false` disables the gate wholesale (every chunk paces independently). Details and escape hatches: [smooth streaming → turn-taking](./smooth-streaming.md#multi-chunk-documents-turn-taking). |
| `children`                 | `ReactNode` | —       | The `<AIMarkdown>` instances to coordinate                                                                                                                                                                                                                                                                                                       |

```tsx
<AIMarkdownDocuments preserveOrphanReferences={true}>{children}</AIMarkdownDocuments>
```

Note that `preserveOrphanReferences` on the wrapper **wins over** the same prop on each chunk. This is by design: the wrapper-level policy is usually what you want consistent across chunks.

### Nested wrappers throw (dev) / degrade (prod)

```tsx
// Dev: throws an error immediately.
// Prod: console.errors, renders children, inner wrapper is a no-op.
<AIMarkdownDocuments>
  <AIMarkdownDocuments>{children}</AIMarkdownDocuments>
</AIMarkdownDocuments>
```

The split is intentional — surfacing the bug in dev, surviving in prod. Don't nest wrappers; if you have nested coordinated scopes (rare), the outer wrapper is always the canonical one for everything under it.

---

## Reading the registry: `useDocumentRegistry`

```ts
function useDocumentRegistry(documentId: string | undefined): Registry | null;
```

Returns:

- The shared `Registry` if both (a) called inside `<AIMarkdownDocuments>` and (b) `documentId` is non-empty.
- `null` otherwise — treat as "run the standalone path; no coordination."

> ℹ️ **The hook is allocating, not purely read-only.** Calling `useDocumentRegistry(documentId)` inside an `<AIMarkdownDocuments>` for a `documentId` that has no live chunks yet **creates an empty `Registry` shell** in the wrapper's `Map<documentId, Registry>` as a render-time side effect. The shell is later evicted when the next mount/unmount cycle settles. In practice this is invisible — but avoid calling with a frequently-changing id (e.g. `documentId={\`tmp-${Date.now()}\`}`), which would accumulate empty shells in the Map until the next mount cycle.

```tsx
import { useDocumentRegistry, defaultUrlTransform } from '@ai-react-markdown/core';

function BacklinkPanel({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  if (!registry) return null;

  const def = registry.resolveLinkDef(label);
  if (!def) return <span>(unresolved: {label})</span>;

  // ⚠️ def.url is the RAW destination from the contributing chunk — the
  // registry does not sanitize. Run your own policy (here the library's
  // default allowlist) before rendering it as an attribute; a chunk can
  // define `[evil]: javascript:alert(1)`.
  const href = defaultUrlTransform(def.url, 'href', { type: 'element', tagName: 'a', properties: {}, children: [] });
  return (
    <a href={href || undefined} title={def.title}>
      {label}
    </a>
  );
}
```

### `Registry` surface (read-only)

| Field/Method                                        | Returns                                        | Purpose                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `chunkOrder`                                        | `readonly symbol[]`                            | Mount-order chunk identifiers                                                                                                  |
| `chunkData`                                         | `ReadonlyMap<symbol, ChunkData>`               | Per-chunk refs/defs/linkDefs                                                                                                   |
| `labelSet`                                          | `{ footnoteLabels, linkLabels }` (ReadonlySet) | Union of own-def labels across chunks                                                                                          |
| `version`                                           | `number`                                       | Monotonic counter; bumped on every mutation                                                                                    |
| `subscribe(cb)`                                     | unsubscribe function                           | Wake-up on registry mutations                                                                                                  |
| `canonicalFootnoteFor(label)`                       | `symbol \| null`                               | Which chunk owns the canonical def for this footnote                                                                           |
| `canonicalLinkFor(label)`                           | `symbol \| null`                               | Same, for link defs                                                                                                            |
| `globalNumber(label)`                               | `number \| null`                               | Document-wide footnote number for a label                                                                                      |
| `resolveLinkDef(label)`                             | `LinkDef \| null`                              | Cross-chunk link definition lookup                                                                                             |
| `getRefsForLabel(label)`                            | `number`                                       | Count of **footnote** refs pointing at this label. Link/image refs aren't counted — there's no equivalent counter API for them |
| `globalOccurrenceForRef(chunkSym, label, localIdx)` | `number \| null`                               | Map a chunk-local ref occurrence to its document-wide index                                                                    |

Mutator methods (`registerChunk`, `allocateSymbol`, etc.) are intentionally **not** on the public `Registry` type. The renderer drives those internally; exposing them would let consumer code corrupt refcounts, version bumps, or numbering invariants.

### What's NOT exposed

A few internals are deliberately kept off the public surface — useful to know so you don't go looking for them:

- **Per-chunk `Symbol`** — every chunk allocates a unique `Symbol` to identify itself inside the registry. There's no hook to read your own chunk's symbol from a custom component. If you need chunk-scoped behavior, derive it from `useAIMarkdownDocument().documentId` (shared across chunks) plus your own scoping logic.
- **Per-chunk URL policy / cross-chunk URL sanitization context** — the cross-chunk placeholders run their own per-attribute `urlTransform` pass using each consuming chunk's `urlTransform` + `sanitizeSchema`. The mechanism is internal; you control behavior by passing those props to each `<AIMarkdown>`, not by hooking into the cross-chunk machinery.
- **Mutator methods on `Registry`** — see the note above. Only selectors and `subscribe` are public.

If you find yourself wanting one of these, the supported path is usually to drive the same behavior from the public surfaces (`documentId`, `metadata`, `urlTransform`, `sanitizeSchema`, the public `Registry` selectors). If that's genuinely insufficient, open an issue describing the use case.

### Reactively reading the registry

`Registry` is mutated outside React's render flow. To re-render a component when it changes, subscribe via `useSyncExternalStore`:

```tsx
import { useSyncExternalStore } from 'react';
import { useDocumentRegistry, type Registry } from '@ai-react-markdown/core';

function useRegistryVersion(registry: Registry | null): number {
  return useSyncExternalStore(
    (cb) => (registry ? registry.subscribe(cb) : () => {}),
    () => registry?.version ?? 0,
    () => registry?.version ?? 0
  );
}

function FootnoteCount({ documentId }: { documentId: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry); // re-render when version bumps
  return <span>{registry?.labelSet.footnoteLabels.size ?? 0} footnotes</span>;
}
```

### Recipe: backlink panel via `resolveLinkDef`

Renders a sidebar listing every cross-chunk link reference and its resolved URL — useful for "where do my citations point" inspection or building an attribution panel.

```tsx
import { useSyncExternalStore } from 'react';
import { useDocumentRegistry, defaultUrlTransform } from '@ai-react-markdown/core';

// urlTransform's third argument is the hast node; a minimal stand-in is fine.
const A_NODE = { type: 'element', tagName: 'a', properties: {}, children: [] } as const;

function BacklinkPanel({ documentId, labels }: { documentId: string; labels: string[] }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);

  if (!registry) return null;

  return (
    <aside>
      <h3>References</h3>
      <ul>
        {labels.map((label) => {
          const def = registry.resolveLinkDef(label);
          if (!def) return <li key={label}>{label} — unresolved</li>;
          // ⚠️ def.url is RAW — the registry stores destinations unsanitized
          // and the library's placeholders sanitize at render time. Do the
          // same here (correct key for the attribute you render) — see the
          // url-sanitization docs.
          const href = defaultUrlTransform(def.url, 'href', A_NODE);
          return (
            <li key={label}>
              <a href={href || undefined} title={def.title}>
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

### Recipe: per-label footnote-number badge

Renders the document-wide footnote number for a given label (e.g. show `[3]` next to a citation tooltip).

```tsx
function FootnoteBadge({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);
  const n = registry?.globalNumber(label) ?? null;
  return n === null ? null : <sup>[{n}]</sup>;
}
```

`globalNumber` resolves the document-wide ordinal across all chunks — so this badge stays consistent even if the same label is referenced multiple times in different chunks.

### Recipe: counting refs per label

`getRefsForLabel(label)` returns the **footnote** ref count across the document. Useful for a "this footnote is cited N times" indicator.

```tsx
function FootnoteUsage({ documentId, label }: { documentId: string; label: string }) {
  const registry = useDocumentRegistry(documentId);
  useRegistryVersion(registry);
  const n = registry?.getRefsForLabel(label) ?? 0;
  return <span>{n === 0 ? 'unused' : `cited ${n}×`}</span>;
}
```

Link/image refs have no equivalent counter API — derive that yourself from `registry.chunkData` if you need it.

---

## Streaming patterns

The two cross-document patterns are also named in [Streaming chat: end-to-end](./streaming-chat-example.md) and [Streaming & performance](./streaming-and-performance.md) — same `Approach A` / `Approach B`, in the same direction (A = growing, B = chunked). The cross-chunk doc leads with B because that's the pattern that actually needs coordination.

### Approach B: one `<AIMarkdown>` per network chunk (chunked)

```tsx
function StreamedMessage({ chunks, id, done }: { chunks: string[]; id: string; done: boolean }) {
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk, i) => (
        <AIMarkdown key={i} content={chunk} documentId={id} streaming={!done && i === chunks.length - 1} />
      ))}
    </AIMarkdownDocuments>
  );
}
```

Only the **last** chunk's `streaming` is true. Earlier chunks are finalized.

### Approach A: re-rendering the same `<AIMarkdown>` with growing content

```tsx
function GrowingMessage({ content, done }: { content: string; done: boolean }) {
  return <AIMarkdown content={content} streaming={!done} />;
}
```

No wrapper needed — there's only one instance. Block-level memoization minimizes re-render work; the entire document is one logical chunk. This is the **simpler** pattern when you control content assembly upstream.

### Variant: hybrid (chunked + virtualization)

Use any virtualization library you already have — `react-window`, `@tanstack/react-virtual`, etc. The shape that matters is "list of chunks mounted/unmounted on demand, wrapped in a single `<AIMarkdownDocuments>`":

```tsx
// Example using @tanstack/react-virtual — substitute your own virtualizer.
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

function VirtualizedDoc({ chunks, id }: { chunks: string[]; id: string }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
  });

  return (
    <AIMarkdownDocuments>
      <div ref={parentRef} style={{ height: '100vh', overflow: 'auto' }}>
        {rowVirtualizer.getVirtualItems().map((row) => (
          <div key={row.key} style={{ transform: `translateY(${row.start}px)` }}>
            <AIMarkdown content={chunks[row.index]} documentId={id} />
          </div>
        ))}
      </div>
    </AIMarkdownDocuments>
  );
}
```

Useful for very long documents where mounting/unmounting chunks via virtualization is desirable. The registry handles chunks coming and going (mount allocates a symbol, unmount releases it; the aggregate footer follows the current last chunk).

**Order caveat.** The registry orders chunks by _registration_ order, and both footnote numbering and the "last chunk" (which renders the aggregate footer) follow that order. By default registration order is **mount** order, which is correct as long as each chunk mounts once, in document order. A chunk that unmounts and later remounts — scrolled out of a virtualizer's window and back, or given a new React key — is otherwise released and re-registered at the **end**: footnotes renumber document-wide and the aggregate footer moves to that chunk's tail, i.e. visually into the middle of the document. Pass **`documentIndex`** (any stable per-chunk ordinal, e.g. the message's index in your list) and the registry keeps chunks sorted by it instead, so mount order stops mattering: `<AIMarkdown documentId={id} documentIndex={i} …/>`. The prop is optional — omit it and the historical mount-order behaviour is unchanged. Chunks that supply an index sort ahead of chunks that do not (those keep mount order among themselves), so a partial rollout degrades predictably rather than interleaving.

---

## Lifecycle: how chunks register with the registry

1. **Mount** — each `<AIMarkdown>` calls `registry.registerChunk(reactId, footnoteLabels, linkLabels)`, which allocates a `Symbol` and contributes its own def labels.
2. **Render** — `chunkData` for this chunk gets refs/defs/linkDefs from the parsed mdast.
3. **Re-render** — on every content change, `contributeChunkData` overwrites the chunk's entry.
4. **Unmount** — `releaseSymbol` synchronously decrements the chunk's refcount. When refcount reaches `0`, it schedules a microtask cleanup that re-checks the refcount before actually deleting the chunk's state. A same-frame remount increments the refcount back to `1` before the cleanup runs, so the symbol survives Strict Mode's double-mount.
5. **Last chunk unmounts** — registry's `onEmpty` callback evicts the registry from the wrapper's `Map<documentId, Registry>`. The next mount with the same id allocates a fresh registry — which is the right behavior because the consumer is genuinely starting over.

The microtask deferral is **the** subtle part. React 19's Strict Mode mounts each component twice in development. A naive unmount-then-mount would release and re-allocate the symbol, causing footnote numbers to flicker. The deferral lets the re-mount cancel the release before it commits.

### Server rendering and the first client frame

Steps 1–3 run in effects, so on the server (and in the client's first render before effects) the registry exists but is **empty**. In that state every chunk renders with **standalone semantics** — its own footnote numbering (mark and local footer agree, byte-identical to rendering the chunk outside the wrapper), its own reference-style links and images resolved from its own definitions. Cross-chunk references — a `[^label]` or `[text][label]` whose definition lives in another chunk — cannot be resolved without the registry and render as literal text until the chunks have registered. Once the contribute effects run, marks switch to document-wide numbering, links resolve to the canonical (first-defining) chunk, and the aggregate footer replaces the local ones. Hydration is mismatch-free: the client's first frame reproduces the server's standalone output before switching.

---

## Footguns

### Forgetting to share `documentId` across chunks

```tsx
// ⚠️ Each chunk auto-generates its own id → no coordination.
<AIMarkdownDocuments>
  {chunks.map((c, i) => <AIMarkdown key={i} content={c} />)}
</AIMarkdownDocuments>

// ✅ Share the id.
<AIMarkdownDocuments>
  {chunks.map((c, i) => <AIMarkdown key={i} content={c} documentId={messageId} />)}
</AIMarkdownDocuments>
```

### Sharing `documentId` _without_ the wrapper

```tsx
// ⚠️ Same documentId across instances, but no <AIMarkdownDocuments> → references still don't coordinate.
{
  chunks.map((c, i) => <AIMarkdown key={i} content={c} documentId={messageId} />);
}
```

The wrapper is what binds chunks together. The id alone only aligns ids — it doesn't share a registry.

### Mutating registry-returned objects

```tsx
// ⚠️ Mutating a returned LinkDef.
const def = registry?.resolveLinkDef('docs');
if (def) def.url = '...'; // shared across all consumers; corrupts other components

// ✅ Treat registry-returned data as read-only.
const def = registry?.resolveLinkDef('docs');
const myUrl = def?.url; // read only
```

The TypeScript types are `readonly` where it matters, but JavaScript doesn't enforce that at runtime.

### Expecting `Registry` to update _during_ a render

The registry is mutated by chunk mount/render effects, which happen **after** the render that triggered them commits. A component that reads `registry.canonicalFootnoteFor(label)` during its first render may see `null` even though the def exists — because the def-contributing chunk's effect hasn't fired yet. Subscribe via `useSyncExternalStore` (as shown above) to re-render when the registry settles.

### Using a non-stable `documentId`

```tsx
// ⚠️ A new id every render → registries pile up.
<AIMarkdown content={c} documentId={`msg-${Date.now()}`} />

// ✅ Stable id per logical document.
<AIMarkdown content={c} documentId={message.id} />
```

The wrapper does evict empty registries, but the perf cost of allocate/teardown on every render is real and the `version` bumps would saturate any subscribed component.

### Nesting `<AIMarkdownDocuments>`

Already covered above — dev throws, prod degrades. Don't.
