# Mantine quick start

Use React 19, Mantine 9 and highlight.js `^11.11.2`. Upgrade the React adapter and Mantine integration together. Server/build consumers require Node `^20.19.0 || >=22.12.0`. This is a React integration; Vue uses its own adapter.

## Installation

```bash
pnpm add @ai-markdown/react-mantine @ai-markdown/react \
  react@^19 react-dom@^19 @mantine/core@^9 @mantine/code-highlight@^9 \
  highlight.js@^11.11.2 katex
```

## Render Markdown

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

Both providers and the stylesheet imports are part of this setup. KaTeX CSS is required for the math example. Keep the adapter object stable. Replacing the `pre` renderer transfers code formatting, copy, highlighting and diagram behavior to your component.

## Choose your next task

[Code blocks and diagrams](mantine-code-blocks.md), [theme configuration](../reference/react-mantine.md#configuration), or the [Mantine reference](../reference/react-mantine.md).
