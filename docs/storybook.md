# Interactive examples

AI Markdown has one Storybook catalog per rendering framework and a composition entry that presents them together. React and Mantine share the React renderer. Vue runs independently with its own preview and browser tests. Engine and core contracts remain in their package documentation and independent test suites.

## Run locally

Install dependencies and start the catalogs:

```bash
pnpm install
pnpm storybook
```

The composition entry opens at `http://localhost:6006`, React at `http://localhost:6007`, and Vue at `http://localhost:6008`. The combined command starts all three servers; stop it with Ctrl+C. To work on one renderer, use `pnpm storybook:react` or `pnpm storybook:vue`.

Each startup command first builds its public package dependencies, including the Vue stylesheet exported from `dist/styles.css`. The combined command builds all public packages; individual renderer commands build their dependency closure. A failed package build prevents the servers from starting. Stories use renderer source files for hot updates, while imported engine/core packages use their built output; restart the command after changing those packages to refresh that output.

The React catalog contains Playground, Basics, Customization, Streaming, Documents, Integrations/Mantine, Performance Lab and QA. Vue uses the same capability categories where supported. Vue does not provide Mantine widgets or React render-count instrumentation. Composition groups are navigation boundaries: controls, theme state and replay clocks are not synchronized across frameworks.

## Choose a sample

General-purpose examples use complete excerpts from `corpus/documents/markdown.md`, `code.md`, `math.md` and `mermaid.md`. The private Storybook kit selects sections by explicit headings and fails if those boundaries disappear. It does not maintain another handwritten copy of the same Markdown. Shared excerpts keep React, Vue and Mantine demonstrations comparable without requiring identical generated IDs or DOM wrappers.

Purpose-built inputs remain appropriate when their exact syntax is the subject of the example: CJK and RTL typography, footnote ordering, separately mounted cross-chunk definitions, unsafe URL policies, malformed streaming tails, code collapse thresholds, nested JSON formatting and lifecycle regressions. These fixtures should identify the behavior they exercise. Their strings are test inputs, not installation instructions or benchmark claims.

The general excerpts avoid the remote-image and malformed-input sections of the full corpus. Assets used by browser regressions are served locally. Do not introduce remote image/font dependencies into general examples: offline static builds and reproducible tests must render the same content.

## Browser verification

```bash
pnpm typecheck
pnpm test:storybook:react
pnpm test:storybook:vue
# Both renderer suites, sequentially:
pnpm test:storybook
```

React's suite includes Mantine. Each project loads its own Storybook configuration and runs its own `play` assertions in Chromium. The composition entry does not execute referenced suites. QA navigation remains visible locally; setting `STORYBOOK_DOCS_EXPORT=1` hides QA in public navigation while preserving its indexed stories and assertions. Deliberate `!test` exclusions for isolated profiling instruments remain exclusions.

The accessibility addon currently reports findings in `todo` mode. A successful browser suite is not a claim of complete accessibility conformance. Independent core contracts, React lifetime/GC tests, Vue SSR/hydration/stress tests and engine soak remain separate verification responsibilities.

## Build a portable static site

```bash
STORYBOOK_DOCS_EXPORT=1 pnpm build-storybook
pnpm test:storybook-site
```

The result is one directory that must be deployed together:

```text
storybook-static/
  index.html          # Composition entry
  react/              # React and Mantine catalog
  vue/                # Vue catalog
```

The hub references `./react` and `./vue`, allowing the complete directory to live under a version or preview prefix. The smoke command serves it under `/preview/storybook/` and checks both direct iframe entries, refreshes, composed navigation, live Vue Controls updates and the React isolated-performance iframe target. Keep all three builds from the same commit. For a deliberately separate deployment, set `STORYBOOK_REACT_URL` and `STORYBOOK_VUE_URL` while building the hub; those overrides must point at the matching version or PR preview.

The build command first builds the public packages, then clears `storybook-static`, builds the hub, then builds both children. Upload the complete directory only after all builds and smoke checks succeed. No hosting provider, public domain or release archive policy is implied by this build layout.

## Repository ownership and links

Stories stay in `packages/react/stories`, `packages/react-mantine/stories` and `packages/vue/stories`. Renderer configurations live in `apps/storybook-*`. `tooling/storybook-kit` contains framework-neutral corpus excerpts and explicit React/Vue helper subpaths. These workspaces are private and excluded from the public package build, packcheck and npm release train.

React's former `Core/...` sidebar names now describe capabilities directly; the composition entry supplies the React group. Mantine moved under `Integrations/Mantine`. Old story URLs containing `core-` or `mantine-` must be updated; isolated iframe references in this repository use the new IDs. Story IDs are derived from titles and export names, so renaming either requires checking embedded links and browser regressions.

Installation, public API, architecture and migration guidance belong in the documentation and package READMEs. Storybook supplies interactive examples and short explanations with links to those guides. Shared documentation links are centralized in the private kit so they can later target the dedicated documentation site.
