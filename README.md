# ai-react-markdown

> A React component library purpose-built for rendering **AI-generated markdown** — LLM streaming, LaTeX math, Mermaid diagrams, GFM, syntax highlighting, CJK-friendly typography, and cross-chunk reference coordination. Batteries included, escape hatches everywhere.

[![@ai-react-markdown/core npm](https://img.shields.io/npm/v/@ai-react-markdown/core?label=%40ai-react-markdown%2Fcore&logo=npm&color=cb3837)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![@ai-react-markdown/mantine npm](https://img.shields.io/npm/v/@ai-react-markdown/mantine?label=%40ai-react-markdown%2Fmantine&logo=npm&color=cb3837)](https://www.npmjs.com/package/@ai-react-markdown/mantine)

[![core downloads](https://img.shields.io/npm/dm/@ai-react-markdown/core?label=%40ai-react-markdown%2Fcore%20downloads&color=blue)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![mantine downloads](https://img.shields.io/npm/dm/@ai-react-markdown/mantine?label=%40ai-react-markdown%2Fmantine%20downloads&color=blue)](https://www.npmjs.com/package/@ai-react-markdown/mantine)

[![types: TypeScript](https://img.shields.io/npm/types/@ai-react-markdown/core?label=types&logo=typescript&logoColor=white&color=3178c6)](https://www.typescriptlang.org/)
[![React 19+](https://img.shields.io/badge/React-%E2%89%A519-149eca?logo=react&logoColor=white)](https://react.dev/)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white)](https://prettier.io/)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/core?color=green)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/AIEPhoenix/ai-react-markdown)

> **Upgrading from 1.x?** v2.0.0 removes the 1.x object-based `config` channel (and its integrator default channel) in favor of flat props, a sealed engine-plugin catalog, and five narrow hooks. Every removed symbol has a one-to-one destination with before/after code in the [migration guide](./docs/migrating-to-v2.md).

---

## Why ai-react-markdown?

Most React markdown renderers were designed for **static documents** — blog posts, READMEs, CMS content. AI-generated markdown breaks several of their assumptions:

- **Streaming**: content arrives token-by-token, and the same component must re-render dozens of times per second without flicker.
- **Multi-chunk documents**: a single LLM response is often delivered in multiple chunks (chat UI), each rendered by its own component instance, yet references (`[^footnote]`, `[link][def]`, `![img][def]`) must still resolve across chunks.
- **Math, diagrams, CJK**: AI assistants emit `$E=mc^2$`, `\`\`\`mermaid` blocks, mixed Chinese/English paragraphs, and HTML comments — by default vanilla pipelines mangle these.
- **Untrusted output**: LLM markdown can contain `javascript:` URLs, malformed HTML, and broken footnote definitions. Sanitization needs to be airtight **and** customizable for app-specific schemes.
- **Performance under streaming**: every keystroke from the model triggers a re-render of the full document. Block-level memoization is no longer "nice-to-have", it's table stakes.

This library is opinionated around those problems. Out of the box you get safe LLM rendering with sane defaults; opt-in escape hatches let you customize anything from URL allowlists down to per-element renderers.

## Features

|                              |                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GFM**                      | tables, strikethrough, task lists, autolinks (via `remark-gfm`)                                                                                                                                                                                                 |
| **LaTeX math**               | inline `$…$` and display `$$…$$` via KaTeX, with smart preprocessing for currency `$`, bracket delimiters (`\[…\]`, `\(…\)`), pipe escaping, and [mhchem](https://mhchem.github.io/MathJax-mhchem/) commands (chemistry formulas like `\ce{H2O}`)               |
| **Mermaid diagrams**         | interactive SVG with dark/light themes, source toggle, copy, open-in-new-window (in `@ai-react-markdown/mantine`)                                                                                                                                               |
| **Syntax highlighting**      | language-labelled tabs, expand/collapse, optional `highlight.js` auto-detection for unlabelled blocks (in `@ai-react-markdown/mantine`)                                                                                                                         |
| **CJK-friendly**             | proper line breaking for Chinese / Japanese / Korean text plus optional [pangu](https://github.com/vinta/pangu.js) auto-spacing between CJK and half-width characters                                                                                           |
| **Streaming-aware**          | `streaming` flag is propagated via context; custom renderers can show cursors, skip animations, or disable copy buttons during streaming                                                                                                                        |
| **Streaming cursor**         | built-in `streamingCursor` slot renders a "still generating" indicator after the last streamed character — visible through token stalls, pure-CSS animation, zero impact on the parse pipeline                                                                  |
| **Smooth streaming**         | `<AIMarkdownSmoothStream>` reveals bursty token chunks as a steady grapheme-by-grapheme typewriter; an adaptive jitter buffer tracks the source's cadence (three presets: smooth / balanced / responsive) and every frame rides the incremental-parse fast path |
| **Cross-chunk coordination** | `<AIMarkdownDocuments>` wrapper lets chunked chat messages share a `documentId` so footnotes / link refs / image refs resolve across chunks                                                                                                                     |
| **Block-level memoization**  | each markdown block is memoized by source identity; unchanged blocks skip `toJsxRuntime` and React reconcile work during streaming. Output is byte-identical to the disabled path                                                                               |
| **Emoji shortcodes**         | `:smile:` → 😄 via `remark-emoji`                                                                                                                                                                                                                               |
| **Extra syntax**             | `==highlight==`, definition lists (PHP Markdown Extra)                                                                                                                                                                                                          |
| **Display optimizations**    | SmartyPants typography, HTML comment removal, pangu CJK spacing                                                                                                                                                                                                 |
| **Customizable URL safety**  | two-gate XSS protection (`urlTransform` + `rehype-sanitize`); helper to extend the schema without breaking library invariants                                                                                                                                   |
| **Custom components**        | swap any HTML-element renderer with a typed component; library defaults are merged underneath                                                                                                                                                                   |
| **Custom typography**        | drop-in `Typography` slot with full CSS-variable token surface for spacing, headings, weight, colors                                                                                                                                                            |
| **Metadata context**         | pass arbitrary data to nested custom components without prop drilling — isolated from render state so updates don't re-render the document                                                                                                                      |
| **TypeScript**               | first-class metadata generic and fully typed flat props; full IDE autocompletion                                                                                                                                                                                |
| **React 19**                 | uses native `useId()`, properly typed for the current React version                                                                                                                                                                                             |

## Packages

| Package                                            | Description                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@ai-react-markdown/core`](./packages/core)       | UI-library-agnostic React renderer. GFM, LaTeX, CJK, streaming, metadata context, custom components, cross-chunk coordination.                                                                                |
| [`@ai-react-markdown/mantine`](./packages/mantine) | Mantine UI integration. Adds themed typography, code highlighting via `@mantine/code-highlight`, Mermaid diagrams, JSON pretty-print, and automatic color scheme detection.                                   |
| [`@ai-react-markdown/engine`](./packages/engine)   | Framework-agnostic Markdown engine — incremental parsing, LaTeX preprocessing, the unified plugin pipeline. Internal supplier for `core`; install `core` instead unless you are building a framework adapter. |

## Installation

### Core (React, any UI library)

`@ai-react-markdown/engine` comes along as a pinned transitive dependency — you never install or declare it yourself.

```bash
# npm
npm install @ai-react-markdown/core

# pnpm
pnpm add @ai-react-markdown/core

# yarn
yarn add @ai-react-markdown/core
```

### Mantine integration

```bash
# pnpm (illustrative — the same applies to npm / yarn)
pnpm add @ai-react-markdown/mantine @ai-react-markdown/core \
         @mantine/core @mantine/code-highlight highlight.js
```

### Peer Dependencies

| Peer                      | Required by                                            | Version                |
| ------------------------- | ------------------------------------------------------ | ---------------------- |
| `react` / `react-dom`     | `core`, `mantine`                                      | `>=19.0.0`             |
| `katex`                   | `core` + `engine` (optional — only if you render math) | `^0.16.0 \|\| ^0.17.0` |
| `@mantine/core`           | `mantine`                                              | `^9.0.0`               |
| `@mantine/code-highlight` | `mantine`                                              | `^9.0.0`               |
| `highlight.js`            | `mantine`                                              | `^11.11.1`             |

> `katex` is an **optional peer**, declared by both `core` and `engine` (the engine owns the `rehype-katex` step, core owns the CSS contract). It ships transitively via `rehype-katex`, so hoisted installers (npm, yarn classic, default pnpm) resolve `'katex/dist/katex.min.css'` automatically. Strict-isolation installers (yarn PnP, `pnpm --node-linker=isolated`) must install it explicitly, in your own app — not alongside the engine. Skip this only if you never render math.

### React version & framework compatibility

| Question                        | Answer                                                                                                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does it work with React 18?** | No. The library uses `useId()` and React 19's stricter Strict Mode semantics; the `peerDependencies` are pinned to `>=19.0.0`. If you're on React 18, [`react-markdown`](https://github.com/remarkjs/react-markdown) is the safer choice until you upgrade                         |
| **Next.js (App Router)?**       | Yes. The core package marks `'use client'` at its barrel; the Mantine package's sub-components mark it where needed. In practice, import either component from a file you've marked `'use client'` yourself. CSS imports (KaTeX, typography, Mantine) go in your root `layout.tsx` |
| **Next.js (Pages Router)?**     | Yes — standard CSR usage. The library is SSR-safe (`useId()` is SSR-stable), so server-rendering a static markdown string also works                                                                                                                                               |
| **React Native?**               | No. The renderer depends on the DOM (`<div>`, `<span>`, KaTeX CSS). React Native would need a separate renderer                                                                                                                                                                    |
| **Remix / Vite / CRA?**         | Yes — any React 19 host. The only environment-specific note is the strict-isolation pnpm/yarn-PnP `katex` install (see [Peer Dependencies](#peer-dependencies))                                                                                                                    |

### Development vs production builds

The core package ships two builds (react/redux-style) selected by the `development`
[exports condition](https://nodejs.org/api/packages.html#community-conditions-definitions):
the development build has all warnings and dev-time invariant checks enabled; the
production build has them compiled out. Neither file references `process.env`, so
importing the package without a bundler (browser native ESM, CDN, Deno) is safe and
yields the production build.

Bundlers that understand the condition (Vite, webpack/Next.js in development mode)
pick the right build automatically — nothing to configure.

**Footgun:** a resolver that does _not_ know the condition always gets the
**production** build, even during development. The common case is server-side
rendering with plain Node (no bundler): dev warnings will be silent there. Run Node
with `--conditions=development` if you want them in that setup.

The same applies to **Jest**: its resolver never includes the `development`
condition (regardless of `NODE_ENV`), so consumer test suites exercise the
production build — this package's dev-only warnings and invariant checks will not
fire in tests. Opt back in with
`testEnvironmentOptions: { customExportConditions: ['development', 'node', 'node-addons'] }`
(jest-environment-node; use `['development', 'browser']` with jsdom). Keep the
environment's defaults in the list — `customExportConditions` **replaces** them
rather than adding to them, and dropping `node`/`browser` would misresolve every
other conditional-exports package in the test process.

**Footgun (all dual-build packages — react and redux share it):** resolution
conditions must be consistent within one process. If part of your toolchain inlines
this package under the `development` condition while another part — say an
externalized wrapper like `@ai-react-markdown/mantine` in a partially-inlined
Vitest setup — resolves it through Node without that condition, two copies load
and React contexts split across them: cross-chunk coordination appears silently
dead. Align `deps.inline` / aliases so everything in the process resolves the
same build.

### CSS Imports

Pick the set that matches the package you installed.

**If you installed `@ai-react-markdown/core` only:**

```tsx
import 'katex/dist/katex.min.css'; // required for math
import '@ai-react-markdown/core/typography/default.css'; // default variant only
// or: import '@ai-react-markdown/core/typography/all.css'; // every shipped variant
```

**If you installed `@ai-react-markdown/mantine`** — the Mantine package provides its own typography wrapper, so you do **not** need the core typography CSS unless you also render the standalone `<AIMarkdown>` somewhere:

```tsx
import 'katex/dist/katex.min.css';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-react-markdown/mantine/styles.css';
```

## Quick Start

### Core

```tsx
import AIMarkdown from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

export default function App() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

### Mantine

```tsx
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '@ai-react-markdown/mantine';

import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-react-markdown/mantine/styles.css';
import 'katex/dist/katex.min.css';

const highlightJsAdapter = createHighlightJsAdapter(hljs);

export default function App() {
  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <MantineAIMarkdown content="Hello **world**! Math: $E = mc^2$" />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
```

## Recipes

### Stream from an LLM

The `streaming` flag is just a context boolean — pass `true` while tokens are still arriving so descendants can adapt (deferred copy buttons, skipped animations, etc.). The renderer itself remains stable across re-renders thanks to block-level memoization. Add `streamingCursor` for a built-in "still generating" indicator that tracks the last streamed character and stays visible through token stalls ([docs](./docs/streaming-cursor.md)):

```tsx
import AIMarkdown, { AIMarkdownStreamingCursor } from '@ai-react-markdown/core';

function ChatMessage({ message }: { message: { content: string; pending: boolean } }) {
  return (
    <AIMarkdown
      content={message.content}
      streaming={message.pending}
      streamingCursor={AIMarkdownStreamingCursor}
      colorScheme="dark"
    />
  );
}
```

Network chunks land in bursts; if the lurching bothers you, swap in `<AIMarkdownSmoothStream>` — same props, plus typewriter pacing that adapts to the source's cadence (pick a `smoothPacing` preset: `smooth`, `balanced`, or `responsive` — [docs](./docs/smooth-streaming.md)):

```tsx
import { AIMarkdownSmoothStream, AIMarkdownStreamingCursor } from '@ai-react-markdown/core';

<AIMarkdownSmoothStream
  content={message.content}
  streaming={message.pending}
  streamingCursor={AIMarkdownStreamingCursor}
/>;
```

Smooth chunks that share a `documentId` inside `<AIMarkdownDocuments>` take turns automatically: chunk N reveals completely before chunk N+1 starts — one typewriter, one cursor, even when the sources stream concurrently ([details](./docs/smooth-streaming.md#multi-chunk-documents-turn-taking)).

### Render chunked chat messages with cross-chunk references

When a single logical document is delivered in multiple `<AIMarkdown>` instances (e.g. one per chunk, or one per turn within a thread), wrap them in `<AIMarkdownDocuments>` and pass the **same** `documentId` so footnotes, link refs, and image refs resolve across chunks:

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-react-markdown/core';

function StreamedMessage({ chunks, id }: { chunks: string[]; id: string }) {
  return (
    <AIMarkdownDocuments>
      {chunks.map((chunk, i) => (
        <AIMarkdown key={i} content={chunk} documentId={id} streaming={i === chunks.length - 1} />
      ))}
    </AIMarkdownDocuments>
  );
}
```

Without the wrapper, each `<AIMarkdown>` is independent — its references only resolve within its own content. The wrapper is the **only** thing required to opt into coordination.

### Mermaid diagrams (via Mantine package)

````markdown
```mermaid
graph TD
  A[User Input] --> B{Is it valid?}
  B -->|Yes| C[Process]
  B -->|No| D[Show Error]
```
````

The Mantine integration renders this as an interactive SVG with dark/light theme switching, a source toggle, copy button, and "open in new window" — no extra setup. The `mermaid` package is a direct dependency of `@ai-react-markdown/mantine`.

### CJK text with auto pangu spacing

Pangu spacing automatically inserts a regular ASCII space between CJK characters and half-width letters/digits, which is the de-facto convention in Chinese, Japanese, and Korean typography. It's on by default. Turn it off by filtering the `pangu` plugin out of the default engine-plugin set:

```tsx
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

// Module scope — stable reference keeps the memo cache warm.
const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);

<AIMarkdown content="今天我用 React 19 重构了 ai-react-markdown 的 streaming 实现。" enginePlugins={PLUGINS} />;
```

### Allow a custom URL scheme (e.g. `myapp://`)

Sanitization runs through **two independent gates** for defense in depth: `rehype-sanitize` schema (per-protocol allowlist, runs first in the rehype chain) and `urlTransform` (per-attribute rewriter, runs second at render time). Both must permit a scheme for it to render.

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema } from '@ai-react-markdown/core';

// Module-scope: defined once, stable across renders, keeps the memo cache warm.
const ALLOWED = /^myapp:/i;
const URL_TRANSFORM = (url, key, node) => (ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node));

const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
});

export default function App({ content }: { content: string }) {
  return <AIMarkdown content={content} urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />;
}
```

> ⚠️ Reference stability matters. Inlining `urlTransform={(url) => …}` creates a new closure every render and discards the block-memo cache. Always define at module scope (or memoize with `useMemo`). Development builds emit a `console.warn` after detecting 3+ identity flips. `extendSanitizeSchema` is the only supported way to build a schema — it hands you a deep clone with library invariants (cross-chunk tags, `math-inline`/`math-display` markers on `<code>`, `<mark>`) preserved.

### Replace specific HTML element renderers

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents } from '@ai-react-markdown/core';

const components: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" />,
};

<AIMarkdown content={markdown} customComponents={components} />;
```

In the Mantine package, caller `customComponents` are merged on top of Mantine defaults; including `pre` opts out of Mantine's built-in code-block / Mermaid / JSON pipeline.

### Pass metadata to nested custom components

Metadata lives in a **separate React context** from render state, so updating it (e.g. swapping a `onCopyCode` callback) does not re-render the document body.

```tsx
import AIMarkdown, { useAIMarkdownMetadata, type AIMarkdownCustomComponents } from '@ai-react-markdown/core';

interface ChatMeta {
  messageId: string;
  onCopyCode: (code: string) => void;
}

const components: AIMarkdownCustomComponents = {
  pre: ({ children }) => {
    const meta = useAIMarkdownMetadata<ChatMeta>();
    return (
      <pre>
        <button onClick={() => meta?.onCopyCode(String(children))}>Copy</button>
        {children}
      </pre>
    );
  },
};

<AIMarkdown<ChatMeta>
  content={markdown}
  customComponents={components}
  metadata={{ messageId: msg.id, onCopyCode: handleCopy }}
/>;
```

### Adapt rendering based on streaming state

Narrow hooks subscribe per system — this component re-renders when `streaming` flips or the theme changes, and nothing else:

```tsx
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-react-markdown/core';

function MyCodeBlock({ children }: { children: React.ReactNode }) {
  const { streaming } = useAIMarkdownState();
  const { colorScheme } = useAIMarkdownTheme();
  return <pre className={`${colorScheme} ${streaming ? 'cursor' : ''}`}>{children}</pre>;
}
```

### Strip frontmatter (or any other transform) before rendering

```tsx
import type { AIMDContentPreprocessor } from '@ai-react-markdown/core';

const stripFrontmatter: AIMDContentPreprocessor = (content) => content.replace(/^---[\s\S]*?---\n/, '');

<AIMarkdown content={raw} contentPreprocessors={[stripFrontmatter]} />;
```

Preprocessors run after the built-in LaTeX normalizer, in array order.

## Advanced Customization & Extension

The README covers the 90% case. For deep customization — replacing element renderers, theming, allowing custom URL schemes, coordinating chunked streaming, building your own integration package — see the topic-focused guides under [`docs/`](./docs/):

| Guide                                                             | What it covers                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Custom components](./docs/custom-components.md)                  | Replace renderers for any HTML element with your own React components            |
| [Custom typography](./docs/custom-typography.md)                  | Swap the `Typography` slot; integrate with design systems                        |
| [Design tokens](./docs/design-tokens.md)                          | Complete CSS custom-property surface; retheme without writing JS                 |
| [Content preprocessors](./docs/content-preprocessors.md)          | Transform the raw markdown string before parsing                                 |
| [URL sanitization](./docs/url-sanitization.md)                    | Two-gate sanitization model; allow custom schemes safely                         |
| [Cross-chunk coordination](./docs/cross-chunk-coordination.md)    | Chunked chat messages with references that resolve across chunks                 |
| [Metadata context](./docs/metadata-context.md)                    | Pass callbacks/ids to nested components without prop drilling                    |
| [Streaming & performance](./docs/streaming-and-performance.md)    | Block-level memoization, `streaming` flag, cache-flush footguns                  |
| [Smooth streaming](./docs/smooth-streaming.md)                    | Typewriter pacing for bursty token streams — shell, hook, non-React controller   |
| [TypeScript generics](./docs/typescript-generics.md)              | Typed `metadata` via the `TMetadata` generic; wrapper extension patterns         |
| [Migrating to v2](./docs/migrating-to-v2.md)                      | Complete 1.x → 2.0.0 mapping — every removed symbol with before/after code       |
| [Extending via a sub-package](./docs/extending-via-subpackage.md) | Ship your own `@yourorg/ai-react-markdown-<integration>`                         |
| [Architecture overview](./docs/architecture.md)                   | Render pipeline, context layering, registry design                               |
| [Streaming chat: end-to-end](./docs/streaming-chat-example.md)    | Copy-runnable SSE chat example — backend route, React client, Next.js App Router |
| [CJK typography](./docs/cjk-typography.md)                        | Chinese / Japanese / Korean text — line breaking, pangu spacing, font stack      |
| [Release highlights](./docs/release-highlights.md)                | What's notable in each version — distilled from the commit log                   |
| [Benchmark](./docs/benchmark.md)                                  | Measured numbers for block-memo × incremental parse, and how to reproduce them   |

> Below this point: the full prop / config / hook / API reference. Most readers can stop here and dive into the customization guides — come back when you need a specific signature.

## `<AIMarkdown>` Props

The full list with all subtleties lives in [`@ai-react-markdown/core` README](./packages/core/README.md). Quick reference:

| Prop                       | Type                                | Default                           | Purpose                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`                  | `string`                            | **required**                      | Raw markdown to render                                                                                                                                                                                        |
| `streaming`                | `boolean`                           | `false`                           | Propagated via context for streaming-aware renderers                                                                                                                                                          |
| `streamingCursor`          | `ComponentType`                     | —                                 | "Still generating" indicator slot, mounted after the last streamed character while `streaming` — see [Streaming cursor](./docs/streaming-cursor.md)                                                           |
| `fontSize`                 | `number \| string`                  | `'0.9375rem'`                     | Base font size (numbers → px). Anchors `--aim-font-size-root`                                                                                                                                                 |
| `variant`                  | `AIMarkdownVariant`                 | `'default'`                       | Typography variant name                                                                                                                                                                                       |
| `colorScheme`              | `AIMarkdownColorScheme`             | `'light'`                         | `'light'`, `'dark'`, or custom                                                                                                                                                                                |
| `metadata`                 | `TMetadata`                         | —                                 | Arbitrary data for custom components (separate context)                                                                                                                                                       |
| `contentPreprocessors`     | `AIMDContentPreprocessor[]`         | —                                 | Extra string transforms applied after the LaTeX preprocessor. Ships an optional `createRemendPreprocessor()` factory for streaming tail repair — see [Content Preprocessors](./docs/content-preprocessors.md) |
| `customComponents`         | `AIMarkdownCustomComponents`        | —                                 | `react-markdown` component overrides                                                                                                                                                                          |
| `Typography`               | `AIMarkdownTypographyComponent`     | `DefaultTypography`               | Typography wrapper                                                                                                                                                                                            |
| `ExtraStyles`              | `AIMarkdownExtraStylesComponent`    | —                                 | Optional wrapper between typography and content                                                                                                                                                               |
| `documentId`               | `string`                            | auto via `useId()`                | Stable id namespace for clobberable attributes; share across chunks for cross-chunk coordination                                                                                                              |
| `urlTransform`             | `UrlTransform \| null`              | `defaultUrlTransform`             | Second sanitization gate — per-attribute URL rewriter (runs at render time)                                                                                                                                   |
| `sanitizeSchema`           | `SanitizeSchema`                    | library default                   | First gate — `rehype-sanitize` schema, per-protocol allowlist (build with `extendSanitizeSchema`)                                                                                                             |
| `enginePlugins`            | `readonly AIMarkdownEnginePlugin[]` | `defaultEnginePlugins` (all five) | Sealed engine-plugin selection, imported from `@ai-react-markdown/core/plugins`; passing an array replaces the set wholesale — see [Engine Plugins](#engine-plugins)                                          |
| `blockMemo`                | `boolean`                           | `true`                            | Per-block memoization. Output is byte-identical when disabled; set `blockMemo={false}` only for debugging                                                                                                     |
| `incrementalParse`         | `boolean`                           | `true`                            | Prefix-freeze incremental parsing for append-only streaming — see [Behavior props](#behavior-props)                                                                                                           |
| `preserveOrphanReferences` | `boolean`                           | `true`                            | Protect orphan `[^x]: …` defs from being silently dropped during streaming when the reference hasn't arrived yet                                                                                              |

An explicitly passed prop (`v != null`) overrides the shipped default; an absent prop falls to the shipped default. Passing `null` counts as absent — this guards against serialization boundaries (RSC, persistence) materializing "not passed" as `null` and punching through defaults.

> The Mantine package extends this with a `codeBlock` prop. See its [props table](./packages/mantine/README.md#props-api-reference).

## Engine Plugins

Optional pipeline features are selected through the `enginePlugins` prop, which accepts **sealed plugin objects** exported from the `@ai-react-markdown/core/plugins` subpath:

```tsx
import AIMarkdown from '@ai-react-markdown/core';
import { highlight, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = [highlight, pangu]; // module scope — stable reference

<AIMarkdown content={content} enginePlugins={PLUGINS} />;
```

| Plugin           | Effect                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `highlight`      | `==highlighted text==` syntax                                                                     |
| `definitionList` | Definition lists ([PHP Markdown Extra](https://michelf.ca/projects/php-markdown/extra/#def-list)) |
| `removeComments` | Strip HTML comments                                                                               |
| `smartypants`    | Typographic substitutions: curly quotes, em-dashes (`--`), ellipses (`...`)                       |
| `pangu`          | Auto-insert spaces between CJK and half-width characters                                          |

Omitting the prop means `defaultEnginePlugins` (all five). Passing an array **replaces the selection wholesale** — there is no merging. The recommended "turn one off" idiom:

```tsx
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
```

Rules worth knowing:

- Each plugin's position in the produced chain comes from its internal stage metadata; the order of your array is irrelevant. Duplicates are deduplicated with a dev warning.
- The set is **sealed**: only core constructs plugins (the incremental engine's boundary scanner must know every construct's syntax). Third-party content extension stays open through `contentPreprocessors` + `customComponents`.
- Plugin objects are not serializable. For remote-config scenarios, store `plugin.name` strings and map them back to the exported singletons at the edge.

## Behavior props

| Prop                       | Type      | Default | Purpose                                                                                                                                                                                                                                                                  |
| -------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blockMemo`                | `boolean` | `true`  | Per-block memoization. Output is byte-identical when disabled; set `false` only for debugging                                                                                                                                                                            |
| `incrementalParse`         | `boolean` | `true`  | Prefix-freeze incremental parsing: append-only streaming re-parses only the tail (83–94% less pipeline stage time on the benchmark payloads). Output stays deep-equal to a full parse; see [Streaming & Performance](./docs/streaming-and-performance.md). On by default |
| `preserveOrphanReferences` | `boolean` | `true`  | Protect orphan `[^x]: …` defs from being silently dropped during streaming when the reference hasn't arrived yet                                                                                                                                                         |

The Mantine package additionally surfaces a `codeBlock` prop (group value replaces atomically; omitted fields fall to defaults):

| Prop field                            | Type      | Default | Purpose                                        |
| ------------------------------------- | --------- | ------- | ---------------------------------------------- |
| `codeBlock.defaultExpanded`           | `boolean` | `true`  | Whether code blocks start expanded             |
| `codeBlock.autoDetectUnknownLanguage` | `boolean` | `false` | Use `hljs.highlightAuto` for unlabelled blocks |

### `define*` factories (optional)

Integration-time values can be packaged as frozen, reference-stable fragments and spread into the component. Runtime-varying fields go after the spreads (later props win):

```tsx
import { defineTheme, defineBehaviors, definePipeline } from '@ai-react-markdown/core';

const THEME = defineTheme({ fontSize: 15, variant: 'default' });
const BEHAVIORS = defineBehaviors({ blockMemo: false });
const PIPELINE = definePipeline({ sanitizeSchema: MY_SCHEMA });

<AIMarkdown content={content} {...THEME} {...BEHAVIORS} {...PIPELINE} colorScheme={userScheme} />;
```

Factories are identity + types + `Object.freeze`, zero logic — bare flat props are always equally legal. Core factories accept core fields only; wrappers re-export widened versions (e.g. `defineMantineBehaviors`, which adds `codeBlock`).

## Hooks

State is split across five per-system contexts, each with a narrow hook that re-renders only when its own system changes (a `streaming` flip no longer wakes every consumer). Available from `@ai-react-markdown/core`:

| Hook                                 | Returns                                                                      | When to use                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `useAIMarkdownState()`               | `{ streaming, …extension state groups }`                                     | React to streaming state (cursors, deferred copy buttons)                                                |
| `useAIMarkdownTheme()`               | `{ fontSize, variant, colorScheme }`                                         | Theme-aware custom components                                                                            |
| `useAIMarkdownDocument()`            | `{ documentId, documentIdExplicit, clobberPrefix }`                          | Components that emit anchors / ids                                                                       |
| `useAIMarkdownBehaviors()`           | `{ blockMemo, incrementalParse, preserveOrphanReferences, …wrapper groups }` | Read the behavior switches and wrapper behavior groups                                                   |
| `useAIMarkdownMetadata<TMetadata>()` | `TMetadata \| undefined`                                                     | Read app-specific metadata (callbacks, ids, etc.)                                                        |
| `useAIMarkdown()`                    | `{ document, metadata, state, theme, behaviors }`                            | Aggregate over all five contexts — see the price below                                                   |
| `useDocumentRegistry(documentId)`    | `Registry \| null`                                                           | Direct access to the cross-chunk registry. `null` when outside `<AIMarkdownDocuments>`                   |
| `useStableValue(value)`              | Same type as input                                                           | Returns a referentially stable copy via deep-equal; useful when you cannot easily memoize a complex prop |

> The aggregate `useAIMarkdown()` subscribes to all five contexts and re-renders on ANY change — including every `streaming` flip. It serves teaching code and low-frequency components; performance-sensitive components should use the narrow hooks.

The Mantine package adds:

| Hook                                        | Notes                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `useMantineCodeBlockOptions()`              | Returns `Required<MantineCodeBlockOptions>` — the `codeBlock` group with defaults applied |
| `useMantineAIMarkdownMetadata<TMetadata>()` | Defaults `TMetadata` to `MantineAIMarkdownMetadata`                                       |

## Typography & Theming

The default typography is driven by CSS custom properties anchored to `--aim-font-size-root` — which means **changing the `fontSize` prop proportionally scales every rendered dimension** (spacing, headings, KaTeX, etc.). Override any token in your own stylesheet:

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.2); /* roomier paragraphs */
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 2.5);
  --aim-font-weight-strong: 600;
  --aim-color-anchor: #ff6b6b;
}
```

Token groups:

| Group                | Tokens                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Spacing              | `--aim-spacing-{xs,sm,md,lg,xl}`                                                            |
| Font size            | `--aim-font-size-{xs,sm,md,lg,xl}`                                                          |
| Heading sizes        | `--aim-h{1..6}-font-size`                                                                   |
| Heading meta         | `--aim-h{1..6}-line-height`, `--aim-h{1..6}-font-weight`                                    |
| Shared weight        | `--aim-font-weight-strong` (default `700`)                                                  |
| KaTeX                | `--aim-katex-font-size`                                                                     |
| Misc                 | `--aim-line-height`, `--aim-radius-sm`, `--aim-font-family-{monospace,headings}`            |
| Color (light / dark) | `--aim-color-{text,dimmed,anchor,border,code-bg,code-text,blockquote-bg,mark-bg,mark-text}` |

> **Stability contract**: token _names_ and _roles_ follow semver. Exact default _values_ may shift under minor bumps as the visual design evolves — override what you need locked.

For a fully custom typography wrapper, replace the `Typography` prop; remember to forward `style` so injected CSS custom properties reach descendants. Full recipe in the [core README](./packages/core/README.md#custom-typography-component).

## TypeScript

The component accepts one generic type parameter — `TMetadata` for metadata:

```tsx
import AIMarkdown, { type AIMarkdownMetadata } from '@ai-react-markdown/core';

interface MyMetadata extends AIMarkdownMetadata {
  messageId: string;
}

<AIMarkdown<MyMetadata> content={markdown} metadata={{ messageId: '123' }} />;
```

`useAIMarkdownMetadata<MyMetadata>()` reads it back typed. Sub-packages like `@ai-react-markdown/mantine` extend the flat prop surface directly (`MantineAIMarkdownProps<TMetadata> extends AIMarkdownProps<TMetadata>` adds `codeBlock`), transport their groups through `AIMarkdownBehaviorsProvider`, and apply group defaults inside their own narrow hook — see [Extending via a sub-package](./docs/extending-via-subpackage.md).

## Security: Two-Gate URL Sanitization

By default `<AIMarkdown>` only renders URLs whose protocols are in the same allowlist `react-markdown` / GitHub use: `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`. Anything else — `javascript:`, `data:`, your own `customscheme://` — is stripped. This protects against XSS in LLM-generated markdown.

Two gates run in sequence:

1. **`rehype-sanitize` schema** — runs first (in the rehype plugin chain), drops URLs whose protocol is not in the schema's per-attribute allowlist (`protocols.href`, `protocols.src`, `protocols.cite`).
2. **`urlTransform`** — runs second, on every URL-bearing attribute during render-time traversal. Receives the attribute name (`'href'` / `'src'` / …) so policies can discriminate (e.g. allow a scheme on `<a>` but not on `<img>`).

For a scheme to render, **both must permit it**. This is intentional defense-in-depth. Use `defaultUrlTransform` + `extendSanitizeSchema` (see the [recipe above](#allow-a-custom-url-scheme-eg-myapp)) to opt into additional schemes without breaking other invariants (cross-chunk tags, KaTeX classes, `<mark>`).

> Full sanitize-schema reference, footguns, and the asymmetric reference-stability rules for `urlTransform` vs `sanitizeSchema` are documented in the [core README's security section](./packages/core/README.md#custom-url-schemes-and-sanitization).

## Cross-Chunk Coordination Reference

| Export                                                                    | Shape                                     | Purpose                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `<AIMarkdownDocuments>`                                                   | `{ children, preserveOrphanReferences? }` | Wrap a group of `<AIMarkdown>` chunks that share a `documentId` |
| `useDocumentRegistry(documentId)`                                         | `Registry \| null`                        | Read the shared registry inside a custom component              |
| `Registry`, `ChunkData`, `FootnoteDef`, `LinkDef`, `RefRecord`, `RefKind` | exported types                            | For typed helpers that operate on the registry directly         |

The `preserveOrphanReferences` prop on `<AIMarkdownDocuments>` unconditionally overrides each chunk's `preserveOrphanReferences` prop — useful when the wrapper-level policy should always win.

`<MantineAIMarkdown>` participates in coordination identically; nest it inside `<AIMarkdownDocuments>` the same way.

## Exported API at a Glance

### `@ai-react-markdown/core`

```ts
// Default export
import AIMarkdown from '@ai-react-markdown/core';

// Components
import { AIMarkdownDocuments, AIMarkdownStreamingCursor } from '@ai-react-markdown/core';

// Additive Providers (extension-group transport for wrappers / apps)
import { AIMarkdownBehaviorsProvider, AIMarkdownStateProvider } from '@ai-react-markdown/core';

// Hooks — five narrow hooks + the aggregate
import {
  useAIMarkdownState,
  useAIMarkdownTheme,
  useAIMarkdownDocument,
  useAIMarkdownBehaviors,
  useAIMarkdownMetadata,
  useAIMarkdown,
  useDocumentRegistry,
  useStableValue,
  useStableRecord,
} from '@ai-react-markdown/core';

// Factories, constants & helpers
import {
  defineTheme,
  defineBehaviors,
  definePipeline,
  defaultUrlTransform,
  extendSanitizeSchema,
  createRemendPreprocessor,
  AIMarkdownStabilityPolicy,
} from '@ai-react-markdown/core';

// Sealed engine plugin catalog (subpath export)
import {
  highlight,
  definitionList,
  smartypants,
  pangu,
  removeComments,
  defaultEnginePlugins,
} from '@ai-react-markdown/core/plugins';

// Types
import type {
  AIMarkdownProps,
  AIMarkdownDocumentsProps,
  AIMarkdownCustomComponents,
  AIMarkdownMetadata,
  AIMarkdownEnginePlugin,
  AIMarkdownEnginePluginName,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
  AIMDContentPreprocessor,
  UrlTransform,
  SanitizeSchema,
  AIMarkdownStabilityTable,
  Registry,
  ChunkData,
  FootnoteDef,
  LinkDef,
  RefRecord,
  RefKind,
} from '@ai-react-markdown/core';
```

### `@ai-react-markdown/mantine`

```ts
// Default export
import MantineAIMarkdown from '@ai-react-markdown/mantine';

// Components
import { MantineAIMarkdownTypography, MantineAIMDefaultExtraStyles } from '@ai-react-markdown/mantine';

// Hooks
import { useMantineCodeBlockOptions, useMantineAIMarkdownMetadata } from '@ai-react-markdown/mantine';

// Factory & constants
import { defineMantineBehaviors, defaultMantineCodeBlockOptions } from '@ai-react-markdown/mantine';

// Types
import type {
  MantineAIMarkdownProps,
  MantineAIMarkdownMetadata,
  MantineCodeBlockOptions,
  MantineBehaviorProps,
} from '@ai-react-markdown/mantine';
```

## Architecture

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          // Separate context for metadata
    <AIMarkdownProvider>                // Per-system contexts: document, state, theme, behaviors
      <Typography>                      // Configurable typography wrapper
        <ExtraStyles?>                  // Optional extra style wrapper
          <AIMarkdownContent />         // react-markdown with the remark/rehype pipeline
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

State lives in **five separate per-system contexts** (document, metadata, state, theme, behaviors) so a change in one system — a metadata swap, a `streaming` flip — only re-renders that system's subscribers, not the whole tree.

The Mantine package wraps `<AIMarkdown>` with:

- `Typography = MantineAIMarkdownTypography` (Mantine `<Typography>`)
- `ExtraStyles = MantineAIMDefaultExtraStyles` (CSS scoping for em-based Mantine tokens)
- `customComponents.pre = MantineAIMPreCode` (CodeHighlight + Mermaid + JSON pretty-print)
- `colorScheme = useComputedColorScheme('light')` when not overridden

## Development

```bash
# Install dependencies (pnpm required)
pnpm install

# Build all packages
pnpm build

# Run Storybook (interactive playground for development)
pnpm storybook

# Lint / autofix
pnpm lint
pnpm lint:fix

# Format
pnpm format
pnpm format:check

# Per-package tests (vitest)
pnpm --filter @ai-react-markdown/core test
pnpm --filter @ai-react-markdown/core typecheck
```

## Contributing

Issues and pull requests are welcome. For non-trivial changes, please open an issue first so we can discuss design and scope.

Reporting a bug helps most when it includes:

- The package and version (`@ai-react-markdown/core@2.3.0` …)
- The relevant `<AIMarkdown>` / `<MantineAIMarkdown>` props
- A minimal markdown sample that reproduces the issue
- For streaming-related bugs: the chunk sequence (one string per chunk)

## License

[MIT](./LICENSE) © [@AIEPhoenix](https://github.com/AIEPhoenix)
