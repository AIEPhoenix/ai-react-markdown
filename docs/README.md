# ai-markdown — Extending & Customization Guide

For the final legacy release and the subsequent multi-framework package migration, read [From ai-markdown to ai-markdown](./framework-transition.md). The [private runtime README](../packages/core/README.md) documents the extracted shared layer.

These guides explain how to integrate, customize, and maintain ai-markdown against the code in this repository. Start with the [project README](../README.md) for package selection and installation, or a package's README for its full public API. This directory goes deeper into rendering contracts, lifecycle behavior, implementation boundaries, and verification.

The examples use the current 2.x flat-prop API unless explicitly labeled as historical. The [migration guide](./migrating-to-v2.md) includes removed 1.x APIs for comparison; [release highlights](./release-highlights.md) and benchmark records preserve the behavior and measurements of the versions they describe.

For an ordinary chat message, accumulate transport deltas into one Markdown string and update one renderer. Add custom components for application behavior, tokens for visual adjustments, and `<AIMarkdownDocuments>` only when one logical document is deliberately split into multiple Markdown units. This distinction matters because reference coordination cannot join syntax split across component boundaries.

The scenario index below is the shortest route to a working integration. The full index also includes architecture and maintenance material for contributors.

## By scenario (start here)

Most readers come in with a task, not a curriculum. Pick the row that matches what you're doing:

| You're doing…                                                               | Start with                                                   | Then read                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Building a streaming chat UI**                                            | [Streaming chat: end-to-end](./streaming-chat-example.md)    | [Streaming & performance](./streaming-and-performance.md) + [Cross-chunk coordination](./cross-chunk-coordination.md) + [Metadata context](./metadata-context.md) |
| **Showing a "still generating" cursor during streaming**                    | [Streaming cursor](./streaming-cursor.md)                    | [Streaming & performance](./streaming-and-performance.md)                                                                                                         |
| **Smoothing bursty token chunks into a steady typewriter reveal**           | [Smooth streaming](./smooth-streaming.md)                    | [Streaming cursor](./streaming-cursor.md) + [Streaming & performance](./streaming-and-performance.md)                                                             |
| **Rendering Chinese / Japanese / Korean content**                           | [CJK typography](./cjk-typography.md)                        | [Design tokens](./design-tokens.md) for font customization                                                                                                        |
| **Splitting one logical document across multiple `<AIMarkdown>` instances** | [Cross-chunk coordination](./cross-chunk-coordination.md)    | [Streaming & performance](./streaming-and-performance.md)                                                                                                         |
| **Retheming colors, spacing, fonts**                                        | [Design tokens](./design-tokens.md)                          | [Custom typography](./custom-typography.md) (only if tokens aren't enough)                                                                                        |
| **Replacing element renderers (custom `<a>`, `<pre>`, …)**                  | [Custom components](./custom-components.md)                  | [Metadata context](./metadata-context.md) (for callbacks)                                                                                                         |
| **Doing a security review / allowing private URL schemes**                  | [URL sanitization](./url-sanitization.md)                    | [Architecture](./architecture.md) (for the pipeline picture)                                                                                                      |
| **Adding typed metadata / behavior-group fields**                           | [TypeScript generics](./typescript-generics.md)              | [Extending via a sub-package](./extending-via-subpackage.md) (if you'll publish it)                                                                               |
| **Upgrading from 1.x**                                                      | [Migrating from 1.x to 2.0](./migrating-to-v2.md)            | [TypeScript generics](./typescript-generics.md)                                                                                                                   |
| **Transforming raw markdown before render**                                 | [Content preprocessors](./content-preprocessors.md)          | —                                                                                                                                                                 |
| **Building your own `@yourorg/ai-markdown-…` integration**                  | [Extending via a sub-package](./extending-via-subpackage.md) | [Architecture](./architecture.md), [TypeScript generics](./typescript-generics.md)                                                                                |
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
| 9   | [Streaming cursor](./streaming-cursor.md)                    | Show a "still generating" indicator after the last streamed character — visible through token stalls         |
| 10  | [Smooth streaming](./smooth-streaming.md)                    | Reveal bursty token chunks as a steady typewriter — pacing model, wrapper composition, non-React controller  |
| 11  | [TypeScript generics](./typescript-generics.md)              | Type the metadata generic and the wrapper narrow-hook pattern for behavior groups                            |
| 12  | [Extending via a sub-package](./extending-via-subpackage.md) | Build your own `@yourorg/ai-markdown-<integration>` package, following the Mantine model                     |
| 13  | [Architecture overview](./architecture.md)                   | Mental model: render pipeline, context layering, registry design                                             |
| 14  | [Migrating from 1.x to 2.0](./migrating-to-v2.md)            | The complete v2.0.0 breaking-change map — every removed symbol with its one-to-one destination               |
| ★   | [Streaming chat: end-to-end](./streaming-chat-example.md)    | Complete SSE framing, cancellation, React state, and a Next.js-style route                                   |
| ★   | [CJK typography](./cjk-typography.md)                        | Chinese / Japanese / Korean text — line breaking, pangu spacing, font stack                                  |
| ★   | [Release highlights](./release-highlights.md)                | What's notable in each version — distilled from the commit log                                               |
| ★   | [Benchmark](./benchmark.md)                                  | Measured numbers for block-memo × incremental parse, methodology, and how to reproduce them                  |

| ★ | [Soak coverage](./soak-coverage.md) | Map stateful optimizations to oracles, tests, release legs, and engagement checks |

The documents can be read independently; code recipes that build on earlier definitions say so. Cross-references are inlined where helpful.

</details>

---

## A note on stability

The library follows semver:

| Surface                                                                                                              | Stability under minor versions                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Component props (`AIMarkdownProps`, `MantineAIMarkdownProps`)                                                        | Stable. Additions are non-breaking; renames/removals require a major bump           |
| Hook signatures (the five narrow hooks, `useAIMarkdown`, `useDocumentRegistry`, `useStableValue`, `useStableRecord`) | Stable                                                                              |
| Flat prop **names** and **roles** (incl. the sealed plugin names)                                                    | Stable                                                                              |
| Flat prop **default values**                                                                                         | May shift under minor bumps as defaults evolve — override what you need locked      |
| CSS custom property **names** (e.g. `--aim-spacing-md`)                                                              | Stable                                                                              |
| CSS custom property **default values**                                                                               | May shift under minor bumps as the visual design evolves                            |
| `UrlTransform`, `SanitizeSchema` types                                                                               | Track upstream `react-markdown` / `rehype-sanitize`; may change with their majors   |
| `Registry` interface                                                                                                 | Stable read-only surface; mutator methods are intentionally not exported            |
| Internal byte-for-byte HTML output                                                                                   | Not stable — prefer semantic assertions for application tests; use semantic queries |
| Everything exported by `@ai-markdown/engine`                                                                         | **Not stable before 3.0.0** — see below                                             |

**On `@ai-markdown/engine`.** Since 2.3.0 the Markdown engine ships as its own package. It is public on npm because `@ai-markdown/react` depends on it, not because it is a product: its export surface tracks whatever core happens to consume and may change in any release, patch bumps included. You get it automatically when you install `core`, pinned to the React adapter's exact version, and nothing in this guide asks you to import from it. Depend on it directly only if you are building a framework adapter of your own — and if you do, pin both packages to the same exact version.

When in doubt, pin your overrides explicitly rather than relying on defaults.

---

## Conventions used in this guide

- **Code blocks** are labeled by purpose. Complete recipes include their required imports; smaller fragments assume the surrounding application values, and wrapper templates use explicitly named placeholder modules. Install the package peers and import required CSS before using them.
- **Footguns** sections at the end of each document collect anti-patterns and stability traps. Read them once per surface.
- `// ✅` and `// ⚠️` callouts mark recommended vs anti-pattern code lines.
- Where a behavior is shared by `@ai-markdown/react` and `@ai-markdown/react-mantine`, the example uses `AIMarkdown` (core); apply identically to `MantineAIMarkdown`.

---

## Reporting issues with these docs

If you find a documented API that doesn't behave as described, or a customization recipe that breaks at a version boundary, please open an issue with:

- the document name and section,
- the exact package version (`@ai-markdown/react@x.y.z` …),
- a minimal reproduction,
- the observed vs expected behavior.

Issue tracker: <https://github.com/ai-markdown/ai-markdown/issues>

## Reading the implementation alongside the guides

Follow a value through its owner before changing its documentation. Public props are resolved in core; syntax and incremental algorithms belong to engine; pipeline sessions, plans and contribution orchestration belong to private runtime; React providers, effects, and cached element construction belong to core; Mantine owns its code presentation and group defaults. An export in engine is not automatically a supported core API.

| Question                                   | Implementation to inspect                               | Guide to keep aligned                      |
| ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------ |
| What does an omitted prop do?              | Core prop resolver and the wrapper's parameter defaults | Package props reference, migration guide   |
| When can an old parse or block be reused?  | Incremental advance, block planner, MarkdownContent     | Architecture, streaming and performance    |
| Which chunk owns a reference?              | Document registry and consuming placeholder             | Cross-chunk coordination, URL sanitization |
| What text is displayed or copied?          | Core preprocessor chain and Mantine code renderer       | Content preprocessors, Mantine README      |
| When is a streamed result complete?        | Transport state, smooth controller, document queue      | Chat example, smooth streaming             |
| What proves an optimization was exercised? | Coverage map, oracle tests, soak manifests              | Soak coverage, experimental record         |

When contributing documentation, retain useful examples and historical measurements, but identify their version and scope. Verify current API names, defaults, relative links, and commands against this checkout. A successful build establishes that package artifacts compile; it does not by itself validate every prose claim or performance estimate.
