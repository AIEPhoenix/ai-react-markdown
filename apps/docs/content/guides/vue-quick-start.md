# Vue quick start

Use Vue `^3.5.0`. Server/build consumers need Node `^20.19.0 || >=22.12.0`. Vue 3.5 provides the `useId()` API used for server/hydration identity.

## Installation

```bash
pnpm add @ai-markdown/vue vue@^3.5.0 katex
```

## Render Markdown

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

Pass the complete accumulated string as `content`. Your application owns transport framing, cancellation and retries. The base stylesheet supplies code/table layout and cursor animation; KaTeX CSS is separate.

Vue uses `components` and named element slots for customization. It has no React context hooks, `blockMemo` prop, React typography variants or Mantine integration. Nuxt-specific packaging and KeepAlive/Suspense combinations require separate integration coverage.

## Choose your next task

[Streaming](vue-streaming.md), [custom rendering](vue-customization.md), [SSR and lifecycle](vue-ssr.md), or the [Vue reference](../reference/vue.md).
