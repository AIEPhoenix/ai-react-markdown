# React 自定义渲染

通过 customComponents 替换指定 HTML 元素的 React 组件。仅调整颜色和间距时优先使用 CSS；需要链接交互、代码展示或嵌入应用控件时才替换元素。

```tsx
import AIMarkdown, { type AIMarkdownCustomComponents } from '@ai-markdown/react';

const COMPONENTS = {
  a: ({ node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
} satisfies AIMarkdownCustomComponents;

<AIMarkdown content="Read [the guide](/guide)." customComponents={COMPONENTS} />;
```

## 保留内容与语义

自定义组件接收 react-markdown 的元素属性和可选 node，children 已经转换为 React 子节点。保留必要属性、children、键盘行为与可访问性；不要把 node 等非 DOM 属性原样展开到 DOM。

在模块作用域定义组件映射，或在依赖真正变化时 memoize。每次 render 创建新组件类型会导致卸载与重挂载，影响局部状态和性能。不要原地修改已传入的映射。

## 读取上下文

使用窄 Hooks 读取主题、流式状态、行为或元数据，只订阅自己需要的上下文。普通父组件 render 仍可能传播，不保证完全不重渲染。应用数据可通过 metadata 传递。

## 代码与安全

基础适配器不做代码语法高亮。可以覆盖 pre，或使用 Mantine；覆盖 Mantine 的 pre 会接管它的代码功能。

自定义组件是应用代码，其输出不会重新经过 Markdown 清洗。生成 href、src 或嵌入内容时自行应用策略。更多模式见[英文完整指南](english:docs/guides/custom-components/)。
