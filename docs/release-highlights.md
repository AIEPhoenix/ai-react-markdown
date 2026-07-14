# Release Highlights

A distilled, human-readable summary of what's notable in each version — extracted from the commit log and organized by theme rather than chronology. For the full commit history, see `git log` or the [GitHub releases page](https://github.com/AIEPhoenix/ai-react-markdown/releases).

> Headings follow semver: minor versions introduce new features or non-breaking refinements; patches fix bugs or document existing behavior.

---

## 1.6.x — Incremental parsing

### 1.6.0 — Experimental prefix-freeze parsing for streaming

- New `config.incrementalParseEnabled` (default `false`, requires `blockMemoEnabled`): during append-only streaming, the renderer freezes the stable prefix of the document at a verified-safe boundary, re-parses only the tail, and splices the previous frame's mdast/hast with the tail's — cutting the per-frame parse/transform cost to roughly the tail's share (~70–89% less stage time on the benchmark payloads; the freeze boundary covers ~73–87% of realistic LLM output). Block-memo cache keys are position-based, so the two optimizations compose: frozen blocks stay cache hits.
- Safety is falsified, not assumed: a splice-equivalence suite asserts the spliced trees are deep-equal (positions included) to a full parse, per streaming frame, across the plugin-permutation catalog and adversarial fixtures (loose lists, rehype-raw swallow containers, open `$$` math, late reference/footnote definitions, definition-list term claims, Unicode case-folded labels, CRLF). A Storybook play test additionally pins the live-DOM equality of flag-on vs flag-off streams in a real browser.
- Every frame re-checks a gate chain and silently falls back to the ordinary full parse when it can't prove safety: cross-chunk (`<AIMarkdownDocuments>`) mode, any `[^` in the content (single-doc footnote numbering is parse-local), non-append content changes, or no freeze-safe boundary yet. SSR always takes the full path. See the new "Incremental parse (prefix-freeze)" section in `docs/streaming-and-performance.md`.
- Dev stage telemetry gains an `ai-markdown:stage:scan` measure (the boundary detector), and `parse`/`transform` now report tail-only time when a frame spliced. The `BlockMemoComparison` benchmark story gains an `incremental` toggle on the block-memo side.
- Hardened before release by a recall-biased multi-angle review plus a same-day polishing pass: six probe-confirmed detector corners closed (indented-code merges, def-shaped continuation lines, blockquote-nested definitions, mid-line `$$`, backtick-bearing fence info strings, html block types 3–5) and every one turned into a permanent arbiter fixture; the footnote bypass became fence/code-span aware and sticky; the detector gained checkpoint incremental scanning (scan stage 9→4 ms at 4×, 84→13 ms at 16×) with a resume-vs-fresh equivalence property test; the plugin chain was single-sourced (`pluginChain.ts`) with a directional consistency pin against the experiment record; and `docs/benchmark.md` ships recalibrated real-browser numbers (84%/94% pipeline savings, boost p50 32→7.5 ms — unchanged by the hardening).
- Storybook gains a full comparison matrix: `IncrementalParseCompare`, `BoostCompare` (everything-on vs legacy), their process-isolated variants, and a `VerificationPlayground` with a live freeze-boundary bar — each same-page comparison carries a per-frame DOM-equality verifier (clobber prefixes normalized).
- The measurement study behind the design ships as `packages/core/src/experiments/prefixFreeze/` (ablation ladder L0–L4 with falsification tables — including why the double-blank-line rule that inspired this feature freezes 0% of typical single-blank LLM output).

## 1.5.x — Mantine 9

### 1.5.1 — Streaming robustness: raw-HTML swallow and mermaid lifecycle

- Core's block-memo cache no longer freezes stale content when a streaming document contains an unclosed raw-HTML container (`<details>` before its `</details>` arrives — but any container tag qualifies). rehype-raw's HTML parsing reparents every following sibling into the open container, including the synthetic footnote section, while the block's source-level cache identity stays byte-identical; the first swallowed snapshot used to become a permanent cache hit, leaving a duplicated footnote section trapped inside the container and freezing trailing content mid-stream. Raw-HTML blocks now carry a structural digest of their rendered subtree, so the cache invalidates exactly while swallowing is in effect and recovers in one frame once the close tag lands. Markdown-native blocks skip the digest walk entirely — no new per-frame cost on large deterministic subtrees like KaTeX output.
- `@ai-react-markdown/mantine`'s mermaid renderer is now streaming-aware. While `streaming` is true, parse failures on truncated code are silent: the raw source shows as a plain code block until the first prefix parses, then the last good SVG stays up and refreshes on each subsequent success — no more "Mermaid Render Error" flashes mid-stream. When streaming ends, one corrective pass runs on the final code; its failure is the only one allowed to replace a rendered diagram. A `streaming` false→true edge is treated as a new generation (chat "regenerate" reuses the same component instance) and resets the warm-up state, so a new stream never shows the previous generation's stale diagram or error tab. Static (non-streaming) rendering keeps the original conservative rule: a rendered diagram is never clobbered by a later transient failure.
- `mermaid.render` no longer receives the host element: the host is hidden during warm-up, and `display: none` zeroes mermaid's getBBox text measurement — one-shot static renders came out as ~16px SVGs. Rendering through mermaid's own body-temp path decouples measurement from container visibility; `suppressErrorRendering` additionally keeps mermaid's temp nodes from accumulating in `document.body` when a draw-phase error slips past `parse`.
- Storybook gains a `Mantine/MantineAIMarkdown → Streaming` story that streams a mermaid-heavy document token by token; `content` is a control, so arbitrary markdown can be streamed for eyeballing.

### 1.5.0 — `@ai-react-markdown/mantine` moves to Mantine 9

- `@ai-react-markdown/mantine` now requires `@mantine/core` and `@mantine/code-highlight` `^9.0.0` as peers (tested against 9.4.1). No API changes on our side — the package's surface survives every Mantine 9 breaking change untouched. Consumers inherit Mantine 9's defaults: `md` (8px) default radius, solid light-variant colors (Mantine's `v8CssVariablesResolver` restores the 8.x look), and a React 19.2 floor.
- If you install `@mantine/hooks` yourself, note that `@mantine/core@9` pins its hooks peer to the exact matching version — keep the three `@mantine/*` packages on one version.
- Core is unchanged in behavior. One internal type adaptation for `@types/hast` ≥3.0.5: the aggregated footnote footer's `<li>` numbering is now stored as a string in hast (`value: "3"` instead of `value: 3`) — the rendered DOM is byte-identical.
- Core's optional `katex` peer widens to `^0.16.0 || ^0.17.0`. The range previously excluded 0.17 (a `^0.16.0` range does not match 0.17 under 0.x semver), so npm users on katex 0.17 hit spurious `ERESOLVE` conflicts — even though the library is continuously tested against 0.17.

## 1.4.x — Customization surface hardening

The 1.4 line opened up the customization surface (URL sanitization, document namespacing, design tokens) and put guardrails around it so consumers can extend safely.

### 1.4.9 — Dual dev/prod builds; streaming re-parse eliminated

- The package now ships separate development and production builds behind the `development` exports condition, and the published files contain no `process.env` reads at all — consumers without a bundler (import maps, plain `<script type="module">`, CDN ESM) no longer crash on `process is not defined`. A post-build assertion keeps the dist permanently free of env reads. See the README's "Development vs production builds" section for the SSR and Jest footguns that come with conditional exports.
- Streaming no longer pays a second full markdown parse per token. Standalone chunks skip the definition-label scan entirely; coordinated chunks (`documentId` under `<AIMarkdownDocuments>`) gate it behind an append-aware scanner that re-scans only the region since the last blank line, and only when a line-start `[` could introduce a new definition. The label set keeps its object identity when unchanged, so per-token re-registration and downstream memo invalidation stop too.
- `urlTransform` application is now convergent: original URLs are stashed on first transform and every pass recomputes from the original, so a memoized (re-entered) hast tree can never be double-transformed. Internal defensive tree clones are skipped when the tree is caller-owned — the common path allocates nothing.
- Development builds emit per-stage `performance.measure` entries (`ai-markdown:stage:parse|transform|build|render`) for pipeline profiling in the DevTools Performance panel; production builds compile the entire gate away.

### 1.4.8 — Automated GitHub releases

- Pushing a `v*` tag now also publishes the matching GitHub release, with notes lifted from this file's section for that version (falling back to auto-generated notes). The npm publish and the GitHub release are a single CI step away from one tag push. No library runtime changes.

### 1.4.7 — Dev-mode diagnostics; provenance-attested publishing

- A footnote id with malformed percent-encoding now logs a development-mode warning instead of degrading silently (the aggregated footer renders an empty entry for that label — previously with no signal as to why).
- First release published via npm trusted publishing (OIDC): both tarballs carry provenance attestation linking them to the exact source commit and CI run. No npm token exists anywhere in the pipeline.
- `@ai-react-markdown/mantine` gained an SSR smoke-test suite and a typecheck gate in CI (no runtime changes).

### 1.4.6 — Cross-chunk registry gated on explicit `documentId`

- Cross-chunk coordination now activates only when the consumer passes `documentId` explicitly. Previously an omitted `documentId` was defaulted to `useId()` before reaching `useDocumentRegistry`, so a standalone chunk wrapped in `<AIMarkdownDocuments>` wrongly took the coordination path — and a stray raw placeholder tag in such a chunk could open an orphan registry shell that was never evicted (no paired `registerChunk`).
- `documentId` is now resolved at a single point (the render-state provider), which threads a `documentIdExplicit` flag through state to `useDocumentRegistry` and the placeholder components. `AIMarkdownRenderState.documentIdExplicit` is optional for 1.x compatibility.

### 1.4.5 — Token surface for `default` variant

- Spacing, font-size, and heading tokens in the default variant now consume `--aim-font-size-root`. Changing the `fontSize` prop proportionally scales every dimension — no per-token override needed for size-coherent themes.
- New customization tokens: `--aim-font-weight-strong` (shared by all headings + `<th>`, default `700`) and `--aim-katex-font-size` (defaults to `--aim-font-size-root` so math stays at component-root size regardless of parent context).

> See [Design Tokens](./design-tokens.md) for the full token surface.

### 1.4.4 — Cross-chunk URL XSS sealed; public surface narrowed

- Cross-chunk link/image references now run a **second** per-attribute sanitization pass at render time. Previously, a permissive `urlTransform` in one chunk could leak `javascript:`/`data:` URLs into another chunk that defined them, bypassing the consuming chunk's policy. Now every consumer applies its own gates independently — defense-in-depth across chunk boundaries.
- The `Registry` type exposed via `useDocumentRegistry` is narrowed to a read-only surface. Mutator methods (`registerChunk`, `allocateSymbol`, `releaseSymbol`, …) are no longer part of the public type, so consumer code can't accidentally corrupt refcounts or numbering invariants.
- `sanitizeSchema`'s public type tightening — pairs with the read-only `Registry` narrowing.

### 1.4.3 — `urlTransform` + `sanitizeSchema` documented

- Comprehensive JSDoc on both props: reference-stability requirements, composition with `defaultUrlTransform`, regex-escaping for scheme names (`/^web\+app:/i` vs the silent broadening of `/^web+app:/i`), and the asymmetric stability model (function identity vs deep-equal data).

### 1.4.2 — Long `documentId` shortening

- `documentId` values >16 chars (UUIDs, nanoids) are hashed via MurmurHash3 → Base62 down to ≤6 chars **inside the rendered `id="…"` / `href="#…"` prefix only**. State (`state.documentId`) and registry keying use the raw value, so deep linking and `useDocumentRegistry(documentId)` are unaffected. Pure rendered-HTML compactness win.

### 1.4.1 — Mantine README + package metadata

- Mantine package README fleshed out with code-highlight adapter setup, Mermaid features, color-scheme integration, and the full Mantine-extended config table.

### 1.4.0 — `urlTransform` + `sanitizeSchema` props exposed

- New props on `<AIMarkdown>` for the two-gate sanitization model.
- `extendSanitizeSchema((draft) => Schema | void)` helper introduced — a mutate-and-return factory that hands the caller a deep clone of the library default. Library invariants (cross-chunk tag allowlist, KaTeX className allowlist, `<mark>` permission) survive automatically.
- The library default schema is **not** exported as a value to prevent the shallow-spread footgun (`{ ...sanitizeSchema, … }` aliases nested arrays).

> See [URL Sanitization & Custom Schemes](./url-sanitization.md) for the full two-gate model and reference-stability rules.

---

## 1.3.x — Cross-chunk coordination

The 1.3 line introduced the largest feature in the library to date: coordinated rendering of chunked markdown documents.

### 1.3.0 — Cross-chunk references

- `<AIMarkdownDocuments>` wrapper component — opt-in, scoped per `documentId`.
- Footnotes, link references (`[label]: …`), and image references coordinate across chunks. A footnote in chunk B can resolve to a definition in chunk D; their numbering is document-wide, not chunk-local.
- Per-document `Registry` shared via React context. Symbol-keyed contributions with refcount + microtask-deferred cleanup — survives React 19 Strict Mode's double-mount semantics without losing chunk identity.
- Aggregate footnote footer renders once at the **last** chunk of the document; reorders automatically as chunks mount/unmount during streaming.
- Per-document id namespace via `documentId` prop (auto-generated via `useId()` when omitted) — prevents footnote backref collisions when multiple `<AIMarkdown>` instances render on the same page.

> See [Cross-chunk Coordination](./cross-chunk-coordination.md) for the full model.

### 1.3.0 — Block-level memoization

Shipped alongside cross-chunk in the same minor bump:

- `blockMemoEnabled` config field (default `true`). The renderer splits each document into per-block units and memoizes each block's React subtree by source identity (`raw + occurrence + ctx + position`). Unchanged blocks during streaming skip `toJsxRuntime` and React reconcile work entirely.
- Output is **byte-identical** to the disabled path — verified by a `byteEquivalence.test.tsx` harness covering every plugin permutation.
- The pipeline was refactored into **three independent stages** (parse, plan, render) so memoization could intercept between stages without modifying the upstream `react-markdown` API.

> See [Streaming & Performance](./streaming-and-performance.md) for the consumer-side reference-stability rules.

---

## 1.2.x — Streaming-safety improvements

The 1.2 line was about making the renderer robust to mid-stream input (partial LaTeX blocks, transient Mermaid parse failures, etc.).

### Highlights from the 1.2 patch series

- **Unclosed `$$` math blocks are truncated** during streaming so `mathFlow` doesn't swallow the rest of the document while the model is mid-token.
- **`|` characters inside unclosed LaTeX blocks are escaped** so a streaming token containing `\frac{a|b}{c}` doesn't break GFM table parsing in surrounding content.
- **LaTeX streaming edge cases hardened** — currency `$5.99` reliably stays prose; bracket delimiters (`\(…\)`, `\[…\]`) normalize correctly even when only one half has arrived.
- **Mermaid race conditions fixed** on rapid re-renders — concurrent re-renders no longer collide on the same diagram id.
- **Mermaid last-successful-render preserved across transient parse failures** during streaming. As the model emits a partial diagram, the previous fully-rendered diagram stays visible until the new one is valid; the rendered output never flashes to source-code fallback unless the diagram is truly broken at completion.
- **Mermaid `securityLevel` tightened** from `'loose'` to `'strict'` — a defense-in-depth refinement against malicious diagram content.
- **HTML-comment containers protected** so `<!-- inline comment -->` inside content doesn't accidentally enable raw-HTML injection paths.
- **Vite SSR + pnpm ESM resolution failure for lodash-es** worked around by bundling — fixes a class of "works in dev, breaks in prod" issues that previously bit consumers using strict-isolation installers.

### 1.2.0 — Initial public release

- Two-package monorepo: `@ai-react-markdown/core` (framework-agnostic) and `@ai-react-markdown/mantine` (Mantine UI integration).
- GFM (tables, strikethrough, task lists, autolinks).
- LaTeX math via KaTeX with smart preprocessing (currency $, mhchem, bracket delimiters, pipe escaping).
- Emoji shortcodes (`:smile:`).
- CJK-friendly line breaking + optional pangu auto-spacing.
- Extra syntax: `==highlight==`, definition lists.
- SmartyPants typography, HTML comment removal.
- Streaming-aware context.
- Custom typography variant + color schemes.
- Custom components (per HTML element override).
- Metadata context separate from render state.
- TypeScript generics for extended config + metadata.
- Mermaid diagrams with dark/light theme switching, source toggle, copy, open-in-new-window.
- Syntax highlighting via `@mantine/code-highlight` (highlight.js).
- JSON pretty-print (deep-parse of nested JSON-encoded strings).
- Mantine color-scheme auto-detection.

---

## Themes across versions

### 1. Streaming robustness has been a continuous priority

Every release line includes at least one streaming-safety fix. The block-memo introduction (1.3) was the largest _positive_ streaming improvement; the LaTeX/Mermaid hardening (1.2 patches) was the largest _defensive_ one. As of 1.4.5, the rendering pipeline is designed to be safe under arbitrary mid-token input — there is no input shape that causes a crash or runaway render.

### 2. Customization is opt-in, but escape hatches are first-class

The library defaults aim for "drop in, looks right." But every customization surface — typography, tokens, custom components, sanitization, content preprocessors, sub-package extension — is documented as a first-class API rather than a hack. 1.4.x in particular spent commits exposing these surfaces with carefully-typed signatures and JSDoc.

### 3. Composition over forking

Sub-package integration uses only the public extension points (`Typography`, `ExtraStyles`, `customComponents`, `defaultConfig`). The Mantine package is the reference implementation; nothing about it requires internal-API access. If your integration needs something Mantine has but core doesn't, the pattern is to compose, not fork.

### 4. Stability boundary explicitly drawn

- Public surfaces (props, hook signatures, config field names) are stable across minor versions.
- Default token _values_, exact byte output, and registry internals are explicitly **not** part of the stability contract.
- This is documented in [`docs/README.md`](./README.md#a-note-on-stability) and in JSDoc per export, so consumers know which surface to depend on vs override.

---

## What's been intentionally deferred

The following have been evaluated and consciously **not** shipped, with rationale documented in commits or memory:

- **Cross-chunk footnotes for arbitrary content (not just plain refs)** — the full path requires pre-parse injection + remark cleanup + a hidden rehype handler (~300 lines). Use cases are rare enough that the current support (footnotes / link refs / image refs) covers the 95% case.
- **Direct sanitize-schema export** — would invite the shallow-spread footgun. `extendSanitizeSchema` is the only supported path.
- **Mutator access to `Registry`** — exposing `registerChunk`, `allocateSymbol`, etc. on the public type would let a misbehaving consumer-component corrupt refcounts and numbering invariants. Read access via `Registry` is sufficient for all known consumer use cases.
- **Built-in CI badges in README** — there is no GitHub Actions setup in this repo at the time of writing. Adding a "build status" badge that would always show "no status" is worse than no badge.

If your use case bumps into one of these deferrals, opening an issue with a concrete scenario is the right way to revisit.
