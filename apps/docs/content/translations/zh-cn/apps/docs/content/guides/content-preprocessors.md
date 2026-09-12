# 内容预处理器

预处理器是同步的 `(content: string) => string` 函数，在 Markdown 解析之前执行，适合规范化受控文本格式。它接收文本，不接收语法节点或 React 上下文。

## 顺序与配置

前导 BOM 清理和内置 LaTeX 阶段先执行，额外预处理器再按数组顺序串联。它们接收上一阶段的完整输出；异步操作应在把 content 交给渲染器之前由应用完成。

```tsx
import AIMarkdown, { type AIMDContentPreprocessor } from '@ai-markdown/react';

const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 3);
  return end < 0 ? content : content.slice(end + 5);
};
const PREPROCESSORS = [stripFrontmatter];

<AIMarkdown content={raw} contentPreprocessors={PREPROCESSORS} />;
```

上述示例只处理有限的 LF frontmatter 格式，不是通用 YAML 解析器。函数和数组应在模块作用域定义，或在真正配置变化时重新创建。

## 可选的未完成语法修复

createRemendPreprocessor() 可修复流式尾部未闭合的强调、行内代码、链接等。它默认不会启用。默认 linkMode 为 text-only，未完成链接先呈现文本；katex/inlineKatex 修复被强制关闭，因为数学分隔符已经由内置 LaTeX 处理。

修复会改变源文本，因此修复中的帧不一定是上帧的字节追加，可能触发完整解析；真实语法闭合后可恢复增量复用。它仍接收完整字符串，要测量实际长文档成本。不能只凭配置选择承诺某依赖被打包器移除。

React 从根包导入辅助类型与工厂；Vue 从 @ai-markdown/vue 导入，并使用 content-preprocessors 属性。完整选项与成本边界见[英文参考](english:docs/guides/content-preprocessors/)。
