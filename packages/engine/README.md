# @ai-react-markdown/engine

[![npm version](https://img.shields.io/npm/v/@ai-react-markdown/engine?logo=npm&color=cb3837)](https://www.npmjs.com/package/@ai-react-markdown/engine)
[![npm downloads](https://img.shields.io/npm/dm/@ai-react-markdown/engine?color=blue)](https://www.npmjs.com/package/@ai-react-markdown/engine)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@ai-react-markdown/engine?label=minzip)](https://bundlephobia.com/package/@ai-react-markdown/engine)
[![types](https://img.shields.io/npm/types/@ai-react-markdown/engine?logo=typescript&logoColor=white&color=3178c6)](https://www.typescriptlang.org/)

[![Node ≥20](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![ESM + CJS](https://img.shields.io/badge/module-ESM%20%2B%20CJS-f7df1e?logo=javascript&logoColor=black)](#install)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/engine?color=green)](https://github.com/AIEPhoenix/ai-react-markdown/blob/main/LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/AIEPhoenix/ai-react-markdown/ci.yml?branch=main&label=CI&logo=githubactions&logoColor=white)](https://github.com/AIEPhoenix/ai-react-markdown/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/AIEPhoenix/ai-react-markdown/release.yml?label=release&logo=githubactions&logoColor=white)](https://github.com/AIEPhoenix/ai-react-markdown/actions/workflows/release.yml)
[![part of ai-react-markdown](https://img.shields.io/badge/monorepo-ai--react--markdown-8a2be2?logo=github)](https://github.com/AIEPhoenix/ai-react-markdown)

Framework-agnostic Markdown engine for [ai-react-markdown](https://github.com/AIEPhoenix/ai-react-markdown) — incremental parsing, LaTeX preprocessing, definition/footnote machinery, and the unified plugin pipeline. Takes Markdown text in, produces a [hast](https://github.com/syntax-tree/hast) tree plus incremental-parse state out; rendering that tree is the job of a framework adapter such as [`@ai-react-markdown/core`](https://www.npmjs.com/package/@ai-react-markdown/core) (React).

> **Status: internal supplier.** This package exists to serve
> `@ai-react-markdown/core` and versions in lockstep with it. Its export
> surface tracks what core consumes and may change in any release —
> **no public API stability is promised before 3.0.0.** If you are
> rendering Markdown in React, depend on `@ai-react-markdown/core`
> instead; this package is interesting to you only if you are building a
> framework adapter of your own.

## What's inside

Everything is exported from the package root (`import { … } from '@ai-react-markdown/engine'`); the barrel is grouped by layer:

| Layer                    | Modules                                                                                                                                        | Highlights                                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preprocessors            | `preprocessors/latex`, `preprocessors/remend`, `preprocessAIMDContent`                                                                         | `preprocessLaTeX(text)` (currency `$`, `\[…\]` / `\(…\)` normalization, code-fence and inline-code protection), `createIncrementalLatexPreprocessor()` for append-only streams, `remend` for unterminated-markup mending                                                                       |
| Incremental parsing      | `incrementalParse/*`                                                                                                                           | `advanceIncrementalParse(state, content, options)` — the prefix-freeze engine: a line scanner decides a verified-safe freeze boundary, only the tail re-parses, and the two trees are spliced; every frame is deep-equal to a full parse (enforced by the arbiter suites) or falls back to one |
| Pipeline assembly        | `markdown/*`, `pluginChain`, `plugins/catalog`, `customMdastHandlers`, `remarkInjectPhantomDefs`, `rehypeRebaseHashLinks`, `rehypeFooterAdorn` | `buildCoreRemarkPlugins` / `buildCoreRehypePlugins` / `buildCoreRemarkRehypeOptions` — the exact chains the React renderer uses; the sealed engine-plugin catalog (`highlight`, `definitionList`, `removeComments`, `smartypants`, `pangu`, `defaultEnginePlugins`)                            |
| Cross-chunk coordination | `documentRegistry`, `collectDefLabels`, `extractContributions`, `extractDefBodiesFromHast`, `crossChunkUrlSanitize`                            | `createRegistry()` — the per-document store that numbers footnotes and resolves link definitions across chunks; `sanitizeCrossChunkUrl()` mirrors the standalone two-gate URL policy                                                                                                           |
| Sanitization             | `sanitizeSchema`, `extendSanitizeSchema`, `markdown/urlTransform`                                                                              | The library default `rehype-sanitize` schema (read-only singleton — clone with `extendSanitizeSchema`), `defaultUrlTransform`                                                                                                                                                                  |
| Streaming                | `smoothStream/controller`                                                                                                                      | `createSmoothStreamController()` — the framework-agnostic typewriter pacing state machine behind `<AIMarkdownSmoothStream>`, with `SMOOTH_STREAM_PACING_PRESETS`                                                                                                                               |
| Leaves                   | `hastPredicates`, `normalizeId`, `shortenDocumentId`, `devStageTimings`, `fixtures/scenarios`                                                  | Small pure helpers and the shared test corpus                                                                                                                                                                                                                                                  |

## Install

```bash
npm install @ai-react-markdown/engine
```

Dual ESM/CJS build with types for both. No React dependency. The only peer is `katex` (`^0.16 || ^0.17`, **optional** — needed only if you render math). It ships transitively via `rehype-katex`, so hoisted installers resolve it automatically; strict-isolation installers (yarn PnP, `pnpm --node-linker=isolated`) must install it explicitly in your app.

## Example: the LaTeX preprocessor on its own

```ts
import { preprocessLaTeX } from '@ai-react-markdown/engine';

preprocessLaTeX('Price is $100, and \\(x^2\\) is inline math.');
// → 'Price is \\$100, and $$x^2$$ is inline math.'
// (currency `$` escaped; `\\(…\\)` normalized to the `$$…$$` form remark-math's inline rule accepts)
```

The same function runs inside `@ai-react-markdown/core` before every parse; the incremental variant (`createIncrementalLatexPreprocessor`) reuses work across append-only frames.

## Example: driving the incremental parser

```ts
import {
  advanceIncrementalParse,
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  defaultEnginePlugins,
  sanitizeSchema,
} from '@ai-react-markdown/engine';

const options = {
  remarkPlugins: buildCoreRemarkPlugins(defaultEnginePlugins),
  rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, ''),
  remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
  depsKey: [],
  defListEnabled: false,
};

let state = null;
for (const frame of ['# Hello', '# Hello\n\nworld', '# Hello\n\nworld and more']) {
  const result = advanceIncrementalParse(state, frame, options);
  state = result.nextState;
  // result.hast — the full-document hast for this frame
  // result.usedIncremental / result.boundary — whether the frame spliced, and where
}
```

`AdvanceOptions` is documented in `incrementalParse/advanceIncrementalParse.ts`; the React renderer's `MarkdownContent` is the reference consumer.

## Verification

The incremental engine ships with a five-layer equivalence stack (fixture pins, fuzz arbiter, direction battery, exhaustive census, arbiter-sensitivity meta-suite) plus a six-leg release-gate soak (`scripts/soak/soak.sh`, from the repo root, with a fresh seed base); the full record lives in `src/experiments/prefixFreeze/README.md`. Every reachable divergence found so far is pinned as a deterministic test.

## Runtime support

Pure computation over strings and syntax trees: no DOM access, no
Node-only APIs, and no unguarded environment reads. Runs in browsers,
Node, workers, and embedded JS runtimes (e.g. Hermes/JavaScriptCore).

## Versioning

Lockstep with `@ai-react-markdown/core`, which pins this package **exactly** — the export surface follows what core consumes and may change in any release before 3.0.0 (see the status note above). Release notes: [release highlights](https://github.com/AIEPhoenix/ai-react-markdown/blob/main/docs/release-highlights.md).

## Package family

| Package                                                                                                              | Role                                                                                                        | Version policy                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@ai-react-markdown/core`](https://www.npmjs.com/package/@ai-react-markdown/core)                                   | The React renderer — `<AIMarkdown>`, `<AIMarkdownSmoothStream>`, `<AIMarkdownDocuments>`, hooks, providers  | Release train                                                       |
| [`@ai-react-markdown/mantine`](https://www.npmjs.com/package/@ai-react-markdown/mantine)                             | Mantine UI bindings — themed typography, code-highlight tabs, Mermaid, color-scheme wiring                  | Release train (lockstep with core)                                  |
| [`@ai-react-markdown/engine`](https://www.npmjs.com/package/@ai-react-markdown/engine)                               | Framework-agnostic engine — incremental parsing, LaTeX preprocessing, plugin pipeline, cross-chunk registry | Release train (lockstep, pinned exactly by core; internal supplier) |
| [`@ai-react-markdown/remark-mark-highlight`](https://www.npmjs.com/package/@ai-react-markdown/remark-mark-highlight) | remark plugin for `==mark==` highlight syntax                                                               | Independent semver                                                  |

## License

MIT
