# @ai-markdown/vue

Vue 3 Markdown rendering built on the framework-independent `@ai-markdown/core` and `@ai-markdown/engine`. This package supplies real Vue VNodes, server rendering and hydration, scoped document references, component/slot customization, smooth streaming and a measured streaming cursor. It replaces the earlier private lifecycle prototype.

**Source implementation; first npm publication is pending.** The existing `3.0.0-beta.1` release did not include Vue. The install commands below apply once a Vue beta has been published; while developing this checkout, use the workspace package. Stable 3.0.0 is a separate release decision after the API review and release gates.

## Requirements and dependencies

- Vue **3.5 or later within Vue 3** (`^3.5.0`). The adapter uses `useId()` for application-local IDs that match between server rendering and hydration. Earlier Vue 3 minors do not provide this API.
- Node `>=20` for server/build consumers; verification records identify the actual tested Node version.
- Modern browsers with `ResizeObserver`, `MutationObserver`, `requestAnimationFrame` and Web Crypto. The browser acceptance suite currently runs Chromium; this is not a claim that every browser/version has been exercised.
- `@ai-markdown/core` and `@ai-markdown/engine` are ordinary dependencies at the exact release-train version. Applications do not need to install them separately. Vue remains a peer and is external to both ESM and CJS output.
- KaTeX is an optional peer (`^0.16 || ^0.17`). Declare it directly when importing its stylesheet rather than depending on hoisting.

After first publication:

```bash
pnpm add @ai-markdown/vue@beta vue@^3.5.0 katex
```

## Minimal component

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';
import 'katex/dist/katex.min.css';

const content = ref('# Answer\n\n**Markdown**, $x^2$ and 中文.');
</script>

<template>
  <AIMarkdown :content="content" />
</template>
```

Pass the **complete accumulated Markdown string**. Append decoded network data to your application state; the renderer does not own Fetch, SSE framing, UTF-8 decoding, cancellation or retries. Replacing the string is supported and invalidates retained parsing when necessary. `streaming` controls UI state; it is not the switch that enables incremental parsing.

`styles.css` provides a small base stylesheet, including code overflow, tables and cursor animation. It is optional when the application supplies its own presentation. KaTeX CSS is separate. The renderer never uses `v-html` or `innerHTML` to insert the Markdown result.

## Component props

| Prop                       | Default                  | Contract                                                                                            |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `content`                  | Required                 | Complete current source string                                                                      |
| `documentId`               | Vue `useId()`            | Explicit IDs coordinate only inside `AIMarkdownDocuments`; generated IDs stay standalone            |
| `documentIndex`            | Mount order              | Optional ordering hint for the reference registry; supply it for reordered/remounted logical chunks |
| `streaming`                | `false`                  | Passed to custom components and element slots, controls cursor and `aria-busy`                      |
| `incrementalParse`         | `true` after mount       | Uses verified retained-prefix parsing; server and hydration's first render use the full pipeline    |
| `preserveOrphanReferences` | `false`                  | Preserve unreferenced footnote bodies according to shared engine/core policy                        |
| `enginePlugins`            | All five shipped plugins | Sealed catalog selection; membership changes, canonical ordering does not                           |
| `contentPreprocessors`     | `[]`                     | Synchronous string transforms after built-in LaTeX normalization                                    |
| `sanitizeSchema`           | Library schema           | Treat as immutable; derive a fresh schema with `extendSanitizeSchema`                               |
| `urlTransform`             | Safe default transform   | Final attribute-specific URL policy after sanitization                                              |
| `components`               | `{}`                     | Tag-to-Vue-component mapping                                                                        |
| `metadata`                 | `undefined`              | Application-owned value passed to mapped components and scoped element slots                        |
| `streamingCursor`          | `true`                   | Enable the cursor while streaming; custom rendering uses the `cursor` slot                          |

Root attributes such as `class`, `id` and `style` fall through to the wrapper. The wrapper establishes a relative positioning context for the cursor. Supplying a different `position` style can change that geometry.

## Custom Vue components and slots

A mapped component receives the sanitized element attributes plus `node`, `streaming` and `metadata`. Its default slot contains converted Vue children. Declare the props you consume and forward attributes deliberately; framework event handlers belong to your component code, not Markdown attributes.

```vue
<script setup lang="ts">
import AIMarkdown from '@ai-markdown/vue';
import CodeBlock from './CodeBlock.vue';
const components = { code: CodeBlock };
</script>

<template>
  <AIMarkdown content="**Hello**" :components="components" :metadata="{ messageId: 'a' }"> </AIMarkdown>
</template>
```

For arbitrary VNode children, a render-function slot is often simpler than a template loop:

```ts
import { h } from 'vue';
import AIMarkdown, { type MarkdownElementContext } from '@ai-markdown/vue';

const render = () =>
  h(
    AIMarkdown,
    { content: '**Hello**' },
    {
      strong: ({ children, metadata }: MarkdownElementContext) =>
        h('strong', { title: String(metadata ?? '') }, children),
    }
  );
```

An element slot takes precedence over the matching `components` entry. Markdown text is not interpreted as a Vue template. The adapter rejects event attributes and DOM insertion properties even if a broadened sanitizer admits them. Custom components and slots are trusted application code and are responsible for their own output policy.

## Multiple chunks in one document

```vue
<script setup lang="ts">
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/vue';
const chunks = ['A claim[^source] and [site][url].', '[^source]: Shared citation\n\n[url]: https://example.com'];
</script>

<template>
  <AIMarkdownDocuments>
    <AIMarkdown
      v-for="(chunk, index) in chunks"
      :key="index"
      :content="chunk"
      document-id="answer-1"
      :document-index="index"
    />
  </AIMarkdownDocuments>
</template>
```

Chunks are intentionally complete logical Markdown sections. A code fence, table row or other syntax construct split across arbitrary transport chunks is not joined by the registry. Prefer one accumulated `content` unless the application genuinely needs independently mounted sections.

References may precede definitions. The shared registry supplies canonical link/image destinations, global footnote numbering and occurrence IDs. The last registered chunk renders the aggregate footer. Updating/removing a definition updates readers; switching `documentId` releases the old registration. Different IDs and different provider instances remain independent.

SSR renders each chunk's local content and local footnotes without registering or publishing contributions. The first hydration render uses the same path. Cross-chunk resolution becomes available after mounted contributions commit. Consequently, a definition supplied only by another chunk is not pre-resolved in server HTML. If server-only output needs fully resolved references, render the complete document through one component.

## Smooth streaming and turn-taking

`AIMarkdownSmoothStream` accepts the base props plus `pacing` (`smooth`, `balanced`, `responsive`) and `coordinate` (default `true`). Its initial content is shown completely, including SSR and remounts. Future appends animate. Finishing the source drains the remaining reveal before clearing the rendered streaming state. Replacements snap rather than replaying unrelated content.

Inside `AIMarkdownDocuments`, explicitly named smooth chunks share a turn-taking coordinator. A chunk mounted empty waits until earlier registered smooth chunks finish. A chunk mounted with content does not hide already visible text. Completion is sticky for the current registration: a later resumed stream does not re-gate successors. Reveal order is mount order; `documentIndex` orders references, not smooth turns.

```vue
<AIMarkdownSmoothStream :content="content" :streaming="!finished" pacing="responsive" document-id="answer-1">
  <template #waiting><span>Waiting for the previous section…</span></template>
  <template #cursor><span>▍</span></template>
</AIMarkdownSmoothStream>
```

The component exposes `flush()` through its template ref. Flushing respects the engine's grapheme hold-back while the source is live; it does not pretend that an unfinished grapheme is complete.

For your own wrapper, call `useSmoothStream(() => ({ content, streaming, pacing }))` or `useDocumentSmoothStream(() => ({ content, streaming, pacing, documentId, coordinate }))` during setup. Returned `content` and `streaming` are read-only computed refs; the document variant also returns `pending`. Pass `.value` in render functions and let templates unwrap refs. Always pass a getter over live state rather than capturing a one-time object snapshot.

## Cursor behavior

The cursor measures the final visible prose text using DOM ranges and follows content mutation, resizing and scrolling. Code, math, image and unsupported element tails hide it rather than anchoring to an earlier paragraph. Shared `deriveTailSignal` identifies invisible link definitions and footnote-definition tails; a footnote cursor is shown only when its actual footer is in this component. Observers and animation frames are released on unmount. The default animation respects reduced motion.

## API and distribution

The root exports `AIMarkdown` (also default), `AIMarkdownDocuments`, `AIMarkdownSmoothStream`, `AIMarkdownStreamingCursor`, `useSmoothStream` and `useDocumentSmoothStream`, plus their prop/context/input types. It re-exports the sealed plugin catalog, LaTeX/remend preprocessor factories, schema extension and default URL policy. See the [checked public declaration](../../docs/api/vue.api.txt) for exact names and signatures.

ESM and CJS each have development and production entries, with matching declaration files. Vue, core and engine remain external. There is no React peer, React context or `use client` directive. The public package exposes only its root, stylesheet and `package.json`; lifecycle helpers and the HAST converter are implementation details.

## Verification and scope

```bash
pnpm build
pnpm --filter @ai-markdown/vue typecheck
pnpm --filter @ai-markdown/vue test
pnpm test:vue-browser
pnpm check:public-api
pnpm test:packed-consumers
```

Unit tests exercise SSR, sanitization, custom rendering and lifecycle publication/release. Browser tests cover the three planned acceptance paths: standalone hydration; cross-chunk references and document switching; customization, smooth waiting/drain and cursor layout. Packed consumers load ESM/CJS in both export conditions, compile installed declarations and resolve CSS outside the workspace.

This implementation does not claim React/Mantine UI parity: Mantine remains React-only, and Vue has no built-in Mermaid/code-toolbar integration. Nuxt-specific packaging, KeepAlive/Suspense combinations and additional browser engines require their own integration coverage before being advertised. Parsing correctness continues to use the repository's shared oracle and release soak gates.

## Browser stress verification

After building the workspace, run `pnpm test:vue-browser` from the repository root. This command is included in CI, release verification, and local preflight. It checks hydration, cross-chunk references, custom rendering, smooth-stream turn-taking, and cursor placement in Chromium.

The same command keeps a document provider mounted through 24 document lifecycles and 288 append updates. It checks that queued chunks wait for their predecessor, completion drains correctly, cancelling a producing predecessor releases its successor, replacement and document switches update the rendered result, and unmount releases every instrumented document subscription. Weak references to actual registries and smooth coordinators must clear after forced garbage collection while the provider remains mounted. This catches retained document state without relying on a noisy absolute heap-size threshold.

These are bounded browser regressions, not an engine equivalence soak or a proof of unlimited-session memory stability. They do not establish behavior in other browsers, Nuxt, KeepAlive, or Suspense. The engine's separate six-leg campaign does not substitute for these Vue lifecycle checks.
