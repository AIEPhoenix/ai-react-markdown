# Vue 快速开始

使用 Vue `^3.5.0`。服务端和构建环境要求 Node `^20.19.0 || >=22.12.0`。Vue 3.5 的 `useId()` 用于服务端与水合身份一致性。

## 安装

```bash
pnpm add @ai-markdown/vue vue@^3.5.0 katex
```

## 渲染 Markdown

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

传入完整累积字符串。应用负责网络分帧、取消和重试。基础 CSS 提供代码块、表格布局与光标动画；KaTeX CSS 需单独导入。

Vue 使用 `components` 与具名插槽，不使用 React Hooks、`blockMemo` 或 Mantine。Nuxt 专用打包、KeepAlive/Suspense 组合需要额外集成验证。

继续阅读[流式渲染](vue-streaming.md)、[定制](vue-customization.md)或 [SSR 与生命周期](vue-ssr.md)。
