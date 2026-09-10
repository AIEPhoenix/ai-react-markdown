# Getting started

ai-markdown renders accumulated Markdown in React 19 or Vue 3.5. Both adapters use the same parsing engine and shared orchestration; their components, customization and lifecycle APIs follow their host framework. The current package train is `3.0.0-beta.2`. Install with `@beta` to select the prerelease train explicitly, or pin that exact version for reproducible integrations.

## Choose a package

| Package                              | Install directly when…                                                            | Public entries                        |
| ------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| `@ai-markdown/react`                 | Building a React application                                                      | Root, `/plugins`, `/typography/*.css` |
| `@ai-markdown/vue`                   | Building a Vue 3.5 application                                                    | Root, `/styles.css`                   |
| `@ai-markdown/react-mantine`         | Adding Mantine 9 typography, code highlighting and Mermaid to React               | Root, `/styles.css`                   |
| `@ai-markdown/core`                  | Building a framework adapter that needs sessions, plans and document coordination | Root                                  |
| `@ai-markdown/engine`                | Building an adapter or a string/AST pipeline                                      | Root                                  |
| `@ai-markdown/remark-mark-highlight` | Adding `==mark==` to an independent unified pipeline                              | Root                                  |

Every package also exposes `/package.json`. Import only public entries; `src/` and internal `dist/` paths are not supported application imports. `@ai-markdown/react/plugins` is a subpath of the React package, not a separate package to install. Vue exports its sealed plugins from its root.

React and Vue each depend on matching exact versions of core and engine. Core depends on engine. Mantine has an exact React peer during beta, so upgrade those two together. Applications normally install only their adapter and its peers. The highlight plugin is an engine dependency on an independent `1.0.1` version line and does not use the framework `@beta` tag.

The legacy `@ai-react-markdown/core` was a React renderer; its replacement is `@ai-markdown/react`. The new `@ai-markdown/core` has no React components or Vue components. See the [migration guide](./framework-transition.md) before renaming existing imports.

## React 19

In a React application:

```bash
pnpm add @ai-markdown/react@beta react@^19 react-dom@^19 katex
```

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import 'katex/dist/katex.min.css';

export function Answer() {
  return <AIMarkdown content={'# Answer\n\n**Markdown**, $x^2$ and 中文.'} />;
}
```

The default typography CSS supplies the React presentation and `--aim-*` tokens. A custom `Typography` can provide its own styles. In a React Server Components application, render the adapter from a client boundary; load global styles in the application's permitted global stylesheet entry. See the [React README](../packages/react/README.md) for props and environment details.

## Vue 3.5

In a Vue application:

```bash
pnpm add @ai-markdown/vue@beta vue@^3.5.0 katex
```

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

Vue's stylesheet supplies basic code/table layout and cursor animation. Customize the wrapper with `class` and `style`, or replace element renderers with `components` and scoped slots. React typography variants, hooks and `--aim-*` token contracts do not belong to Vue. See the [Vue README](../packages/vue/README.md) for SSR/hydration and complete examples.

## React with Mantine 9

```bash
pnpm add @ai-markdown/react@beta @ai-markdown/react-mantine@beta \
  react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 \
  highlight.js@^11.11.2 katex
```

````tsx
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '@ai-markdown/react-mantine';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-markdown/react-mantine/styles.css';
import 'katex/dist/katex.min.css';

const adapter = createHighlightJsAdapter(hljs);

export function Answer() {
  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={adapter}>
        <MantineAIMarkdown content={'# Answer\n\n```js\nconsole.log("Hello");\n```'} />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
````

Keep the stylesheet order above. Mantine supplies its own typography; add the React typography stylesheet only if the application also renders standalone React Markdown. Mermaid arrives as an integration dependency. Vue has no Mantine or built-in code-toolbar/Mermaid integration. See the [Mantine README](../packages/react-mantine/README.md) for `codeBlock` options and slot precedence.

KaTeX is an optional peer of engine and both adapters (`^0.16 || ^0.17`). The setup commands include it for math examples; omit its direct dependency and CSS import if your application does not use math. Declare it directly whenever you import its stylesheet, so installation does not depend on hoisting. The public packages declare Node `>=20`; repository development uses the version in [`.nvmrc`](../.nvmrc) and the pinned pnpm version in [`package.json`](../package.json).

## React and Vue API differences

| Task                           | React / React Mantine                                             | Vue                                                                                   |
| ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Render current source          | `content={content}`                                               | `:content="content"`                                                                  |
| Set producer state             | `streaming={streaming}`                                           | `:streaming="streaming"`                                                              |
| Select engine features         | Catalog from `@ai-markdown/react/plugins`                         | Catalog from `@ai-markdown/vue`                                                       |
| Replace HTML element rendering | `customComponents` map of React components                        | `components` map or named element slots; slot wins                                    |
| Read metadata and stream state | `useAIMarkdownMetadata`, `useAIMarkdownState`                     | Mapped component props or slot context                                                |
| Style the wrapper              | `Typography`, `ExtraStyles`, `fontSize`, `variant`, `colorScheme` | Base CSS and wrapper `class` / `style`                                                |
| Show streaming cursor          | Opt in with `streamingCursor={AIMarkdownStreamingCursor}`         | Enabled by default; disable with `:streaming-cursor="false"`; customize `cursor` slot |
| Smooth a source                | `AIMarkdownSmoothStream`, hooks accepting current option objects  | `AIMarkdownSmoothStream`, setup composables accepting live getters                    |
| Customize smooth waiting UI    | `waiting` prop                                                    | `waiting` slot                                                                        |
| Share references               | React `AIMarkdownDocuments` with explicit `documentId`            | Vue `AIMarkdownDocuments` with explicit `document-id`                                 |
| Retain orphan references       | Renderer prop and document-provider policy                        | Per-renderer `preserveOrphanReferences` (default `false`)                             |
| Toggle rendered block cache    | `blockMemo` prop                                                  | No `blockMemo` prop                                                                   |

Both adapters enable incremental parsing by default on the client. Both accept `enginePlugins`, `contentPreprocessors`, `sanitizeSchema` and `urlTransform`, but share only the documented contracts, not every prop or default. Keep plugin arrays and policy objects stable until configuration changes. Selecting plugins replaces the enabled set; it does not append arbitrary remark plugins.

## Streaming input and document boundaries

Accumulate decoded transport deltas in application state and pass the complete current string on every update. The renderer does not implement Fetch, SSE framing, cancellation or retries. `streaming` reports producer state; it does not turn incremental parsing on. Do not append a cursor character to Markdown source.

For React, update the `content` and `streaming` props with state. For Vue, use reactive values:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { AIMarkdownSmoothStream } from '@ai-markdown/vue';

const content = ref('');
const streaming = ref(true);
// Your transport appends decoded text to content.value.
// On completion or cancellation, set streaming.value = false.
</script>

<template>
  <AIMarkdownSmoothStream :content="content" :streaming="streaming" pacing="balanced" />
</template>
```

Smooth components display initial content immediately, then animate future appends. The displayed streaming state stays active while queued text drains after producer completion. Vue custom wrappers call `useSmoothStream(() => ({ content: content.value, streaming: streaming.value }))` during setup; React wrappers call `useSmoothStream({ content, streaming })` during render.

Use one renderer per message unless the application intentionally divides a logical document into independently parseable sections. For shared references, put those sections inside the matching framework's `AIMarkdownDocuments`, give them the same explicit document ID, and provide stable keys and `documentIndex` values when order can change. A network packet may end inside a fence or formula; the registry cannot join syntax across component boundaries.

Server rendering and initial hydration keep local footnote semantics. Cross-chunk definitions become available after mounted contributions commit. Render a complete document through one component when server-only output must resolve all references. Keep mutable sessions and registries local to each consumer/request.

Continue with the [React chat recipe](./streaming-chat-example.md), [Vue streaming and turn-taking](../packages/vue/README.md#smooth-streaming-and-turn-taking), or [Vue multi-chunk example](../packages/vue/README.md#multiple-chunks-in-one-document).

## Run the examples in this repository

```bash
pnpm install --frozen-lockfile
pnpm storybook
```

The hub runs on port 6006, React on 6007 and Vue on 6008. Development resolves workspace source and styles directly; no preliminary package build is required. `pnpm storybook:react` and `pnpm storybook:vue` start one catalog. Static builds use public package exports and build dependencies first.

Public packages live under `packages/*`. The `apps/storybook-*` apps, `tooling/storybook-kit`, corpus, benchmarks and archived prototypes are private workspaces. See [Interactive examples](./storybook.md) and [Development commands](./development-commands.md) for build and validation commands.
