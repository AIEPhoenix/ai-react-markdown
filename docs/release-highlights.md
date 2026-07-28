# Release Highlights

A distilled, human-readable summary of what's notable in each version — extracted from the commit log and organized by theme rather than chronology. For the full commit history, see `git log` or the [GitHub releases page](https://github.com/AIEPhoenix/ai-react-markdown/releases).

> Headings follow semver: minor versions introduce new features or non-breaking refinements; patches fix bugs or document existing behavior.

---

## 1.8.x — Incremental parsing by default

### 1.8.0 — `incrementalParseEnabled` defaults to `true`

- `config.incrementalParseEnabled` flips from opt-in to on-by-default, and drops its EXPERIMENTAL label. The promotion criteria were met by the 1.6.1 verification campaign and its soak record (50k fuzz samples, 20k direction-battery prefixes, exhaustive K=4 census — all clean): append-only streaming now freezes the stable document prefix and re-parses only the tail out of the box, cutting per-frame parse/transform cost by 83–94% on the benchmark payloads.
- No rendered output changes. The engine's contract — spliced trees deep-equal to a full parse, positions included — is enforced per-frame by the splice-equivalence suite, and every unsafe frame still silently falls back to the ordinary full parse (non-append changes, no freeze-safe boundary, container-nested definitions, SSR).
- Opting out: pass `config={{ incrementalParseEnabled: false }}`. Note for sub-package authors: the field stays optional in `AIMarkdownRenderConfig`, and a custom `defaultConfig` that omits it still resolves to `false` at the engine gate — set it explicitly to `true` to match the new library default.
- Docs updated throughout (READMEs, `docs/streaming-and-performance.md`, `docs/benchmark.md`); historical entries below keep their original default-`false` wording.

---

## 1.7.x — Streaming cursor

### 1.7.0 — Inline streaming cursor

- New `streamingCursor` slot on `<AIMarkdown>` plus an exported `AIMarkdownStreamingCursor` shell: while `streaming === true`, an indicator renders right after the **last streamed character** and stays visibly alive through token stalls — the user can tell "still generating" from "stuck" even when no new content arrives. Everything happens at the DOM layer (a whitelist walk to the last text node, Range measurement of its final character — surrogate-pair aware — and an imperative `transform` kept in sync by a pre-paint MutationObserver plus ResizeObserver/`fonts.ready`), so the content string, the parse pipeline, and the block-memo cache are untouched: incremental parsing keeps its append gate, pinned by a dedicated browser regression story. The previously documented `content + '▍'` pattern is retired for exactly that reason — it silently forced a full parse every frame.
- The default indicator is a blinking dot sized to the current line that cross-fades into a two-tone spinner ring after 5 s of silence and springs back when tokens resume — pure CSS (opacity/transform only, no layout properties), `prefers-reduced-motion` aware, `aria-hidden`, copy-safe (never inside the text flow), with keyframes deduped into one `document.head` tag via `useInsertionEffect`. Custom visuals plug in through the `indicator` contract (`{ width, height, lastMutationAt }`). Un-anchorable tails (code fences, KaTeX output, SVG, raw HTML, void elements — or empty content before the first token) hide the cursor for those frames; it reappears when a text tail returns. RTL anchors on the correct side, ancestor `transform: scale` is compensated, and SSR emits only an inert wrapper (no hydration jump).
- Hardened by three review rounds before merge: an RTL overlap, a layout snap from the typography `:last-child` margin trim (the rule is now a separate Baseline-2023-safe ruleset in core and mantine so the last real block stays margin-free while the zero-height cursor wrapper is mounted), and a sub-millisecond Chromium timer early-fire that could permanently suppress the stall state (found via a flaky story, fixed by re-check-and-re-arm with deadline stamping) were all closed; an empirical browser torture pass (concurrent instances, morphing tails, 1 ms streams, mid-stream resets) found no further defects. Seven browser smokes ship as permanent regression fixtures alongside the node-environment suites.
- Docs: `docs/streaming-and-performance.md`'s "Variant: streaming cursor" section now documents the built-in slot (with a warning on why appending a cursor character breaks incremental parsing), and the end-to-end chat example adopts it.

---

## 1.6.x — Incremental parsing

### 1.6.1 — Incremental-parse verification campaign, CI browser gate

- The incremental-parse engine (still `config.incrementalParseEnabled`, still default `false`) went through a machine-driven verification campaign that found and fixed **18 real correctness bugs** — every one reachable only with the flag ON, so the shipped default behavior is unchanged, but flag-on consumers get materially more correct output. Each bug is pinned verbatim (document + streaming schedule) as a permanent regression fixture. Breakdown: 4 detector under-blocks (code-span masking inside html-flow continuation lines; a stale continuation verdict when a list interrupts a paragraph or follows a closed fence/math line; a sticky flow flag suppressing a real `$$` open after a comment terminator or an ambiguous non-block tag; `$$$$` opening a length-4 math fence), 5 malformed-definition registrations (def-shaped lines in html-flow text, footnote defs wrongly chaining, destination-less `[label]:`, garbage after the destination, titles left open at end-of-line), 1 reference under-taint (a def-shaped paragraph continuation line dropping its live `[label]` ref), and 8 splice-layer divergences around hast-util-raw's less-traveled output shapes (root-position anchoring, html-block trailing-literal position lifecycle, seam merges around tokenizer-dropped raw constructs and footer-only tails).
- The falsification suite behind it is four layers on one shared arbiter oracle: a property-based **fuzz** arbiter (fast-check generators biased at the detector's documented approximations), a **bounded-exhaustive census** (every ≤K-token sequence over a 24-token markdown-hot alphabet × every 2-cut schedule — a census, not a sample, within the bound), a **direction battery** that turns the detector's "only ever over-blocks" claim into a bombarded property, and a **sensitivity meta-suite** that plants known faults and asserts the arbiter catches them (so a green soak means something). A Stryker mutation audit is recorded alongside. The campaign's soak record: 50k fuzz samples, 20k direction-battery prefixes, and the full K=4 census, all clean after the fixes. The study directory (`src/experiments/prefixFreeze/`) documents the whole thing.
- **CI now runs the Storybook browser smokes.** The root vitest config's `storybook` project renders every story in headless Chromium — the only gate that exercises real browser DOM — but `pnpm -r test` never reached it (the project lives at the workspace root). It gets a dedicated CI matrix task and runs inline in the release workflow before publish, closing a known gate gap.
- `@ai-react-markdown/mantine`'s mermaid renderer was refactored behavior-preservingly: its three-boolean lifecycle state collapses into one view phase machine, `mermaid.initialize` is cached per theme, and an unchanged `(code, theme)` pair skips a redundant re-render — the streaming/regenerate/theme-flip behavior shipped in 1.5.1 is unchanged, verified live.
- Housekeeping: the streaming benchmark stories single-source their comparison-axis definitions and share their control rows and replay shell; dev-dependency security advisories (`qs`, `esbuild`) are resolved via scoped overrides (dev-only chains, nothing ships); CI actions moved to their Node 24 targets.

### 1.6.0 — Experimental prefix-freeze parsing for streaming

- New `config.incrementalParseEnabled` (default `false`, requires `blockMemoEnabled`): during append-only streaming, the renderer freezes the stable prefix of the document at a verified-safe boundary, re-parses only the tail, and splices the previous frame's mdast/hast with the tail's — cutting the per-frame parse/transform cost to roughly the tail's share (83–94% less pipeline stage time measured on the benchmark payloads — exceeding the measurement study's 70–89% parse-only estimate; the freeze boundary covers ~73–87% of realistic LLM output). Block-memo cache keys are position-based, so the two optimizations compose: frozen blocks stay cache hits.
- Safety is falsified, not assumed: a splice-equivalence suite asserts the spliced trees are deep-equal (positions included) to a full parse, per streaming frame, across the plugin-permutation catalog and adversarial fixtures (loose lists, rehype-raw swallow containers, open `$$` math, late reference/footnote definitions, definition-list term claims, Unicode case-folded labels, CRLF). A Storybook play test additionally pins the live-DOM equality of flag-on vs flag-off streams in a real browser.
- **Footnotes splice** instead of forcing per-frame full parses. Footnote numbering, footer membership/order, and backref ids are whole-document state inside mdast-util-to-hast, so the engine replays the prefix's footnote event sequence (definitions and references ×occurrence, in document order) at the tail head — the tail run rebuilds that state exactly, regenerates the complete document footer, and the footer's positions are rewritten back into document coordinates by a dual rule (injected-def segments per segment, tail-native the ordinary shift). The withDefs benchmark corpus flips from "measures the fallback" to >50% spliced frames; a footnote-heavy browser smoke pins live-DOM equality under StrictMode.
- **Cross-chunk (`<AIMarkdownDocuments>`) documents splice** too. Each chunk's registry-driven phantom-definition suffix is handed to the engine as an always-tail input: the append gate and boundary scan see the chunk's own text alone, so phantom churn (labels arriving/leaving as sibling chunks stream) re-parses only the tail. The reference taint is the correctness backstop — a phantom's definition is never in the chunk's own text, so phantom-resolved refs never enter the frozen prefix. A dedicated `CrossChunkIncrementalCompare` story and a coordinated browser smoke ship alongside the arbiter's suffix-churn scenarios.
- **Sanitize-stripped prefix nodes splice** (HTML comments, `<?…?>` bogus comments, `<script>`): their orphaned wrap separators are re-derived by a separator-run alignment model instead of tripping a full-parse fallback (which used to fire on every frame whose frozen prefix held one).
- Every frame still re-checks a gate chain and silently falls back to the ordinary full parse when it can't prove safety: non-append content changes, no freeze-safe boundary yet, a container-nested definition that can't be re-injected verbatim, or a hast layout outside the alignment model. SSR always takes the full path. See the new "Incremental parse (prefix-freeze)" section in `docs/streaming-and-performance.md`.
- New opt-in `createRemendPreprocessor()` — streaming tail repair built on Vercel Streamdown's zero-dependency `remend` engine: unterminated `**bold`/`` `code ``/`~~strike~~`/links render styled mid-stream instead of literal. Tree-shakeable (only enters a bundle when imported), no-op on well-formed text (final frames identical), `linkMode` defaults to text-only under our URL sanitizer, math completion permanently off (the built-in LaTeX preprocessor owns `$`). Composes freely with block-memo; with incremental parsing, only the frames inside an unterminated construct fall back. See `docs/content-preprocessors.md`.
- Dev stage telemetry gains an `ai-markdown:stage:scan` measure (the boundary detector), and `parse`/`transform` now report tail-only time when a frame spliced. The `BlockMemoComparison` benchmark story gains an `incremental` toggle on the block-memo side.
- Hardened before release by a recall-biased multi-angle review plus a same-day polishing pass: six probe-confirmed detector corners closed (indented-code merges, def-shaped continuation lines, blockquote-nested definitions, mid-line `$$`, backtick-bearing fence info strings, html block types 3–5) and every one turned into a permanent arbiter fixture; the v1-era footnote bypass became fence/code-span aware (later removed entirely when v2's injection replay made footnotes splice); the detector gained checkpoint incremental scanning (scan stage 9→4 ms at 4×, 84→13 ms at 16×) with a resume-vs-fresh equivalence property test; the plugin chain was single-sourced (`pluginChain.ts`) with a directional consistency pin against the experiment record; and `docs/benchmark.md` ships recalibrated real-browser numbers (84%/94% pipeline savings, boost p50 32→7.5 ms — unchanged by the hardening).
- The v2 splice capabilities went through the same discipline before release: two further adversarial review rounds (8 + 4 independent finder angles, every engine claim probe-tested against the arbiter) closed two probe-confirmed correctness holes — the injection text itself introduced continuation context the detector never modeled (a trailing footnote-def body could swallow indented tail content; a definition-list `: desc` could claim the injected block through the compressed join), both neutralized by a sentinel terminator definition appended to every injection, plus a mention-gate so a document literally writing the sentinel label falls back instead of mis-resolving — and one probe-confirmed regression (documents OPENING with a table silently never spliced). Hardening along the way: injection plans are cached and advanced incrementally (removing an O(stream²) per-frame walk), the engine got a throw fence (a mid-frame error can no longer strand a stale scan checkpoint), SSR renders skip the engine's seed scan entirely, and the detector checkpoint no longer retains a copy of the document (~2–3× doc size per mounted instance reclaimed).
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
