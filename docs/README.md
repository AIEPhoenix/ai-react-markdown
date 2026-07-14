# ai-react-markdown — Extending & Customization Guide

This `docs/` directory documents the **customization and extension surfaces** of `ai-react-markdown`. The [project README](../README.md) covers installation, quick start, and the basic prop reference; everything below is for when you outgrow defaults.

> **Audience.** You've shipped `<AIMarkdown>` with default settings and now need to:
>
> - replace specific HTML element renderers (e.g. a chat-specific `<pre>` with copy buttons),
> - swap or theme the typography wrapper,
> - allow private URL schemes through sanitization,
> - coordinate footnotes/references across chunked chat messages,
> - or build your own integration package on top of `@ai-react-markdown/core`.
>
> If you only need defaults, you don't need this guide — `<AIMarkdown content={…} />` already does the right thing.

---

## By scenario (start here)

Most readers come in with a task, not a curriculum. Pick the row that matches what you're doing:

| You're doing…                                                               | Start with                                                   | Then read                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Building a streaming chat UI**                                            | [Streaming chat: end-to-end](./streaming-chat-example.md)    | [Streaming & performance](./streaming-and-performance.md) + [Cross-chunk coordination](./cross-chunk-coordination.md) + [Metadata context](./metadata-context.md) |
| **Rendering Chinese / Japanese / Korean content**                           | [CJK typography](./cjk-typography.md)                        | [Design tokens](./design-tokens.md) for font customization                                                                                                        |
| **Splitting one logical document across multiple `<AIMarkdown>` instances** | [Cross-chunk coordination](./cross-chunk-coordination.md)    | [Streaming & performance](./streaming-and-performance.md)                                                                                                         |
| **Retheming colors, spacing, fonts**                                        | [Design tokens](./design-tokens.md)                          | [Custom typography](./custom-typography.md) (only if tokens aren't enough)                                                                                        |
| **Replacing element renderers (custom `<a>`, `<pre>`, …)**                  | [Custom components](./custom-components.md)                  | [Metadata context](./metadata-context.md) (for callbacks)                                                                                                         |
| **Doing a security review / allowing private URL schemes**                  | [URL sanitization](./url-sanitization.md)                    | [Architecture](./architecture.md) (for the pipeline picture)                                                                                                      |
| **Adding typed config / metadata fields**                                   | [TypeScript generics](./typescript-generics.md)              | [Extending via a sub-package](./extending-via-subpackage.md) (if you'll publish it)                                                                               |
| **Transforming raw markdown before render**                                 | [Content preprocessors](./content-preprocessors.md)          | —                                                                                                                                                                 |
| **Building your own `@yourorg/ai-react-markdown-…` integration**            | [Extending via a sub-package](./extending-via-subpackage.md) | [Architecture](./architecture.md), [TypeScript generics](./typescript-generics.md)                                                                                |
| **Debugging unexpected render output**                                      | [Architecture](./architecture.md)                            | [Streaming & performance](./streaming-and-performance.md) (cache invariants)                                                                                      |
| **Tracking what changed across versions**                                   | [Release highlights](./release-highlights.md)                | —                                                                                                                                                                 |
| **Evaluating the performance flags before enabling them**                   | [Benchmark](./benchmark.md)                                  | [Streaming & performance](./streaming-and-performance.md)                                                                                                         |

If none of these matches, the full topic index below covers every surface.

---

<details>
<summary><strong>Full topic index</strong> (every document in this directory, by customization surface)</summary>

| #   | Document                                                     | When you need it                                                                                             |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | [Custom components](./custom-components.md)                  | Replace any HTML element renderer (`a`, `img`, `pre`, `table`, …) with your own React component              |
| 2   | [Custom typography](./custom-typography.md)                  | Swap the `Typography` slot — themed wrapper, custom font stack, design system integration                    |
| 3   | [Design tokens](./design-tokens.md)                          | Override CSS custom properties to retheme without writing a custom typography component                      |
| 4   | [Content preprocessors](./content-preprocessors.md)          | Transform the raw markdown string before parsing — frontmatter stripping, regex fixes, dialect normalization |
| 5   | [URL sanitization & custom schemes](./url-sanitization.md)   | Allow `myapp://`, `tel:`, or any other scheme through both sanitization gates safely                         |
| 6   | [Cross-chunk coordination](./cross-chunk-coordination.md)    | Render chunked chat messages whose footnotes / `[ref]` / `![ref]` resolve across `<AIMarkdown>` instances    |
| 7   | [Metadata context](./metadata-context.md)                    | Pass arbitrary data (callbacks, ids, app state) to deeply nested custom components without prop drilling     |
| 8   | [Streaming & performance](./streaming-and-performance.md)    | Reason about block-level memoization, `streaming`-aware custom components, and the cache-flush footguns      |
| 9   | [TypeScript generics](./typescript-generics.md)              | Extend `AIMarkdownRenderConfig` and `AIMarkdownMetadata` with your own typed fields                          |
| 10  | [Extending via a sub-package](./extending-via-subpackage.md) | Build your own `@yourorg/ai-react-markdown-<integration>` package, following the Mantine model               |
| 11  | [Architecture overview](./architecture.md)                   | Mental model: render pipeline, context layering, registry design                                             |
| ★   | [Streaming chat: end-to-end](./streaming-chat-example.md)    | Copy-runnable example — SSE backend, React state, Next.js App Router                                         |
| ★   | [CJK typography](./cjk-typography.md)                        | Chinese / Japanese / Korean text — line breaking, pangu spacing, font stack                                  |
| ★   | [Release highlights](./release-highlights.md)                | What's notable in each version — distilled from the commit log                                               |
| ★   | [Benchmark](./benchmark.md)                                  | Measured numbers for block-memo × incremental parse, methodology, and how to reproduce them                  |

The documents are independent — read them in any order. Cross-references are inlined where helpful.

</details>

---

## A note on stability

The library follows semver:

| Surface                                                                                                        | Stability under minor versions                                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Component props (`AIMarkdownProps`, `MantineAIMarkdownProps`)                                                  | Stable. Additions are non-breaking; renames/removals require a major bump         |
| Hook signatures (`useAIMarkdownRenderState`, `useAIMarkdownMetadata`, `useDocumentRegistry`, `useStableValue`) | Stable                                                                            |
| `AIMarkdownRenderConfig` field **names** and **roles**                                                         | Stable                                                                            |
| `AIMarkdownRenderConfig` **default values**                                                                    | May shift under minor bumps as defaults evolve — override what you need locked    |
| CSS custom property **names** (e.g. `--aim-spacing-md`)                                                        | Stable                                                                            |
| CSS custom property **default values**                                                                         | May shift under minor bumps as the visual design evolves                          |
| `UrlTransform`, `SanitizeSchema` types                                                                         | Track upstream `react-markdown` / `rehype-sanitize`; may change with their majors |
| `Registry` interface                                                                                           | Stable read-only surface; mutator methods are intentionally not exported          |
| Internal byte-for-byte HTML output                                                                             | Not stable — never assert on raw HTML; use semantic queries                       |

When in doubt, pin your overrides explicitly rather than relying on defaults.

---

## Conventions used in this guide

- **Code blocks** show the minimal version that compiles — apply your own imports for `katex` CSS, `MantineProvider`, etc.
- **Footguns** sections at the end of each document collect anti-patterns and stability traps. Read them once per surface.
- `// ✅` and `// ⚠️` callouts mark recommended vs anti-pattern code lines.
- Where a behavior is shared by `@ai-react-markdown/core` and `@ai-react-markdown/mantine`, the example uses `AIMarkdown` (core); apply identically to `MantineAIMarkdown`.

---

## Reporting issues with these docs

If you find a documented API that doesn't behave as described, or a customization recipe that breaks at a version boundary, please open an issue with:

- the document name and section,
- the package version (`@ai-react-markdown/core@1.4.x` …),
- a minimal reproduction,
- the observed vs expected behavior.

Issue tracker: <https://github.com/AIEPhoenix/ai-react-markdown/issues>
