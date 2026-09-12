# Mantine 快速开始

Mantine 是 React 集成，使用 React 19 和 Mantine 9。服务端和构建环境要求 Node `^20.19.0 || >=22.12.0`。同时安装 React 适配器及 UI peers。

## 安装

```bash
pnpm add @ai-markdown/react-mantine @ai-markdown/react \
  react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 \
  highlight.js@^11.11.2 katex
```

## 渲染 Markdown

```tsx
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
        <MantineAIMarkdown content="Hello **world**! Math: $E = mc^2$" />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
```

保留示例中的 Provider 和样式导入顺序。组件默认从 Mantine 获取颜色模式，并添加代码高亮、JSON 显示格式化和 Mermaid。它不适用于 Vue。

继续阅读[代码块与图表](mantine-code-blocks.md)、[Mantine 参考](../reference/react-mantine.md)与 [React 流式指南](smooth-streaming.md)。
