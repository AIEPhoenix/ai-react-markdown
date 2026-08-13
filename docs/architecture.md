# Architecture Overview

A mental model of how `<AIMarkdown>` turns a markdown string into rendered React — and why it's structured the way it is. Read this when:

- You're debugging an unexpected render result.
- You're considering writing a custom remark/rehype plugin and want to know where it would go.
- You want to understand what `<AIMarkdownDocuments>` actually coordinates.
- You're contributing to the library.

---

## The component tree

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          ← Context for opaque user metadata
    <AIMarkdownProvider>                ← Four per-system contexts: document / state / theme / behaviors
      <Typography>                      ← Configurable wrapper (default | Mantine | custom)
        <ExtraStyles?>                  ← Optional CSS-scope wrapper
          <AIMarkdownContent>           ← The actual markdown renderer
            ↳ react-markdown (vendored) with remark/rehype pipeline
            ↳ block-level memoization
            ↳ cross-chunk placeholder resolution
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

Each layer has a single, documented responsibility:

| Layer                          | Responsibility                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `<AIMarkdown>`                 | Single-point flat-prop resolution against shipped defaults, preprocessing pipeline orchestration, the stability firewall            |
| `<AIMarkdownMetadataProvider>` | Isolate opaque user data from the render-facing contexts                                                                            |
| `<AIMarkdownProvider>`         | Hold the resolved document/state/theme/behaviors payloads (four contexts; state and behaviors merge outer additive-Provider groups) |
| `<Typography>`                 | Apply font-family, base font-size, theme class names; inject CSS custom properties via `style`                                      |
| `<ExtraStyles>`                | Optional CSS-scope wrapper (used by Mantine integration for em-based token overrides)                                               |
| `<AIMarkdownContent>`          | Vendor-forked react-markdown pipeline + block memoization + cross-chunk resolution                                                  |

---

## Why five contexts?

The resolved values are split into five per-system contexts — document, metadata, state, theme, behaviors — each with its own narrow hook (`useAIMarkdownDocument()`, `useAIMarkdownMetadata()`, `useAIMarkdownState()`, `useAIMarkdownTheme()`, `useAIMarkdownBehaviors()`), plus the aggregate `useAIMarkdown()` that subscribes to all five.

The split matches change frequency. **Metadata** (user callbacks, ids, app-level data) typically rebuilds every render — a parent rebuilding `metadata={{ onCopy, messageId }}` is normal React usage — so it lives alone and the markdown body doesn't subscribe to it. **`streaming`** is the most frequently flipping field in the library, so it lives in the state context and a flip wakes only `useAIMarkdownState()` subscribers. Theme values, behavior switches, and document identity change rarely and don't ride along with either.

If everything lived in one context (the v1.x render-state design), every metadata change or `streaming` flip would re-render every consumer. With the split, components re-render only when their own system changes, and block-level memoization stays effective.

See [Metadata Context](./metadata-context.md) for the consumer-side implications.

---

## The render pipeline

`<AIMarkdownContent>` is where the heavy lifting happens. Per render:

```text
content (string)
  │
  ▼
Stage A: contentPreprocessors
  ├── Built-in LaTeX normalizer (preprocessLaTeX)
  └── User-supplied preprocessors (in order)
  │
  ▼
Stage B: parse (mdast + hast)
  ├── unified.parse → mdast
  ├── remark plugins (GFM, math, breaks, emoji, pangu, smartypants, …)
  └── remark-rehype + custom mdast handlers → hast
  │
  ▼
Stage C: cross-chunk contributions (if inside <AIMarkdownDocuments>)
  ├── Extract this chunk's refs/defs
  └── Push to Registry (registerChunk)
  │
  ▼
Stage D: block planning
  ├── Walk hast top-level children
  ├── Build per-block BlockInfo (raw, position, taint, ctx digest)
  └── Compute globalCtx digest from ref/def contributors
  │
  ▼
Stage E: per-block render with cache lookup
  ├── For each block:
  │   ├── Cache key = (raw, occurrence, ctx, startOffset, startLine)
  │   ├── Cache hit → return cached ReactNode
  │   └── Cache miss → toJsxRuntime(block hast) + memoize result
  └── Concatenate ReactNodes
  │
  ▼
Stage F: per-attribute URL transform
  └── urlTransform (Gate 2)
       — rewrites every URL-bearing attribute at render time;
         schema-level allowlist (Gate 1, rehype-sanitize) ran
         earlier in Stage B's rehype chain
  │
  ▼
React renders
```

### Stage A: Content preprocessing

The LaTeX preprocessor is built-in and always first. It does **string-level** transforms — normalize `\(…\)` to `$…$`, escape `|` inside math, recognize currency `$` vs math `$`, truncate unclosed `$$` blocks for streaming safety. See [Content Preprocessors](./content-preprocessors.md) for full details.

User preprocessors run next, in order. They receive the LaTeX-normalized string.

### Stage B: Parse

`unified.parse` produces an mdast (Markdown AST). remark plugins (GFM, math, breaks, emoji, pangu, smartypants, mark-highlight, etc., gated on the resolved `enginePlugins` selection) run on mdast. Then `remark-rehype` converts to hast (HTML AST) using custom mdast handlers that:

- Inject phantom footnote definitions (when `preserveOrphanReferences` is on and no matching `[^x]` exists, so `mdast-util-to-hast` doesn't silently drop the def).
- Emit cross-chunk placeholder elements (`<cross-chunk-link>`, `<cross-chunk-image>`, `<footnote-sup>`) when wrapped in `<AIMarkdownDocuments>`.

The rehype plugin chain then runs on hast — including `rehype-raw` (for raw HTML survival), `rehype-katex` (for math rendering), and **`rehype-sanitize`** (Gate 1 of URL sanitization: per-protocol allowlist applied to `href`/`src`/`cite`). Per-attribute URL rewriting (`urlTransform`, Gate 2) is _not_ part of this chain — it runs later at render time (see Stage F).

### Stage C: Cross-chunk contributions

When inside `<AIMarkdownDocuments>`, each chunk reports its refs and defs to the shared `Registry`. The registry tracks chunk symbols by `useId()` reactId, with refcount + microtask-deferred cleanup for Strict Mode safety. See [Cross-chunk Coordination](./cross-chunk-coordination.md) for the full lifecycle.

### Stage D: Block planning

`buildBlocks` cuts the hast into per-block units — each top-level hast child that has an mdast counterpart, plus an optional synthetic footnote section.

For each block, the planner computes:

- `raw` — source text of the block.
- `startOffset`, `startLine`, `endOffset` — position metadata, used in the cache key so identical text at different positions doesn't collide.
- `tainted` — whether the block contains footnote/link/image references or definitions.
- `ctx` digest — the document-wide hash of all ref/def contributions. Used to invalidate tainted blocks when refs/defs change anywhere in the document.

### Stage E: Per-block render + memoization

For each block, the renderer either:

- **Hits the cache** — returns the previously-computed `ReactNode` (zero work).
- **Misses the cache** — calls `toJsxRuntime` on the block's hast, stores the result, returns it.

The cache lives in a `useRef`-backed Map. Eviction: when a block doesn't appear in a new plan (block was removed), it's dropped on the next pass. The cache is per-`<AIMarkdown>` instance; cross-chunk coordination uses a separate Registry (which itself caches selectors by version).

### Stage F: Per-attribute URL transform

Only **Gate 2** (`urlTransform`) runs in this stage — a per-attribute rewriter applied during the hast traversal in `renderHastSubtree`. Gate 1 (`rehype-sanitize` schema, per-protocol allowlist) has already run earlier in Stage B as part of the rehype plugin chain. See [URL Sanitization & Custom Schemes](./url-sanitization.md) for the full model.

---

## `documentId` and clobber prefix

Markdown footnotes and hash links emit `<li id="…">` and `<a href="#…">` with auto-generated ids. Without namespacing, two `<AIMarkdown>` instances on the same page would collide:

```html
<!-- Message 1 -->
<a href="#user-content-fn-1">[1]</a>
<li id="user-content-fn-1">…definition A…</li>

<!-- Message 2 -->
<a href="#user-content-fn-1">[1]</a>
<!-- ← scrolls to message 1's footnote! -->
<li id="user-content-fn-1">…definition B…</li>
```

The fix: prefix every clobberable attribute with a per-document namespace. `<AIMarkdown>` accepts `documentId` (or generates one via `useId()`) and derives `clobberPrefix` from it:

```ts
clobberPrefix = `${encodeURIComponent(shortenDocumentId(documentId))}-user-content-`;
```

Long ids (>16 chars) are hashed via MurmurHash3 → Base62 before encoding, to keep the rendered HTML compact when consumers pass UUIDs/nanoids. The shortening only affects the rendered prefix — `state.documentId` retains the raw value, so registry keying and consumer code reading `documentId` see the original. Ill-formed UTF-16 ids (unpaired surrogates, e.g. from a string truncated mid-emoji upstream) are always hashed regardless of length — over their raw UTF-16 code units with a domain-separating seed — so they derive a valid prefix instead of throwing `URIError`, and distinct corrupted ids keep distinct prefixes (up to the same 2^32 hash bound long ids always had). The raw value in `state.documentId` is still untouched, and dev builds log a warning pointing at the upstream corruption.

**Chunks of the same logical document share `documentId`**, so their prefixes align. This is the bridge between [`<AIMarkdownDocuments>`](./cross-chunk-coordination.md) and cross-chunk anchor navigation.

---

## The cross-chunk registry

Located at `packages/engine/src/components/documentRegistry.ts` (framework-agnostic; core re-exports its public types). Key invariants:

1. **Per-`documentId` partitioning**. The wrapper holds a `Map<documentId, Registry>`. Each unique id gets its own registry.
2. **Symbol-keyed contributions**. Each chunk allocates a `Symbol(reactId)` on mount and contributes to the registry under that symbol. The symbol is the chunk's identity for the registry's lifetime.
3. **Refcount + microtask cleanup**. `releaseSymbol` decrements a refcount and schedules deletion via `queueMicrotask`. This survives React 19 Strict Mode (mount → unmount → mount within a frame) without losing the chunk's identity.
4. **Monotonic version counter**. Every mutation bumps `version`; subscribers wake via microtask-coalesced fanout.
5. **labelSet derivation**. `labelSet.{footnoteLabels, linkLabels}` is the union of own-def labels across all live chunks. Used by Stage B's phantom-def injection to know which orphan refs to protect.
6. **Last-chunk eviction**. When the final chunk releases its symbol and the registry becomes empty, an `onEmpty` callback fires, removing the registry from the wrapper's Map. The next mount with the same id allocates a fresh registry.

The `Registry` interface exposes only read methods + selectors. Mutators (`registerChunk`, `allocateSymbol`, `releaseSymbol`, `contributeLabels`, `contributeChunkData`) live on the internal `RegistryInternal` interface, which is **not** re-exported from the package barrel. Consumer code can't directly drive the registry — only the renderer can.

---

## Block memoization invariants

Located at `packages/core/src/components/blockMemo.ts`. The invariants:

1. **`buildBlocks` is hast-driven, not mdast-driven.** Hast top-level children that have an mdast counterpart become blocks 1:1. Mdast-only nodes (e.g. metadata) don't produce blocks.
2. **Two-tier offset lookup**. Position metadata (`startOffset`, `startLine`) goes into the cache key so identical content at different positions doesn't false-cache.
3. **Swap-and-discard semantics**. The plan is rebuilt every render; the prior cache is consulted by key, then discarded blocks are dropped.
4. **Synchronous G3 flush at 12-dep boundary**. (Internal invariant about plan-context invalidation timing.)
5. **`globalCtx` is the union of ref/def contributors.** Tainted blocks include this in their cache key.

These invariants are enforced by tests (`byteEquivalence.test.tsx` is the harness that verifies byte-identical output across every plugin permutation and `blockMemo` on/off).

If you're touching `blockMemo.ts` or `MarkdownContent.tsx`, read the design document at the top of `blockMemo.ts` first.

---

## Sanitization architecture

The library default schema starts from `rehype-sanitize`'s `defaultSchema` and extends it with three additions:

- `<mark>` tag + class allowlist (for `==highlight==`).
- `math-inline` and `math-display` classes on `<code>` (the markers `remark-math` emits before `rehype-katex` consumes them). KaTeX's own output classes (`katex`, `katex-html`, …) are not in this allowlist — they survive because `rehype-katex` runs after `rehype-sanitize` in the rehype chain.
- Cross-chunk coordination tags: `cross-chunk-link`, `cross-chunk-image`, `footnote-sup`.

Hand-rolling a schema via `{ ...defaultSchema, … }` silently drops these. `extendSanitizeSchema` always works on a deep clone of the **library**'s default (not `rehype-sanitize`'s), so the additions survive.

The library default is **not** exported as a value — only the helper. This prevents the shallow-spread footgun by construction: there's no `sanitizeSchema` constant in the public API to shallow-spread _from_.

See [URL Sanitization & Custom Schemes](./url-sanitization.md) for the two-gate model.

---

## The Mantine integration

`@ai-react-markdown/mantine` is a thin wrapper that:

1. Ships the `codeBlock` behavior group (`{defaultExpanded, autoDetectUnknownLanguage}`) — contributed through the additive `AIMarkdownBehaviorsProvider`, read via `useMantineCodeBlockOptions()`.
2. Provides `MantineAIMarkdownTypography` (uses Mantine's `<Typography>`).
3. Provides `MantineAIMDefaultExtraStyles` (CSS scoping for em-based Mantine token overrides).
4. Overrides `customComponents.pre` with `MantineAIMPreCode` (CodeHighlight + Mermaid + JSON pretty-print).
5. Auto-detects color scheme via Mantine's `useComputedColorScheme`.

Every one of these uses **public** extension points from core. No internal access. See [Extending via a Sub-package](./extending-via-subpackage.md) for the template.

---

## React 19 specifics

- `useId()` powers the auto-generated `documentId` — SSR-safe, stable across re-renders, distinct per component instance.
- React 19's Strict Mode double-mount semantics are handled by the microtask-deferred cleanup in `documentRegistry` (releaseSymbol → microtask → identity check → maybe delete).
- The library doesn't use any React 19-only Hooks beyond `useId`. React 19's `use()` is not yet leveraged.

---

## Why a vendored `react-markdown`?

The library imports `react-markdown` as an internal module, split along the engine boundary: the pure pipeline half (processor, transform, the parse/transform stages) lives in `packages/engine/src/components/markdown/`, and the React half (`renderHastSubtree`, the `<Markdown>` component) stays in `packages/core/src/components/markdown/`. This is a _vendor fork_, not a redistribution — the source is bundled and adapted for the library's needs:

- Block-level memoization needs control over the conversion stage (`toJsxRuntime`) that the upstream component encapsulates.
- The pipeline is exposed as **three independent stages** (parse, plan, render) so block memoization can intercept between stages.
- Cross-chunk placeholder elements need custom handlers in the mdast → hast conversion that aren't available on the upstream component.

The fork is intentional and the surface area is small. Consumers don't need to install `react-markdown` themselves — the library's wrapper is the only required dependency.

---

## Module layout

```text
packages/engine/src/                ← @ai-react-markdown/engine (framework-agnostic)
├── index.ts                    ← entry barrel (internal supplier for core)
├── plugins/
│   ├── catalog.ts              ← the five sealed engine plugins + defaultEnginePlugins
│   └── defs.ts                 ← AIMarkdownEnginePlugin type + seal brand
├── preprocessors/
│   ├── index.ts                ← preprocessing pipeline orchestrator
│   ├── defs.ts                 ← AIMDContentPreprocessor type
│   ├── latex.ts                ← built-in LaTeX normalizer
│   └── remend.ts               ← remend streaming-repair preprocessor
├── fixtures/                   ← shared streaming payload fixtures (tests + stories)
├── experiments/prefixFreeze/   ← freeze-boundary measurement study
└── components/
    ├── incrementalParse/       ← splice engine + arbiter harness + fuzz batteries
    ├── markdown/               ← pure pipeline half of the vendored react-markdown
    │                             (processor, transform, parse/transform stages)
    ├── smoothStream/controller.ts ← framework-agnostic pacing controller
    ├── pluginChain.ts          ← remark/rehype chain assembly
    ├── collectDefLabels.ts     ← def-label scanner
    ├── extractDefBodiesFromHast.ts / extractContributions.ts
    ├── documentRegistry.ts     ← cross-chunk shared state (pure data structure)
    ├── sanitizeSchema.ts       ← library default schema
    ├── extendSanitizeSchema.ts ← public schema-extension helper
    ├── crossChunkUrlSanitize.ts ← cross-chunk URL filter
    ├── customMdastHandlers.ts  ← mdast → hast handlers (phantom defs, footnote sup, …)
    ├── rehypeRebaseHashLinks.ts / rehypeFooterAdorn.ts
    ├── remarkInjectPhantomDefs.ts
    ├── hastPredicates.ts       ← shared hast detection helpers
    ├── normalizeId.ts / shortenDocumentId.ts / devStageTimings.ts
    └── …
```

```text
packages/core/src/                  ← @ai-react-markdown/core (React)
├── index.tsx                   ← <AIMarkdown> + public API re-exports
├── defs.ts                     ← prop payload types, variant/scheme types
├── resolveFlatProps.ts         ← single-point flat-prop resolution vs shipped defaults
├── context.tsx                 ← five contexts + narrow hooks + additive Providers
├── define.ts                   ← defineTheme / defineBehaviors / definePipeline factories
├── plugins/index.ts            ← /plugins subpath (re-exports the engine catalog)
├── hooks/
│   ├── useStableRecord.ts      ← stability firewall (table-driven, policy per prop)
│   ├── useStableValue.ts       ← deep-equal reference stabilizer
│   └── useReferenceFlipWarning.ts ← dev-only identity-flip detector
├── components/
│   ├── MarkdownContent.tsx     ← the actual markdown renderer
│   ├── markdown/               ← React half of the vendored react-markdown
│   │                             (renderHastSubtree, <Markdown>)
│   ├── typography/             ← default typography variant
│   ├── blockMemo.ts            ← block-level memoization
│   ├── AIMarkdownDocuments.tsx ← cross-chunk wrapper (React shell over the registry)
│   ├── crossChunkPlaceholders.tsx ← placeholder element renderers
│   ├── streamingCursor/        ← streaming cursor feature
│   └── smoothStream/           ← useSmoothStream / useDocumentSmoothStream / coordinator
└── typings/                    ← ambient type shims
```

```text
packages/mantine/src/
├── index.tsx                   ← barrel
├── defs.tsx                    ← codeBlock group type + shipped defaults, metadata type
├── define.ts                   ← defineMantineBehaviors (widened factory)
├── MantineAIMarkdown.tsx       ← wrapper component (firewall + behaviors Provider)
├── components/
│   ├── typography/
│   │   └── MantineTypography.tsx
│   ├── extra-styles/
│   │   └── DefaultExtraStyles.tsx
│   └── customized/
│       └── PreCode.tsx          ← CodeHighlight + Mermaid + JSON
└── hooks/
    ├── useMantineCodeBlockOptions.ts
    └── useMantineAIMarkdownMetadata.ts
```

The trail of file names is intentionally descriptive — when you're debugging or extending, grep is your friend.
