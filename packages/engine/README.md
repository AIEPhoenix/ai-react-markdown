# @ai-react-markdown/engine

> **Legacy final release:** 2.14.0 completes the planned `ai-react-markdown` release line. Existing imports remain supported by this version; subsequent multi-framework development moves to `ai-markdown`. See the [transition and architecture guide](../../docs/framework-transition.md).

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

`@ai-react-markdown/engine` contains the string and syntax-tree processing used by ai-react-markdown: LaTeX preprocessing, the unified plugin chain, incremental parsing, and shared reference bookkeeping. It has no React dependency. A framework adapter supplies component lifecycle, DOM rendering, context subscriptions, and any presentation such as syntax highlighting.

**This is an internal supplier package.** It is published because core depends on it, with the same exact version. Its exports follow core's needs and can change in any release before 3.0.0, including patches. React applications and design-system wrappers should install core and use its public API. A direct engine consumer should pin an exact version and review changes when upgrading.

The examples below demonstrate individual entry points. They do not assemble a complete framework adapter: URL transformation, coordinated placeholder rendering, effect timing, and CSS remain the adapter's responsibility.

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

Dual ESM/CJS build with types for both. ESM keeps pipeline dependencies external. The CJS build bundles ESM-only default-export plugins so Node receives callable plugins and does not try to resolve the import-only `remend` entry through `require`. Bundled third-party licenses ship in `dist/THIRD_PARTY_LICENSES.txt`. No React dependency. The only peer is `katex` (`^0.16 || ^0.17`, **optional** — needed only if you render math). The pipeline also receives KaTeX transitively through `rehype-katex`. If your application imports KaTeX CSS, declare KaTeX directly so the import resolves independently of dependency hoisting. A tree-only consumer does not need to load a browser stylesheet.

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
  type IncrementalParseState,
  type AdvanceOptions,
} from '@ai-react-markdown/engine';

const remarkPlugins = buildCoreRemarkPlugins(defaultEnginePlugins);
const rehypePlugins = buildCoreRehypePlugins(sanitizeSchema, 'example-user-content-');
const remarkRehypeOptions = buildCoreRemarkRehypeOptions(true);
const options: AdvanceOptions = {
  remarkPlugins,
  rehypePlugins,
  remarkRehypeOptions,
  // Keep this key stable until a pipeline input changes.
  depsKey: [remarkPlugins, rehypePlugins, remarkRehypeOptions],
  defListEnabled: true, // defaultEnginePlugins includes definitionList.
};

let state: IncrementalParseState | null = null;
for (const frame of ['# Hello', '# Hello\n\nworld', '# Hello\n\nworld and more']) {
  const result = advanceIncrementalParse(state, frame, options);
  state = result.nextState;
  // result.hast — the full-document hast for this frame
  // result.usedIncremental / result.boundary — whether the frame spliced, and where
}
```

`AdvanceOptions` is documented in `incrementalParse/advanceIncrementalParse.ts`; the React renderer's `MarkdownContent` is the reference consumer.

## Verification

The incremental engine ships with a five-layer equivalence stack (fixture pins, fuzz arbiter, direction battery, exhaustive census, arbiter-sensitivity meta-suite) plus a six-leg release-gate soak (`scripts/soak/soak.sh`, with a complete release profile and fresh seed base); the full record lives in `src/experiments/prefixFreeze/README.md`. Every reachable divergence found so far is pinned as a deterministic test.

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

## Owning incremental state

Keep one parse state per logical input stream. Supply the full current source to `advanceIncrementalParse`, then retain only its returned `nextState` for the next frame. A replacement or a safety-gate failure can select a full parse; `usedIncremental: false` is an expected result, not itself an error. The returned hast still represents the whole current document.

A successful splice depends on both source continuity and pipeline compatibility. If your selected plugins, schema, namespace, or conversion options change, update the dependency key as well. Mutating a plugin array in place while retaining its identity can make a hand-built adapter reuse state under the wrong assumptions. The example creates its pipeline once and enables definition-list handling consistently in both parsing options and plugin selection.

`advanceIncrementalParse` does not implicitly apply every preprocessing convenience exposed by core. Normalize raw input first when you need the core LaTeX behavior, and retain a separate incremental LaTeX preprocessor per stream if using its stateful form. User transforms run on the normalized string in core; reproducing only the parse call is not necessarily equivalent to reproducing core's entire input pipeline.

## Adapter responsibilities

The hast tree is an intermediate representation, not finished HTML or React output. The rehype sanitizer runs in the chain, while URL transformation is a later rendering concern. A direct consumer must apply the relevant URL policy to surviving URL attributes and must preserve convergence if it revisits a retained tree.

Cross-chunk coordination requires more than creating a registry. Core registers chunks and contributes processed data after commit, subscribes to document and label changes, renders placeholders under the consuming chunk's policy, and emits one aggregate footer. Engine-built private placeholder tags also use a provenance boundary in the shipped pipeline. A hand-assembled chain without the matching credential lifecycle is not a drop-in coordinated renderer.

Use the React adapter as a source-level reference when building another host, and give that host its own lifecycle and equivalence tests. The [architecture guide](../../docs/architecture.md) traces the stage order, while [soak coverage](../../docs/soak-coverage.md) distinguishes a successful oracle comparison from evidence that an optimized path was exercised.

## Repository commands

After installing workspace dependencies, build with `pnpm --filter @ai-react-markdown/engine build` and type-check with `pnpm --filter @ai-react-markdown/engine typecheck`. The package's `fuzz:splice` command runs the splice property suite; `soak:coverage` validates the coverage map. Development soak runs use the smoke profile, and reused diagnostic seeds are marked as replay runs. Only complete release evidence can establish a release PASS.

The experimental README preserves the original L0–L4 study and later verification history. Its historical counts and tiers are not substitutes for the current production scanner, coverage map, or release runner configuration.

## License

MIT
