# Vue 文档与引用

当一个逻辑文档由多个独立渲染器组成时，使用 Vue 的 `AIMarkdownDocuments`，并给各部分传入相同的显式 document-id。

```vue
<script setup lang="ts">
import { ref } from 'vue';
import AIMarkdown, { AIMarkdownDocuments } from '@ai-markdown/vue';
import '@ai-markdown/vue/styles.css';

const sections = ref([
  { id: 'claim', content: 'A claim[^source] and [site][url].' },
  { id: 'sources', content: '[^source]: Shared citation\n\n[url]: https://example.com' },
]);
</script>

<template>
  <AIMarkdownDocuments>
    <AIMarkdown
      v-for="(section, index) in sections"
      :key="section.id"
      :content="section.content"
      document-id="answer-1"
      :document-index="index"
    />
  </AIMarkdownDocuments>
</template>
```

## 文档身份与贡献

每个组件仍解析自己的完整字符串。相同 ID 共享链接和脚注定义，不同 ID 隔离；容器不能把跨组件的半段围栏、公式或表格接起来。使用稳定 key，并在内容属于新文档时更新身份。

挂载/提交阶段发布贡献，卸载后释放。定义改变或移除会使相关引用重新计算；汇总脚注属于最后一个符合条件的片段。不要缓存和原地修改 registry 的内部对象。

## Vue 特有行为

Vue 不暴露 React 的 `blockMemo`，协调并不依赖该属性。`preserveOrphanReferences` 默认 false，由每个渲染器单独决定；Vue 文档容器没有 React 那组孤立引用策略属性。

平滑输出可使用 `AIMarkdownSmoothStream` 或 `useDocumentSmoothStream`。等待中的片段用 waiting 插槽替代正文，文档身份与 coordinate 变化会清理旧协调关系。

## SSR 与验证

服务端只看当前片段的本地定义。首帧客户端保持相同输入和身份，挂载后才让共享贡献可见。应测试晚到定义、内容替换、文档切换和卸载，不能用引擎解析通过来代替 Vue 生命周期验证。

继续阅读 [Vue SSR](vue-ssr.md)与[文档概念](documents-and-references.md)。
