# React 排版包装器

默认 Typography 提供基础 Markdown 排版。简单颜色、间距和字体调整优先使用[CSS 设计变量](design-tokens.md)；需要换布局根节点或接入设计系统时再替换 Typography。

## 必须保留注入属性

Typography 接收 className、style 与 children。必须把注入的 style 合并到根元素，它包含 --aim-font-size-root 等 CSS 自定义属性；丢失这些属性会使内部字号规则回退到继承值。

```ts
interface AIMarkdownTypographyProps {
  children?: React.ReactNode;
  fontSize: string; // resolved (e.g. '0.9375rem')
  variant?: AIMarkdownVariant; // 'default' | string
  colorScheme?: AIMarkdownColorScheme; // 'light' | 'dark' | string
  style?: React.CSSProperties; // CSS custom properties injected by the React renderer
}
```

下面是传递 style 与 children 的组件片段：

```tsx
import AIMarkdown, { type AIMarkdownTypographyComponent } from '@ai-markdown/react';

const MyTypography: AIMarkdownTypographyComponent = ({ children, fontSize, colorScheme, style }) => (
  <div
    className={`my-markdown ${colorScheme}`}
    style={{ fontSize, ...style }} // ← spread style here
  >
    {children}
  </div>
);

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

## ExtraStyles

ExtraStyles 是排版包装器与 Markdown 正文之间的可选样式层，适用于集成库的作用域样式。它与 Typography 分工不同，不需要为了加一条 CSS 规则替换整个渲染结构。

组件类型与自定义映射应保持稳定，否则 render 期间新建函数可能导致子树重挂载。Mantine 已提供自己的排版和额外样式默认值。

类型和完整包装示例见[英文排版参考](english:docs/guides/custom-typography/)。
