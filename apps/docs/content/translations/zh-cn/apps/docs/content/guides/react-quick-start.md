# React 快速开始

使用 React 与 React DOM 19。服务端和构建环境要求 Node `^20.19.0 || >=22.12.0`，共享 core 与 engine 会作为依赖自动安装。

## 安装

```bash
pnpm add @ai-markdown/react react@^19 react-dom@^19 katex
```

## 渲染 Markdown

```tsx
import AIMarkdown from '@ai-markdown/react';
import '@ai-markdown/react/typography/default.css';
import 'katex/dist/katex.min.css';

export function Answer() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

持续把解码后的文本累积为完整字符串，再更新 `content`。`streaming` 表示生产端是否仍在生成；增量解析另有开关，默认启用。RSC 应用应设置客户端边界，并按照宿主框架要求导入全局 CSS。

代码围栏默认呈现文本；语法高亮和 Mermaid 可使用 Mantine 或自定义组件。

继续阅读[流式聊天](streaming-chat-example.md)、[自定义渲染](custom-components.md)或 [SSR](react-ssr.md)。
