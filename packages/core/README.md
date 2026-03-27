# @ai-react-markdown/core

[![npm](https://img.shields.io/npm/v/@ai-react-markdown/core)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![npm downloads](https://img.shields.io/npm/dm/@ai-react-markdown/core)](https://www.npmjs.com/package/@ai-react-markdown/core)
[![license](https://img.shields.io/npm/l/@ai-react-markdown/core)](../../LICENSE)

A batteries-included React component for rendering AI-generated markdown with first-class support for LaTeX math, GFM, CJK text, and streaming content.

## Features

- **GFM** -- tables, strikethrough, task lists, autolinks via `remark-gfm`
- **LaTeX math** -- inline and display math rendered with KaTeX; smart preprocessing handles currency `$` signs, bracket delimiters (`\[...\]`, `\(...\)`), pipe escaping, and mhchem commands
- **Emoji** -- shortcode support (`:smile:`) via `remark-emoji`
- **CJK-friendly** -- proper line breaking and spacing for Chinese, Japanese, and Korean text
- **Extra syntax** -- highlight (`==text==`), definition lists, superscript/subscript
- **Display optimizations** -- SmartyPants typography, pangu CJK spacing, HTML comment removal
- **Streaming-aware** -- built-in `streaming` flag propagated via context for custom components
- **Customizable** -- swap typography, color scheme, individual markdown element renderers, and inject extra style wrappers
- **Metadata context** -- pass arbitrary data to deeply nested custom components without prop drilling, isolated from render state to avoid unnecessary re-renders
- **TypeScript** -- full generic support for extended configs and metadata types

## Installation

```bash
# npm
npm install @ai-react-markdown/core

# pnpm
pnpm add @ai-react-markdown/core

# yarn
yarn add @ai-react-markdown/core
```

### Peer Dependencies

```json
{
  "react": ">=19.0.0",
  "react-dom": ">=19.0.0"
}
```

### CSS Dependencies

For LaTeX math rendering, include the KaTeX stylesheet:

```tsx
import 'katex/dist/katex.min.css';
```

For the built-in default typography, include the typography CSS:

```tsx
import '@ai-react-markdown/core/typography/default.css';
// or import all typography variants at once:
import '@ai-react-markdown/core/typography/all.css';
```

## Quick Start

```tsx
import AIMarkdown from '@ai-react-markdown/core';
import 'katex/dist/katex.min.css';
import '@ai-react-markdown/core/typography/default.css';

function App() {
  return <AIMarkdown content="Hello **world**! Math: $E = mc^2$" />;
}
```

### Streaming Example

```tsx
function StreamingChat({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <AIMarkdown content={content} streaming={isStreaming} colorScheme="dark" />;
}
```

## Props API Reference

### `AIMarkdownProps<TConfig, TRenderData>`

| Prop                   | Type                             | Default                         | Description                                                            |
| ---------------------- | -------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `content`              | `string`                         | **(required)**                  | Raw markdown content to render.                                        |
| `streaming`            | `boolean`                        | `false`                         | Whether content is actively being streamed (e.g. from an LLM).         |
| `fontSize`             | `number \| string`               | `'0.9375rem'`                   | Base font size. Numbers are treated as pixels.                         |
| `variant`              | `AIMarkdownVariant`              | `'default'`                     | Typography variant name.                                               |
| `colorScheme`          | `AIMarkdownColorScheme`          | `'light'`                       | Color scheme name (`'light'`, `'dark'`, or custom).                    |
| `config`               | `PartialDeep<TConfig>`           | `undefined`                     | Partial render config, deep-merged with defaults.                      |
| `defaultConfig`        | `TConfig`                        | `defaultAIMarkdownRenderConfig` | Base config to merge against. Sub-packages can pass extended defaults. |
| `metadata`             | `TRenderData`                    | `undefined`                     | Arbitrary data passed to custom components via a dedicated context.    |
| `contentPreprocessors` | `AIMDContentPreprocessor[]`      | `[]`                            | Additional preprocessors run after the built-in LaTeX preprocessor.    |
| `customComponents`     | `AIMarkdownCustomComponents`     | `undefined`                     | `react-markdown` component overrides for specific HTML elements.       |
| `Typography`           | `AIMarkdownTypographyComponent`  | `DefaultTypography`             | Typography wrapper component.                                          |
| `ExtraStyles`          | `AIMarkdownExtraStylesComponent` | `undefined`                     | Optional extra style wrapper rendered between typography and content.  |

## Configuration

Rendering behavior is controlled by `AIMarkdownRenderConfig`, which has two configuration arrays:

### Extra Syntax Extensions

Enable via `config.extraSyntaxSupported`. All are enabled by default.

| Value                                         | Description                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `AIMarkdownRenderExtraSyntax.HIGHLIGHT`       | `==Highlight==` syntax support                                                                          |
| `AIMarkdownRenderExtraSyntax.DEFINITION_LIST` | Definition list syntax ([PHP Markdown Extra](https://michelf.ca/projects/php-markdown/extra/#def-list)) |
| `AIMarkdownRenderExtraSyntax.SUBSCRIPT`       | Superscript (`^text^`) and subscript (`~text~`)                                                         |

### Display Optimization Abilities

Enable via `config.displayOptimizeAbilities`. All are enabled by default.

| Value                                                    | Description                                              |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `AIMarkdownRenderDisplayOptimizeAbility.REMOVE_COMMENTS` | Strip HTML comments                                      |
| `AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS`     | Typographic enhancements (curly quotes, em-dashes, etc.) |
| `AIMarkdownRenderDisplayOptimizeAbility.PANGU`           | Auto-insert spaces between CJK and half-width characters |

### Example: Selective Configuration

```tsx
import AIMarkdown, {
  AIMarkdownRenderExtraSyntax,
  AIMarkdownRenderDisplayOptimizeAbility,
} from '@ai-react-markdown/core';

<AIMarkdown
  content={markdown}
  config={{
    extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT],
    displayOptimizeAbilities: [AIMarkdownRenderDisplayOptimizeAbility.SMARTYPANTS],
  }}
/>;
```

When you provide a partial `config`, it is deep-merged with the defaults. Array values (like `extraSyntaxSupported`) are **replaced entirely**, not merged by index -- so the example above enables only the highlight extension, disabling definition lists and subscript.

## Hooks

### `useAIMarkdownRenderState<TConfig>()`

Access the current render state from within any component rendered inside `<AIMarkdown>`. Throws if called outside the provider boundary.

```tsx
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';

function CustomCodeBlock({ children }: PropsWithChildren) {
  const { streaming, config, fontSize, variant, colorScheme } = useAIMarkdownRenderState();

  if (streaming) {
    return <pre className="streaming">{children}</pre>;
  }
  return <pre>{children}</pre>;
}
```

**Returns** `AIMarkdownRenderState<TConfig>`:

| Field         | Type                    | Description                                         |
| ------------- | ----------------------- | --------------------------------------------------- |
| `streaming`   | `boolean`               | Whether content is being streamed.                  |
| `fontSize`    | `string`                | Resolved CSS font-size value.                       |
| `variant`     | `AIMarkdownVariant`     | Active typography variant.                          |
| `colorScheme` | `AIMarkdownColorScheme` | Active color scheme.                                |
| `config`      | `TConfig`               | Active render configuration (merged with defaults). |

### `useAIMarkdownMetadata<TMetadata>()`

Access arbitrary metadata from within the `<AIMarkdown>` tree. Metadata lives in a **separate** React context from render state, so metadata changes do not trigger re-renders in components that only consume render state.

```tsx
import { useAIMarkdownMetadata } from '@ai-react-markdown/core';

interface MyMetadata {
  onCopyCode: (code: string) => void;
  messageId: string;
}

function CustomCodeBlock({ children }: PropsWithChildren) {
  const metadata = useAIMarkdownMetadata<MyMetadata>();
  return (
    <pre>
      <button onClick={() => metadata?.onCopyCode(String(children))}>Copy</button>
      {children}
    </pre>
  );
}
```

**Returns** `TMetadata | undefined` -- `undefined` when no metadata was provided.

### `useStableValue<T>(value: T)`

Returns a referentially stable version of `value`. On each render the new value is deep-compared (via `lodash/isEqual`) against the previous one. If they are structurally equal, the previous reference is returned, preventing unnecessary re-renders in downstream `useMemo`/`useEffect` consumers.

```tsx
import { useStableValue } from '@ai-react-markdown/core';

const stableConfig = useStableValue(config);
// stableConfig keeps the same reference as long as config is deep-equal.
```

## Typography and Styling

The `<AIMarkdown>` component wraps its content in a typography component that controls font size, variant, and color scheme.

### Built-in Default Typography

The built-in `DefaultTypography` renders a `<div>` with CSS class names for the active variant and color scheme:

```html
<div class="aim-typography-root default light" style="width: 100%; font-size: 0.9375rem">
  <!-- markdown content -->
</div>
```

Import the corresponding CSS to activate styles:

```tsx
import '@ai-react-markdown/core/typography/default.css';
```

### Custom Typography Component

Replace the typography wrapper by passing a custom component. The `style` prop carries CSS custom properties injected by the core renderer — **merge it onto your root element** so that descendant CSS can reference these variables:

```tsx
import type { AIMarkdownTypographyProps } from '@ai-react-markdown/core';

function MyTypography({ children, fontSize, variant, colorScheme, style }: AIMarkdownTypographyProps) {
  return (
    <div className={`my-markdown ${colorScheme}`} style={{ fontSize, ...style }}>
      {children}
    </div>
  );
}

<AIMarkdown content={markdown} Typography={MyTypography} />;
```

#### Injected CSS Custom Properties

The core renderer injects the following CSS custom properties via the Typography `style` prop:

| Variable               | Value           | Purpose                                                                                                                                                                                             |
| ---------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--aim-font-size-root` | `fontSize` prop | Absolute font-size anchor for the component instance. Inner CSS can use `var(--aim-font-size-root)` to bypass `em` compounding in deeply nested markdown structures (e.g. code inside blockquotes). |

**Why `--aim-font-size-root`?** Markdown content frequently nests elements that use relative `em` units — blockquotes, lists, code blocks. Each nesting level compounds the effective size: a `0.875em` code span inside a `1.125em` blockquote resolves to `0.984em` of the parent, not `0.875em` of the root. This variable provides a stable, absolute reference that inner CSS rules can use to opt out of compounding when a fixed size is needed.

### Extra Styles Wrapper

The `ExtraStyles` prop accepts a component rendered between the typography wrapper and the markdown content. Useful for injecting additional CSS scope or theme providers:

```tsx
import type { AIMarkdownExtraStylesProps } from '@ai-react-markdown/core';

function MyExtraStyles({ children }: AIMarkdownExtraStylesProps) {
  return <div className="my-extra-scope">{children}</div>;
}

<AIMarkdown content={markdown} ExtraStyles={MyExtraStyles} />;
```

## Custom Components

Override the default renderers for specific HTML elements using the `customComponents` prop. This maps directly to `react-markdown`'s `Components` type:

```tsx
import type { AIMarkdownCustomComponents } from '@ai-react-markdown/core';

const components: AIMarkdownCustomComponents = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" />,
};

<AIMarkdown content={markdown} customComponents={components} />;
```

## Streaming Support

Pass `streaming={true}` when content is actively being generated (e.g. token-by-token from an LLM). The flag is propagated to all descendant components via `useAIMarkdownRenderState()`, allowing custom renderers to adapt their behavior (e.g. show a cursor, disable copy buttons, or skip animations).

```tsx
function ChatMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return <AIMarkdown content={content} streaming={isStreaming} />;
}
```

## Metadata

The `metadata` prop lets you pass arbitrary data to deeply nested custom components without prop drilling. Metadata is stored in a **separate React context** from the render state, so updating metadata does not cause re-renders in components that only read render state (like the core `MarkdownContent`).

```tsx
interface ChatMetadata {
  messageId: string;
  onCopyCode: (code: string) => void;
  onRegenerate: () => void;
}

<AIMarkdown<AIMarkdownRenderConfig, ChatMetadata>
  content={markdown}
  metadata={{
    messageId: msg.id,
    onCopyCode: handleCopy,
    onRegenerate: handleRegenerate,
  }}
/>;
```

## Content Preprocessors

The rendering pipeline runs a LaTeX preprocessor by default. You can append additional preprocessors that transform the raw markdown string before it enters the remark/rehype pipeline:

```tsx
import type { AIMDContentPreprocessor } from '@ai-react-markdown/core';

const stripFrontmatter: AIMDContentPreprocessor = (content) => content.replace(/^---[\s\S]*?---\n/, '');

<AIMarkdown content={markdown} contentPreprocessors={[stripFrontmatter]} />;
```

Preprocessors run in sequence: built-in LaTeX preprocessor first, then your custom ones in array order.

## TypeScript Generics

The component supports two generic type parameters for type-safe config and metadata:

```tsx
import AIMarkdown, { type AIMarkdownRenderConfig, type AIMarkdownMetadata } from '@ai-react-markdown/core';

// Extended config (e.g. adding code block options)
interface MyConfig extends AIMarkdownRenderConfig {
  codeBlock: { defaultExpanded: boolean };
}

// Extended metadata
interface MyMetadata extends AIMarkdownMetadata {
  messageId: string;
}

<AIMarkdown<MyConfig, MyMetadata>
  content={markdown}
  defaultConfig={myDefaultConfig}
  config={{ codeBlock: { defaultExpanded: false } }}
  metadata={{ messageId: '123' }}
/>;
```

Sub-packages like `@ai-react-markdown/mantine` use this pattern to extend the base config with additional options (e.g. `forceSameFontSize`, `codeBlock.autoDetectUnknownLanguage`) while inheriting all core functionality.

Similarly, hooks accept generic parameters for type-safe access:

```tsx
const { config } = useAIMarkdownRenderState<MyConfig>();
const metadata = useAIMarkdownMetadata<MyMetadata>();
```

## Architecture Overview

```text
<AIMarkdown>
  <AIMarkdownMetadataProvider>          // Separate context for metadata
    <AIMarkdownRenderStateProvider>     // Context for render state (streaming, config, etc.)
      <Typography>                      // Configurable typography wrapper
        <ExtraStyles?>                  // Optional extra style wrapper
          <AIMarkdownContent />         // react-markdown with remark/rehype plugin chain
        </ExtraStyles?>
      </Typography>
    </AIMarkdownRenderStateProvider>
  </AIMarkdownMetadataProvider>
</AIMarkdown>
```

The metadata and render state providers are deliberately separated so that metadata changes (e.g. callback updates) do not trigger re-renders in `AIMarkdownContent`, which only consumes render state.

## Exported API

### Default Export

- `AIMarkdown` -- the main component (memoized)

### Types

- `AIMarkdownProps`
- `AIMarkdownCustomComponents`
- `AIMarkdownRenderConfig`
- `AIMarkdownRenderState`
- `AIMarkdownMetadata`
- `AIMarkdownTypographyProps`
- `AIMarkdownTypographyComponent`
- `AIMarkdownExtraStylesProps`
- `AIMarkdownExtraStylesComponent`
- `AIMarkdownVariant`
- `AIMarkdownColorScheme`
- `AIMDContentPreprocessor`
- `PartialDeep`

### Enums and Constants

- `AIMarkdownRenderExtraSyntax`
- `AIMarkdownRenderDisplayOptimizeAbility`
- `defaultAIMarkdownRenderConfig`

### Hooks (re-exported)

- `useAIMarkdownRenderState()`
- `useAIMarkdownMetadata()`
- `useStableValue()`

## License

MIT
