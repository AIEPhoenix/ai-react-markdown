# @ai-react-markdown/core

[![npm](https://img.shields.io/npm/v/@ai-react-markdown/core)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![npm downloads](https://img.shields.io/npm/dm/@ai-react-markdown/core)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/core)](../../LICENSE)

A batteries-included React component for rendering AI-generated markdown with first-class support for LaTeX math, GFM, CJK text, and streaming content.

> **Upgrading from 1.x?** v2.0.0 removes the 1.x object-based `config` channel (and its integrator default channel) in favor of flat props, a sealed engine-plugin catalog, and five narrow hooks. See the [migration guide](../../docs/migrating-to-v2.md) for the complete old → new mapping with before/after code.

## Features

- **GFM** -- tables, strikethrough, task lists, autolinks via `remark-gfm`
- **LaTeX math** -- inline and display math rendered with KaTeX; smart preprocessing handles currency `$` signs, bracket delimiters (`\[...\]`, `\(...\)`), pipe escaping, and mhchem commands
- **Emoji** -- shortcode support (`:smile:`) via `remark-emoji`
- **CJK-friendly** -- proper line breaking and spacing for Chinese, Japanese, and Korean text
- **Extra syntax** -- highlight (`==text==`), definition lists
- **Display optimizations** -- SmartyPants typography, pangu CJK spacing, HTML comment removal
- **Streaming-aware** -- built-in `streaming` flag propagated via context for custom components
- **Smooth streaming** -- `AIMarkdownSmoothStream` shell (and the `useSmoothStream` hook beneath it) reveals bursty token chunks as a steady grapheme-by-grapheme typewriter; see [docs/smooth-streaming.md](../../docs/smooth-streaming.md)
- **Customizable** -- swap typography, color scheme, individual markdown element renderers, and inject extra style wrappers
- **Metadata context** -- pass arbitrary data to deeply nested custom components without prop drilling, isolated from render state to avoid unnecessary re-renders
- **TypeScript** -- fully typed flat props plus a metadata generic (`AIMarkdownProps<TMetadata>`)

## Installation

```bash
# npm
npm install @ai-react-markdown/core

# pnpm
pnpm add @ai-react-markdown/core

# yarn
yarn add @ai-react-markdown/core
```

Since 2.3.0 the Markdown engine lives in a separate package, [`@ai-react-markdown/engine`](https://www.npmjs.com/package/@ai-react-markdown/engine). It is an ordinary transitive dependency pinned to core's exact version, so **you never install, declare, or upgrade it yourself** — and it cannot drift out of step with core. The public API of this package did not change in the split.

### Peer Dependencies

```json
{
  "react": ">=19.0.0",
  "react-dom": ">=19.0.0"
}
```

### CSS Dependencies

For LaTeX math rendering, include the KaTeX stylesheet:

```tsx
import 'katex/dist/katex.min.css';
```

`katex` is declared as an **optional peer dependency** — by this package and by `@ai-react-markdown/engine`, which owns the `rehype-katex` pipeline step. It ships transitively via `rehype-katex`, so hoisted installers (npm, yarn classic, default pnpm) resolve the import automatically. Strict-isolation installers (yarn PnP, `pnpm --node-linker=isolated`) need it installed explicitly in your own app:

```bash
npm install katex
```

Skip the install only if you have no `import 'katex/…'` calls in your app and don't render math.

For the built-in default typography, include the typography CSS:

```tsx
import '@ai-react-markdown/core/typography/default.css';
// or import all typography variants at once:
import '@ai-react-markdown/core/typography/all.css';
```

## Quick Start

```tsx
import AIMarkdown from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

function App() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

### Streaming Example

```tsx
function StreamingChat({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <AIMarkdown content={content} streaming={isStreaming} colorScheme="dark" />;
}
```

## Props API Reference

### `AIMarkdownProps<TMetadata>`

All configuration is **flat props** resolved once against shipped defaults. An explicitly passed prop (`v != null`) overrides the shipped default; an absent prop falls to the shipped default. Passing `null` counts as absent — this guards against serialization boundaries (RSC, persistence) materializing "not passed" as `null` and punching through defaults.

The table below is also the **prop-name registry**: flat props share one namespace across core and every wrapper layer, so wrapper authors must check it — plus the wrappers they extend (e.g. mantine adds `codeBlock`) — before naming a new prop. A collision is a compile error at the `extends` site for TS consumers but a silent override for plain-JS consumers.

| Prop                       | Type                                | Default                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ----------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`                  | `string`                            | **(required)**         | Raw markdown content to render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `streaming`                | `boolean`                           | `false`                | Whether content is actively being streamed (e.g. from an LLM).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `streamingCursor`          | `ComponentType`                     | `undefined`            | Streaming cursor slot. While `streaming === true`, the given component is rendered after the markdown content and unmounted when streaming stops. Pass the exported `AIMarkdownStreamingCursor` for the built-in inline cursor. Compared by identity — define at module scope. Definition-aware: while a footnote definition streams, the cursor follows the text into its footer entry; it hides for tails it cannot truthfully point at (a streaming link-reference definition, which renders nothing; a definition whose footer entry lives in another chunk under cross-chunk coordination).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `fontSize`                 | `number \| string`                  | `'0.9375rem'`          | Base font size. Numbers are treated as pixels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `variant`                  | `AIMarkdownVariant`                 | `'default'`            | Typography variant name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `colorScheme`              | `AIMarkdownColorScheme`             | `'light'`              | Color scheme name (`'light'`, `'dark'`, or custom).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `metadata`                 | `TMetadata`                         | `undefined`            | Arbitrary data passed to custom components via a dedicated context. Deliberately never stabilized by the library — stabilization is the consumer's responsibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `contentPreprocessors`     | `AIMDContentPreprocessor[]`         | `undefined`            | Additional preprocessors run after the built-in LaTeX preprocessor. An optional `createRemendPreprocessor()` factory (streaming tail repair — unterminated `**bold`/`` `code `` render styled mid-stream) ships with the package; it is tree-shaken away unless imported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `customComponents`         | `AIMarkdownCustomComponents`        | `undefined`            | `react-markdown` component overrides for specific HTML elements.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Typography`               | `AIMarkdownTypographyComponent`     | `DefaultTypography`    | Typography wrapper component.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ExtraStyles`              | `AIMarkdownExtraStylesComponent`    | `undefined`            | Optional extra style wrapper rendered between typography and content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `documentId`               | `string`                            | auto via `useId()`     | Stable id for the _logical markdown document_ this `<AIMarkdown>` is rendering. Used as the id namespace for clobberable attributes (`id`, hash hrefs) so two documents on the same page do not cross-link (footnote `[^1]` in message A won't scroll to `[^1]` in message B). When one document is split into chunks rendered by multiple `<AIMarkdown>` instances, pass the SAME `documentId` to every chunk so prefixes align. The value is passed through `encodeURIComponent` before being injected into HTML attributes, so any string is safe (React's `useId()` output, your own opaque ids, user-supplied UUIDs — even ill-formed UTF-16 from a string truncated mid-emoji, which is hashed into the prefix and warns in dev builds). Long ids (>16 chars, e.g. UUIDs) are hashed via MurmurHash3 to a short Base62 form **inside the rendered `id="…"`/`href="#…"` prefix only** to keep HTML compact; the `documentId` exposed by `useAIMarkdownDocument()` and registry keying via `useDocumentRegistry` stay raw, so deep linking and any consumer code reading `documentId` are unaffected. |
| `urlTransform`             | `UrlTransform \| null`              | `defaultUrlTransform`  | Override the URL allowlist applied to `href`, `src`, and similar attributes. The default mirrors GitHub: `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`. Pass a function defined at module scope (or memoized) to permit additional schemes — see [Custom URL Schemes and Sanitization](#custom-url-schemes-and-sanitization).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sanitizeSchema`           | `SanitizeSchema`                    | library default        | Override the `rehype-sanitize` schema. Build with [`extendSanitizeSchema`](#custom-url-schemes-and-sanitization) so the library's cross-chunk tag and KaTeX className allowlists survive — hand-rolling silently drops them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `enginePlugins`            | `readonly AIMarkdownEnginePlugin[]` | `defaultEnginePlugins` | Sealed engine-plugin selection — accepts core-exported plugin objects from `@ai-react-markdown/core/plugins` only. Absent → all five shipped plugins; passing an array replaces the set wholesale. See [Engine Plugins](#engine-plugins).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `blockMemo`                | `boolean`                           | `true`                 | Block-level memoization. Output-invariant — flipping it changes no rendered byte. See [Behavior Props](#behavior-props).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `incrementalParse`         | `boolean`                           | `true`                 | Prefix-freeze incremental parsing for streaming. Output-invariant; effective only while `blockMemo` is `true`. See [Behavior Props](#behavior-props).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `preserveOrphanReferences` | `boolean`                           | `true`                 | Protect orphan footnote/link definitions in incomplete streaming documents. Affects output. See [Behavior Props](#behavior-props).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Engine Plugins

Optional pipeline features are selected through the `enginePlugins` prop, which accepts **sealed plugin objects** exported from the `@ai-react-markdown/core/plugins` subpath. All five are enabled by default.

| Plugin           | Description                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `highlight`      | `==Highlight==` syntax support                                                                          |
| `definitionList` | Definition list syntax ([PHP Markdown Extra](https://michelf.ca/projects/php-markdown/extra/#def-list)) |
| `removeComments` | Strip HTML comments                                                                                     |
| `smartypants`    | Typographic substitutions: curly quotes, em-dashes (`--`), ellipses (`...`)                             |
| `pangu`          | Auto-insert spaces between CJK and half-width characters                                                |

### Example: Selective Plugins

```tsx
import AIMarkdown from '@ai-react-markdown/core';
import { highlight, smartypants } from '@ai-react-markdown/core/plugins';

const PLUGINS = [highlight, smartypants]; // module scope — stable reference

<AIMarkdown content={markdown} enginePlugins={PLUGINS} />;
```

Passing an array **replaces the selection wholesale** (array-atomic semantics) — the example above enables only highlight and smartypants, disabling the other three. The recommended "turn one off" idiom:

```tsx
import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';

const PLUGINS = defaultEnginePlugins.filter((p) => p !== pangu);
```

Rules worth knowing:

- Omitting `enginePlugins` means `defaultEnginePlugins` (all five).
- Each plugin's position in the produced chain comes from its internal stage metadata; the order of your array is irrelevant. Duplicates are deduplicated with a dev warning.
- The set is **sealed**: only core constructs plugins (the incremental engine's boundary scanner must know every construct's syntax; open injection would void its verification record). Third-party content extension stays open through `contentPreprocessors` + `customComponents`.
- Plugin objects are not serializable. For remote-config scenarios, store `plugin.name` strings (typed as `AIMarkdownEnginePluginName`) and map them back to the exported singletons at the edge.
- The prop is deep-equal-stabilized as a backstop, but an inline array still pays one comparison per render — define the array at module scope.

## Behavior Props

Three flat boolean props control engine behavior:

| Prop                       | Type      | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockMemo`                | `boolean` | `true`  | Enables block-level memoization: the renderer splits each document into per-block units and memoizes each block's React subtree by source identity, so unchanged blocks skip `toJsxRuntime` and React reconcile work during streaming. Output is byte-identical to the disabled path. Set `blockMemo={false}` as an escape hatch for debugging.                                                                                                |
| `incrementalParse`         | `boolean` | `true`  | Prefix-freeze incremental parsing for streaming: when content grows by appends, the renderer freezes the stable document prefix at a verified-safe boundary and re-parses only the tail (83–94% less pipeline stage time on the benchmark payloads; footnotes and cross-chunk documents splice too). Output is deep-equal to a full parse — enforced by a per-frame splice-equivalence test suite. Effective only while `blockMemo` is `true`. |
| `preserveOrphanReferences` | `boolean` | `true`  | Protects orphan `[^x]: …` footnote definitions from being silently dropped by `mdast-util-to-hast` when no matching `[^x]` reference exists. Useful for streamed content where the reference may arrive in a later chunk. Inside `<AIMarkdownDocuments>`, the wrapper's `preserveOrphanReferences` prop overrides this prop unconditionally.                                                                                                   |

```tsx
<AIMarkdown content={markdown} blockMemo={false} incrementalParse={false} />
```

## Cross-chunk Coordination

When a single logical markdown document is split across multiple
`<AIMarkdown>` instances (chunked streaming for chat UIs, etc.), wrap
them in `<AIMarkdownDocuments>` and pass the SAME `documentId` to every
chunk to coordinate footnotes, link references, and image references
across chunks:

```tsx
import AIMarkdown, { AIMarkdownDocuments } from '@ai-react-markdown/core';

<AIMarkdownDocuments>
  {message.chunks.map((c, i) => (
    <AIMarkdown key={i} content={c} documentId={message.id} />
  ))}
</AIMarkdownDocuments>;
```

Without the wrapper, each `<AIMarkdown>` is independent — its
references resolve only within its own content (current standalone
behavior).

### `<AIMarkdownDocuments>` Props

| Prop                       | Type        | Default | Description                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preserveOrphanReferences` | `boolean`   | `true`  | Controls orphan-reference protection for every chunk under this wrapper. Unconditionally overrides each chunk's `preserveOrphanReferences` prop. Does not gate cross-chunk coordination itself (that's gated by wrapper + `documentId`).                                                                             |
| `smoothTurnTaking`         | `boolean`   | `true`  | Wrapper-level switch for smooth-stream turn-taking: when `true`, `<AIMarkdownSmoothStream>` chunks sharing this `documentId` type one at a time in mount order. `false` lets every chunk pace independently. See [smooth streaming → turn-taking](../../docs/smooth-streaming.md#multi-chunk-documents-turn-taking). |
| `children`                 | `ReactNode` | -       | The `<AIMarkdown>` instances to coordinate. Nesting `<AIMarkdownDocuments>` inside another `<AIMarkdownDocuments>` throws.                                                                                                                                                                                           |

### `useDocumentRegistry(documentId)`

Returns the cross-chunk `Registry` for the given `documentId`, or
`null` when called outside `<AIMarkdownDocuments>` or when
`documentId` is empty. The `Registry` shape is exported and stable
across minor versions — use it when writing typed helpers that operate
on the cross-chunk registry directly.

```tsx
import { useDocumentRegistry, type Registry } from '@ai-react-markdown/core';

function MyHelper({ documentId }: { documentId: string }) {
  const registry: Registry | null = useDocumentRegistry(documentId);
  // null when no <AIMarkdownDocuments> ancestor — treat as "run standalone".
}
```

## Custom URL Schemes and Sanitization

By default `<AIMarkdown>` only renders links and images whose URLs use the standard set of safe protocols (`http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`). Anything else — `javascript:`, `data:`, or your own `myapp://` — is stripped. This protects against XSS in LLM-generated markdown but also means private application schemes are unreachable without configuration.

### The Two-Gate Model

Sanitization runs in **two independent gates** (defense in depth):

1. **`rehype-sanitize` schema** — runs first, inside the rehype plugin chain, and drops the URL when the protocol is not in the schema's per-attribute allowlist (`protocols.href`, `protocols.src`, `protocols.cite`).
2. **`urlTransform`** — runs second, at render time during the hast traversal, on every URL-bearing attribute, and rewrites disallowed URLs to `''`. Called per-attribute with the attribute name (`'href'` / `'src'` / …) so key-aware transforms can discriminate (e.g. allow a scheme on `href` but not on `src` to block tracker pixels).

For a private scheme to render, **both gates must permit it**. Allowing only one is the most common pitfall.

**Cross-chunk symmetry.** When `<AIMarkdown>` instances are wrapped in `<AIMarkdownDocuments>`, link/image references resolved across chunks (chunk A defines `[evil]: …`, chunk B writes `[click][evil]`) go through both gates as well — the same `urlTransform` and `sanitizeSchema` you pass to `<AIMarkdown>` apply at render time. The per-attribute key (`'href'` vs `'src'`) is honored: a key-aware policy that permits a scheme on `<a>` but not `<img>` will produce identical behavior whether the reference is in-chunk or cross-chunk.

### Allowing a Custom Scheme

Define both gates at module scope so their reference identity is stable across renders (this keeps the per-block memo cache warm):

```tsx
import AIMarkdown, { defaultUrlTransform, extendSanitizeSchema } from '@ai-react-markdown/core';

// Gate 2: compose with the default so https/mailto/etc. still work.
const ALLOWED = /^myapp:/i;
const URL_TRANSFORM = (url, key, node) => (ALLOWED.test(url) ? url : defaultUrlTransform(url, key, node));

// Gate 1: extend the library schema so it permits the scheme on href + src.
const SCHEMA = extendSanitizeSchema((s) => {
  s.protocols!.href!.push('myapp');
  s.protocols!.src!.push('myapp');
});

function App() {
  return <AIMarkdown content={markdown} urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />;
}
```

### `extendSanitizeSchema((draft) => Schema | void)`

Hands you a deep clone of the library's default sanitize schema. Mutate it freely (the original singleton is never touched) or return a replacement object. Library invariants — cross-chunk coordination tags (`cross-chunk-link`, `cross-chunk-image`, `footnote-sup`), the KaTeX `math-inline` / `math-display` className allowlist, the `<mark>` allowance — survive untouched. **Hand-rolling a schema that doesn't spread these invariants silently breaks coordinated rendering**, which is why the helper is the recommended path.

```tsx
const SCHEMA = extendSanitizeSchema((s) => {
  s.tagNames.push('my-widget'); // add a tag
  s.protocols!.href!.push('myapp'); // permit a protocol
  s.attributes['my-widget'] = ['data-id', 'data-mode']; // allow attributes
  // No `return` needed — mutate-only is fine.
});
```

**Footguns** (also documented in JSDoc):

- Returning `null` is treated like returning nothing (the mutated draft is used).
- Reassigning the local parameter (`s = { ... }`) does NOT replace the draft — JS only rebinds the local. Either mutate the original or `return` an explicit value.
- Throwing inside the modifier propagates uncaught. Usually fine because the helper is called once at module load.

### Reference Stability and the Cache

Both `urlTransform` and `sanitizeSchema` participate in the per-block memo cache, but they are stabilized **asymmetrically**:

- **`urlTransform`** is tracked by identity only. A new function reference every render flushes the cache. Callers MUST supply a stable reference (module scope or `useMemo`).
- **`sanitizeSchema`** is tracked by identity AND additionally stabilized internally via a deep-equal safety net (`useStableValue`). An inline-but-deep-equal schema still works, just with a one-time deep compare on each render — cheaper than a cache flush but not free.

Why the asymmetry: function identity can't be deep-compared (two closures with identical bodies are always non-equal), so for `urlTransform` only the call-site can produce a stable reference. `sanitizeSchema` is plain data, so a deep compare is meaningful and serves as a guardrail for callers who forget the module-scope rule.

```tsx
// 🚫 Anti-pattern — `urlTransform` is recreated every render and discards
//    the entire markdown cache. `sanitizeSchema` would too without the
//    internal deep-equal safety net, but you still pay the deep-compare cost.
<AIMarkdown
  urlTransform={(url, k, n) => /* … */}
  sanitizeSchema={extendSanitizeSchema((s) => /* … */)}
/>

// ✅ Stable — both refs are minted once at module scope.
const URL_TRANSFORM = (url, k, n) => /* … */;
const SCHEMA = extendSanitizeSchema((s) => /* … */);
<AIMarkdown urlTransform={URL_TRANSFORM} sanitizeSchema={SCHEMA} />
```

In development the library will `console.warn` after detecting 3+ identity flips on either prop. The warning is dead-code-eliminated in production builds. Define both values at module scope, or memoize with `useMemo` if they depend on state.

### Regex Escaping for `+` / `-` / `.` in Scheme Names

Per RFC 3986 scheme names may contain `+`, `-`, and `.` — all regex metacharacters. Write `/^web\+app:/i`, **not** `/^web+app:/i` (the latter would match `we`, `wee`, `weee`, …, silently broadening the allowlist).

### Inspecting the Default Schema

`extendSanitizeSchema` hands the modifier a deep clone of the library default. That makes the helper itself the cleanest introspection path — no separate export of the singleton is needed:

```tsx
extendSanitizeSchema((s) => {
  console.log('default sanitize schema:', s);
});
```

Why no direct `sanitizeSchema` export? Because the obvious extension pattern — `{ ...sanitizeSchema, … }` — is a shallow spread. Nested arrays (`protocols.href`, `attributes.a`, `ancestors.*`, …) stay aliased to the singleton; a subsequent `.protocols.href.push(...)` mutates it, and the change leaks into every other `<AIMarkdown>` in your app that doesn't override `sanitizeSchema`. `extendSanitizeSchema` always works on a deep clone, so this class of bug is impossible by construction.

### API Stability of `UrlTransform` and `SanitizeSchema`

Both prop types track their respective upstream packages — `UrlTransform` follows `react-markdown`'s shape and `SanitizeSchema` follows `rehype-sanitize`'s. They may evolve with those packages' major versions. Hand-construct schemas via the helpers (rather than typing your own from scratch) and you'll inherit any upstream-driven changes automatically.

## Hooks

State is split across **five per-system contexts**. Each narrow hook subscribes to exactly one system and re-renders only when that system changes — a `streaming` flip no longer wakes every consumer. All throw if called outside the provider boundary (except `useAIMarkdownMetadata`, which returns `undefined` when no metadata was provided).

### The five narrow hooks

| Hook                                 | Returns                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `useAIMarkdownState()`               | `{ streaming, …extension state groups }`                                     |
| `useAIMarkdownTheme()`               | `{ fontSize, variant, colorScheme }`                                         |
| `useAIMarkdownDocument()`            | `{ documentId, documentIdExplicit, clobberPrefix }`                          |
| `useAIMarkdownBehaviors()`           | `{ blockMemo, incrementalParse, preserveOrphanReferences, …wrapper groups }` |
| `useAIMarkdownMetadata<TMetadata>()` | `TMetadata \| undefined`                                                     |

```tsx
import { useAIMarkdownState, useAIMarkdownTheme } from '@ai-react-markdown/core';

function CustomCodeBlock({ children }: PropsWithChildren) {
  const { streaming } = useAIMarkdownState();
  const { colorScheme } = useAIMarkdownTheme();

  if (streaming) {
    return <pre className={`streaming ${colorScheme}`}>{children}</pre>;
  }
  return <pre className={colorScheme}>{children}</pre>;
}
```

Field reference:

| Field                                                         | Hook                       | Type                    | Description                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `streaming`                                                   | `useAIMarkdownState()`     | `boolean`               | Whether content is being streamed.                                                                                                                                                                                                                                                                                                                                                   |
| `fontSize`                                                    | `useAIMarkdownTheme()`     | `string`                | Resolved CSS font-size value.                                                                                                                                                                                                                                                                                                                                                        |
| `variant`                                                     | `useAIMarkdownTheme()`     | `AIMarkdownVariant`     | Active typography variant.                                                                                                                                                                                                                                                                                                                                                           |
| `colorScheme`                                                 | `useAIMarkdownTheme()`     | `AIMarkdownColorScheme` | Active color scheme.                                                                                                                                                                                                                                                                                                                                                                 |
| `documentId`                                                  | `useAIMarkdownDocument()`  | `string`                | Stable id for the logical markdown document — caller-supplied or auto-generated via `useId()`.                                                                                                                                                                                                                                                                                       |
| `documentIdExplicit`                                          | `useAIMarkdownDocument()`  | `boolean`               | Whether `documentId` was explicitly supplied by the caller (vs. auto-generated). Internal coordination signal — `useDocumentRegistry` uses it so an auto-generated id never opts a standalone chunk into cross-chunk coordination. Most custom components can ignore this.                                                                                                           |
| `clobberPrefix`                                               | `useAIMarkdownDocument()`  | `string`                | URI-safe id prefix derived from `documentId` (with MurmurHash3 → Base62 shortening applied for >16-char ids), used by every clobberable HTML attribute (`id=…` / `href="#…"`). Read this from the hook rather than recomputing locally when writing components that emit anchors — the prefix's exact byte form is not part of the stability contract and may shift across versions. |
| `blockMemo` / `incrementalParse` / `preserveOrphanReferences` | `useAIMarkdownBehaviors()` | `boolean`               | The resolved behavior switches — same names as the flat props.                                                                                                                                                                                                                                                                                                                       |

### `useAIMarkdown()` — the aggregate

```tsx
const { document, metadata, state, theme, behaviors } = useAIMarkdown();
```

Subscribes to **all five contexts** and re-renders on ANY change — including every `streaming` flip. It serves teaching code and low-frequency components; performance-sensitive components should use the narrow hooks.

### `useAIMarkdownMetadata<TMetadata>()`

Access arbitrary metadata from within the `<AIMarkdown>` tree. Metadata lives in a **separate** React context from render state, so metadata changes do not trigger re-renders in components that only consume render state.

```tsx
import { useAIMarkdownMetadata } from '@ai-react-markdown/core';

interface MyMetadata {
  onCopyCode: (code: string) => void;
  messageId: string;
}

function CustomCodeBlock({ children }: PropsWithChildren) {
  const metadata = useAIMarkdownMetadata<MyMetadata>();
  return (
    <pre>
      <button onClick={() => metadata?.onCopyCode(String(children))}>Copy</button>
      {children}
    </pre>
  );
}
```

**Returns** `TMetadata | undefined` -- `undefined` when no metadata was provided.

### `useStableValue<T>(value: T)`

Returns a referentially stable version of `value`. On each render the new value is deep-compared (via `lodash/isEqual`) against the previous one. If they are structurally equal, the previous reference is returned, preventing unnecessary re-renders in downstream `useMemo`/`useEffect` consumers.

```tsx
import { useStableValue } from '@ai-react-markdown/core';

const stableConfig = useStableValue(config);
// stableConfig keeps the same reference as long as config is deep-equal.
```

### `useStableRecord(record, table)`

The stability firewall used internally, exported for wrapper authors. Returns a referentially stable version of `record` according to a per-key `AIMarkdownStabilityPolicy` table:

- `DEEP_EQUAL` — restore the previous reference when the new value is deep-equal (plain-data props).
- `WARN_ONLY` — pass through, but warn in dev after repeated identity flips (functions/components, where deep comparison is meaningless).
- `PASS_THROUGH` — declared exemption, no stabilization (e.g. `metadata`).

A wrapper builds a table only for the object props it terminates itself (e.g. mantine's `codeBlock`); props forwarded to `<AIMarkdown>` ride core's firewall untouched.

```tsx
import { useStableRecord, AIMarkdownStabilityPolicy, type AIMarkdownStabilityTable } from '@ai-react-markdown/core';

const TABLE: AIMarkdownStabilityTable<{ panel: Partial<PanelOptions> | undefined }> = {
  panel: AIMarkdownStabilityPolicy.DEEP_EQUAL,
};

const stable = useStableRecord({ panel }, TABLE);
```

## Additive Providers

Core exports two stackable Providers — `AIMarkdownBehaviorsProvider` and `AIMarkdownStateProvider` — so wrappers and applications can transport their own extension groups through core's contexts. Stack the Provider **outside** `<AIMarkdown>`; consumers still see exactly one context:

```tsx
import { useMemo } from 'react';
import AIMarkdown, { AIMarkdownBehaviorsProvider, type AIMarkdownBehaviorGroups } from '@ai-react-markdown/core';

const NO_GROUPS: AIMarkdownBehaviorGroups = Object.freeze({});

function MyMarkdown({ panel, ...rest }: MyMarkdownProps) {
  // Absent prop → contribute NO group (an outer app-level Provider's
  // `panel` group then stays visible); present prop wins via inner-wins.
  const groups = useMemo<AIMarkdownBehaviorGroups>(() => (panel != null ? { panel } : NO_GROUPS), [panel]);
  return (
    <AIMarkdownBehaviorsProvider value={groups}>
      <AIMarkdown {...rest} />
    </AIMarkdownBehaviorsProvider>
  );
}
```

- **Core keys are locked.** Behaviors (`blockMemo`, `incrementalParse`, `preserveOrphanReferences`) and state (`streaming`) cannot be injected from outside — type-forbidden, unconditionally overwritten by the prop-resolved values at the innermost merge, and warned about in dev.
- Multi-level wrappers stack naturally; for a duplicated group key the inner layer wins.
- `AIMarkdownStateProvider` carries extension lifecycle states (aborted, reasoning, tool-call-in-progress, …). Group members must be message-lifecycle frequency — frame-rate data (per-token progress etc.) still goes through metadata's stable-container pattern.
- Apply group defaults inside your wrapper's narrow hook exactly once (the pattern behind mantine's `useMantineCodeBlockOptions()`); bare `??` fallbacks at multiple read sites will drift.

### Group-key registry

Group keys share one namespace per context (behaviors, state) across every wrapper layer and the application — a duplicated key resolves by inner-wins **silently**, so this registry is the collision governance, the same way the props table above governs flat prop names. Wrapper packages: register your keys here via PR before shipping. Applications: use app-scoped names (`chatPanel`, not `panel`) to stay clear of future wrapper keys.

| Group key   | Context   | Owner                        |
| ----------- | --------- | ---------------------------- |
| `codeBlock` | behaviors | `@ai-react-markdown/mantine` |

**Reservation policy**: core will not promote a registered group key into a core-locked key (the `never`-typed lock) within the 2.x line — promotion retroactively breaks every downstream compile that used the key, so it is by definition a major-version change.

## Typography and Styling

The `<AIMarkdown>` component wraps its content in a typography component that controls font size, variant, and color scheme.

### Built-in Default Typography

The built-in `DefaultTypography` renders a `<div>` with CSS class names for the active variant and color scheme:

```html
<div class="aim-typography-root default light" style="width: 100%; font-size: 0.9375rem">
  <!-- markdown content -->
</div>
```

Import the corresponding CSS to activate styles:

```tsx
import '@ai-react-markdown/core/typography/default.css';
```

#### Customization tokens

All `default`-variant styles are driven by CSS custom properties declared on `.aim-typography-root.default`. Spacing, font-size, and heading tokens are **anchored to `--aim-font-size-root`** (injected by the renderer from the `fontSize` prop), so changing `fontSize` proportionally scales every dimension. To customize, override any token in your own stylesheet:

```css
.aim-typography-root.default {
  --aim-spacing-md: calc(var(--aim-font-size-root) * 1.2); /* roomier paragraphs */
  --aim-h1-font-size: calc(var(--aim-font-size-root) * 2.5); /* bigger H1 */
  --aim-font-weight-strong: 600; /* lighter headings + th */
  --aim-color-anchor: #ff6b6b; /* red links */
}
```

| Group         | Tokens                                                                                      | Notes                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing       | `--aim-spacing-{xs,sm,md,lg,xl}`                                                            | `calc(var(--aim-font-size-root) * k)` where `k ∈ {0.625, 0.75, 1, 1.25, 1.5}`                                                                                                           |
| Font size     | `--aim-font-size-{xs,sm,md,lg,xl}`                                                          | `k ∈ {0.75, 0.875, 1, 1.125, 1.25}`                                                                                                                                                     |
| Heading sizes | `--aim-h{1..6}-font-size`                                                                   | Multipliers mirror Mantine's heading scale (`{2.125, 1.625, 1.375, 1.125, 1, 0.875}`)                                                                                                   |
| Heading meta  | `--aim-h{1..6}-line-height`, `--aim-h{1..6}-font-weight`                                    | line-heights are unitless; weights default to `var(--aim-font-weight-strong)`                                                                                                           |
| Weight        | `--aim-font-weight-strong`                                                                  | Shared by all headings and `<th>`. Default `700`.                                                                                                                                       |
| KaTeX         | `--aim-katex-font-size`                                                                     | Defaults to `var(--aim-font-size-root)`, so formulas stay at the component-root size regardless of parent context (blockquote, heading). Override to `1em` if you want parent-relative. |
| Misc          | `--aim-line-height`, `--aim-radius-sm`, `--aim-font-family-{monospace,headings}`            | Unitless / rem / font-stack constants.                                                                                                                                                  |
| Color (light) | `--aim-color-{text,dimmed,anchor,border,code-bg,code-text,blockquote-bg,mark-bg,mark-text}` | Declared on `.aim-typography-root.light`; dark variants on `.aim-typography-root.dark`.                                                                                                 |

> **Stability contract:** the _names_ and _roles_ of these tokens follow semver. The exact default _values_ (multipliers, colors) may shift under minor bumps as the visual design evolves — override the token if you need a specific value to be locked.

### Custom Typography Component

Replace the typography wrapper by passing a custom component. The `style` prop carries CSS custom properties injected by the core renderer — **merge it onto your root element** so that descendant CSS can reference these variables:

```tsx
import type { AIMarkdownTypographyProps } from '@ai-react-markdown/core';

function MyTypography({ children, fontSize, variant, colorScheme, style }: AIMarkdownTypographyProps) {
  return (
    <div className={`my-markdown ${colorScheme}`} style={{ fontSize, ...style }}>
      {children}
    </div>
  );
}

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

#### Injected CSS Custom Properties

The core renderer injects the following CSS custom properties via the Typography `style` prop:

| Variable               | Value           | Purpose                                                                                                                                                                                             |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--aim-font-size-root` | `fontSize` prop | Absolute font-size anchor for the component instance. Inner CSS can use `var(--aim-font-size-root)` to bypass `em` compounding in deeply nested markdown structures (e.g. code inside blockquotes). |

**Why `--aim-font-size-root`?** Markdown content frequently nests elements that use relative `em` units — blockquotes, lists, code blocks. Each nesting level compounds the effective size: a `0.875em` code span inside a `1.125em` blockquote resolves to `0.984em` of the parent, not `0.875em` of the root. This variable provides a stable, absolute reference that inner CSS rules can use to opt out of compounding when a fixed size is needed.

The built-in `default` variant already consumes this variable — all of its spacing, font-size, and heading tokens are defined as `calc(var(--aim-font-size-root) * k)`, so changing the `fontSize` prop on `<AIMarkdown>` proportionally scales every rendered dimension. See [Customization tokens](#customization-tokens) above for the full surface.

### Extra Styles Wrapper

The `ExtraStyles` prop accepts a component rendered between the typography wrapper and the markdown content. Useful for injecting additional CSS scope or theme providers:

```tsx
import type { AIMarkdownExtraStylesProps } from '@ai-react-markdown/core';

function MyExtraStyles({ children }: AIMarkdownExtraStylesProps) {
  return <div className="my-extra-scope">{children}</div>;
}

<AIMarkdown content={markdown} ExtraStyles={MyExtraStyles} />;
```

## Custom Components

Override the default renderers for specific HTML elements using the `customComponents` prop. This maps directly to `react-markdown`'s `Components` type:

```tsx
import type { AIMarkdownCustomComponents } from '@ai-react-markdown/core';

const components: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" />,
};

<AIMarkdown content={markdown} customComponents={components} />;
```

## Streaming Support

Pass `streaming={true}` when content is actively being generated (e.g. token-by-token from an LLM). The flag is propagated to all descendant components via `useAIMarkdownState()`, allowing custom renderers to adapt their behavior (e.g. show a cursor, disable copy buttons, or skip animations).

```tsx
function ChatMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <AIMarkdown content={content} streaming={isStreaming} />;
}
```

## Metadata

The `metadata` prop lets you pass arbitrary data to deeply nested custom components without prop drilling. Metadata is stored in a **separate React context** from the render state, so updating metadata does not cause re-renders in components that only read render state (like the core `MarkdownContent`).

```tsx
interface ChatMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
}

<AIMarkdown<ChatMetadata>
  content={markdown}
  metadata={{
    messageId: msg.id,
    onCopyCode: handleCopy,
    onRegenerate: handleRegenerate,
  }}
/>;
```

## Content Preprocessors

The rendering pipeline runs a LaTeX preprocessor by default. You can append additional preprocessors that transform the raw markdown string before it enters the remark/rehype pipeline:

```tsx
import type { AIMDContentPreprocessor } from '@ai-react-markdown/core';

const stripFrontmatter: AIMDContentPreprocessor = (content) => content.replace(/^---[\s\S]*?---\n/, '');

<AIMarkdown content={markdown} contentPreprocessors={[stripFrontmatter]} />;
```

Preprocessors run in sequence: built-in LaTeX preprocessor first, then your custom ones in array order.

## TypeScript Generics

The component takes one generic type parameter — `TMetadata` for type-safe metadata:

```tsx
import AIMarkdown, { type AIMarkdownMetadata } from '@ai-react-markdown/core';

interface MyMetadata extends AIMarkdownMetadata {
  messageId: string;
}

<AIMarkdown<MyMetadata> content={markdown} metadata={{ messageId: '123' }} />;
```

The metadata hook accepts the matching generic:

```tsx
const metadata = useAIMarkdownMetadata<MyMetadata>();
```

Sub-packages extend the **flat prop surface** instead of a config generic: `@ai-react-markdown/mantine`'s `MantineAIMarkdownProps<TMetadata> extends AIMarkdownProps<TMetadata>` adds a `codeBlock` prop, transports it through `AIMarkdownBehaviorsProvider`, and asserts the group type exactly once inside its own narrow hook (`useMantineCodeBlockOptions()`). See [Additive Providers](#additive-providers) above and [Extending via a sub-package](../../docs/extending-via-subpackage.md).

## Architecture Overview

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          // Separate context for metadata
    <AIMarkdownProvider>                // Per-system contexts: document, state, theme, behaviors
      <Typography>                      // Configurable typography wrapper
        <ExtraStyles?>                  // Optional extra style wrapper
          <AIMarkdownContent />         // react-markdown with remark/rehype plugin chain
        </ExtraStyles?>
      </Typography>
    </AIMarkdownProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

State is deliberately split across five per-system contexts (document, metadata, state, theme, behaviors) so a change in one system — a metadata callback swap, a `streaming` flip — only re-renders that system's subscribers.

## Exported API

### Default Export

- `AIMarkdown` -- the main component (memoized)

### Components

- `AIMarkdownDocuments` -- optional outer wrapper enabling cross-chunk coordination
- `AIMarkdownStreamingCursor` -- built-in inline cursor for the `streamingCursor` slot
- `AIMarkdownSmoothStream` -- `<AIMarkdown>` plus typewriter pacing (`smooth*` props); chunks sharing a `documentId` under `<AIMarkdownDocuments>` reveal turn-by-turn (one typewriter, one cursor); see [docs/smooth-streaming.md](../../docs/smooth-streaming.md)

### Providers

- `AIMarkdownBehaviorsProvider` -- additive transport for wrapper/app behavior groups (stack outside `<AIMarkdown>`)
- `AIMarkdownStateProvider` -- additive transport for extension lifecycle-state groups

### Hooks

- `useAIMarkdownState()`, `useAIMarkdownTheme()`, `useAIMarkdownDocument()`, `useAIMarkdownBehaviors()`, `useAIMarkdownMetadata<T>()` -- the five narrow hooks
- `useAIMarkdown()` -- the aggregate (subscribes to all five contexts)
- `useDocumentRegistry()`
- `useSmoothStream()` -- typewriter pacing as a hook; returns a props-shaped `{ content, streaming, flush }` that spreads into any wrapper
- `useDocumentSmoothStream()` -- `useSmoothStream` plus document turn-taking: pass a `documentId` and, under `<AIMarkdownDocuments>`, chunks reveal in mount order (one typewriter, one cursor); degrades to plain `useSmoothStream` without one
- `useStableValue()`
- `useStableRecord()` -- the stability firewall, for wrapper authors

### Factories

- `defineTheme`, `defineBehaviors`, `definePipeline` -- frozen, typed, reference-stable flat prop fragments (identity + types + `Object.freeze`, zero logic)
- `createRemendPreprocessor()` -- opt-in streaming tail-repair factory for `contentPreprocessors` (tree-shakeable)
- `createSmoothStreamController()` -- the framework-free pacing core beneath `useSmoothStream` (no React/DOM dependency); accepts advanced numeric overrides on top of the pacing presets
- `SMOOTH_STREAM_PACING_PRESETS` -- the frozen parameter bundles behind the three `smoothPacing` presets

### Constants and Helpers

- `defaultUrlTransform` -- the library's built-in URL-allowlist transform; compose with this when supplying a custom `urlTransform`
- `extendSanitizeSchema((draft) => Schema | void)` -- mutate-and-return factory that produces a sanitize schema from a deep clone of the library default; preserves cross-chunk and KaTeX invariants
- `AIMarkdownStabilityPolicy` -- policy enum for `useStableRecord` tables (`DEEP_EQUAL` / `WARN_ONLY` / `PASS_THROUGH`)

### `@ai-react-markdown/core/plugins` (subpath)

- `highlight`, `definitionList`, `smartypants`, `pangu`, `removeComments` -- the sealed engine plugin singletons
- `defaultEnginePlugins` -- all five, the shipped default selection

### Types

- `AIMarkdownProps`
- `AIMarkdownDocumentsProps`
- `AIMarkdownCustomComponents`
- `AIMarkdownMetadata`
- `AIMarkdownEnginePlugin`, `AIMarkdownEnginePluginName` -- sealed plugin type + its name union (the serialization escape hatch)
- `AIMarkdownTypographyProps`
- `AIMarkdownTypographyComponent`
- `AIMarkdownExtraStylesProps`
- `AIMarkdownExtraStylesComponent`
- `AIMarkdownVariant`
- `AIMarkdownColorScheme`
- `AIMDContentPreprocessor`, `RemendPreprocessorOptions`
- `AIMarkdownThemeProps`, `AIMarkdownBehaviorProps`, `AIMarkdownPipelineProps` -- the `define*` factory input types
- `AIMarkdownStabilityTable` -- table type for `useStableRecord`
- Context payload types: `AIMarkdownDocumentInfo`, `AIMarkdownThemeInfo`, `AIMarkdownStateCore`, `AIMarkdownBehaviorsCore`, `AIMarkdownStateGroups`, `AIMarkdownBehaviorGroups`, `AIMarkdownExtensionGroups`, `AIMarkdownAggregate`
- Streaming cursor types: `AIMarkdownStreamingCursorProps`, `AIMarkdownStreamingIndicatorProps`, `AIMarkdownStreamingIndicatorComponent`
- Smooth streaming types: `AIMarkdownSmoothStreamProps`, `SmoothStreamController`, `SmoothStreamOptions`, `SmoothStreamPacing`, `SmoothStreamPacingParams`, `UseSmoothStreamOptions`, `UseSmoothStreamResult`, `UseDocumentSmoothStreamOptions`
- `UrlTransform`, `SanitizeSchema` -- prop-type aliases for the URL handling props (track upstream `react-markdown` / `rehype-sanitize` shapes)
- Cross-chunk registry types: `Registry`, `ChunkData`, `FootnoteDef`, `LinkDef`, `RefRecord`, `RefKind`

## License

MIT
