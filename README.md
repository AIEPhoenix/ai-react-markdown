# ai-react-markdown

[![npm core](https://img.shields.io/npm/v/@ai-react-markdown/core?label=%40ai-react-markdown%2Fcore)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![npm mantine](https://img.shields.io/npm/v/@ai-react-markdown/mantine?label=%40ai-react-markdown%2Fmantine)](https://www.npmjs.com/package/@ai-react-markdown/mantine)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/core)](./LICENSE)

A React component library for rendering AI-generated Markdown with first-class support for LaTeX math, GFM, CJK text, syntax highlighting, Mermaid diagrams, and streaming content.

## Features

- **GFM** -- tables, strikethrough, task lists, autolinks
- **LaTeX math** -- inline and display math via KaTeX with smart preprocessing
- **Syntax highlighting** -- code blocks with language detection, expand/collapse, and tabbed views
- **Mermaid diagrams** -- interactive SVG diagrams with dark/light theme support
- **Emoji** -- shortcode support (`:smile:`)
- **CJK-friendly** -- proper line breaking and pangu spacing for Chinese, Japanese, and Korean text
- **Extra syntax** -- highlight, definition lists, superscript/subscript
- **Streaming-aware** -- built-in `streaming` flag for LLM token-by-token rendering
- **Customizable** -- swap typography, color scheme, renderers, and inject extra style wrappers
- **Metadata context** -- pass arbitrary data to nested components without prop drilling
- **TypeScript** -- full generic support for extended configs and metadata types

## Packages

| Package | Description |
| --- | --- |
| [`@ai-react-markdown/core`](./packages/core) | Framework-agnostic core renderer. GFM, LaTeX, CJK, streaming, metadata context, custom components. |
| [`@ai-react-markdown/mantine`](./packages/mantine) | Mantine UI integration. Adds themed typography, code highlighting, Mermaid diagrams, and automatic color scheme detection. |

## Quick Start

### Core (framework-agnostic)

```bash
npm install @ai-react-markdown/core
```

```tsx
import AIMarkdown from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

function App() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

### Mantine

```bash
npm install @ai-react-markdown/mantine @ai-react-markdown/core
```

```tsx
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '@ai-react-markdown/mantine';

import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ai-react-markdown/mantine/styles.css';
import 'katex/dist/katex.min.css';

const highlightJsAdapter = createHighlightJsAdapter(hljs);

function App() {
  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <MantineAIMarkdown content="Hello **world**! Math: $E = mc^2$" />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}
```

## Streaming

Both packages support streaming content from LLMs:

```tsx
<AIMarkdown content={content} streaming={isStreaming} />
```

The `streaming` flag propagates via React context, allowing custom renderers to adapt (e.g. show a cursor or disable copy buttons).

## Documentation

See the README in each package for full API reference:

- [`@ai-react-markdown/core` README](./packages/core/README.md) -- props, configuration, hooks, typography, custom components, preprocessors, TypeScript generics, architecture
- [`@ai-react-markdown/mantine` README](./packages/mantine/README.md) -- Mantine-specific config, code highlighting setup, Mermaid diagrams, color scheme integration

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run Storybook
pnpm storybook

# Lint
pnpm lint

# Format
pnpm format
```

## License

[MIT](./LICENSE)
