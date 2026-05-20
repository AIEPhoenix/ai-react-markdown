# Extending via a Sub-package

`@ai-react-markdown/mantine` is the reference implementation of a **third-party integration** built on `@ai-react-markdown/core`. If you want to ship your own — Chakra, MUI, Tailwind-themed, Tamagui, your in-house design system — this document is the recipe.

The pattern composes only the public extension points of core: `Typography`, `ExtraStyles`, `customComponents`, `defaultConfig`. No internal API access required.

---

## The Mantine model, at a glance

```text
@ai-react-markdown/mantine
├── MantineAIMarkdown (wrapper component)
│   ├── Typography = MantineAIMarkdownTypography     ← Mantine <Typography> wrapper
│   ├── ExtraStyles = MantineAIMDefaultExtraStyles   ← CSS scoping for em-based tokens
│   ├── customComponents.pre = MantineAIMPreCode     ← CodeHighlight + Mermaid + JSON pretty-print
│   ├── defaultConfig = defaultMantineAIMarkdownRenderConfig
│   └── colorScheme = Mantine's useComputedColorScheme (when not overridden)
│
├── defs.tsx
│   ├── MantineAIMarkdownRenderConfig (extends AIMarkdownRenderConfig)
│   ├── MantineAIMarkdownMetadata (extends AIMarkdownMetadata)
│   └── defaultMantineAIMarkdownRenderConfig
│
└── hooks/
    ├── useMantineAIMarkdownRenderState  (wrapper over useAIMarkdownRenderState<MantineConfig>)
    └── useMantineAIMarkdownMetadata
```

Every piece composes existing core APIs — there's no special "extension API." Your sub-package can follow the same shape, swapping Mantine for your design system.

---

## Step 1: Define your extended config

```ts
// packages/your-integration/src/defs.ts
import {
  type AIMarkdownRenderConfig,
  type AIMarkdownMetadata,
  defaultAIMarkdownRenderConfig,
} from '@ai-react-markdown/core';

export interface YourAIMarkdownRenderConfig extends AIMarkdownRenderConfig {
  // Add any options your integration exposes.
  codeBlock: {
    showCopyButton: boolean;
    defaultLanguage: string;
  };
  // …
}

export interface YourAIMarkdownMetadata extends AIMarkdownMetadata {
  // Extension point — keep empty or add integration-specific fields.
}

export const defaultYourAIMarkdownRenderConfig: YourAIMarkdownRenderConfig = Object.freeze({
  ...defaultAIMarkdownRenderConfig,
  codeBlock: Object.freeze({
    showCopyButton: true,
    defaultLanguage: 'plaintext',
  }),
});
```

`Object.freeze` on the default prevents accidental mutation, mirroring the core's pattern.

---

## Step 2: Build the wrapper component

```tsx
// packages/your-integration/src/YourAIMarkdown.tsx
import { memo, useMemo } from 'react';
import AIMarkdown, {
  type AIMarkdownProps,
  type AIMarkdownCustomComponents,
  useStableValue,
} from '@ai-react-markdown/core';

import YourTypography from './components/Typography';
import YourExtraStyles from './components/ExtraStyles';
import YourPreCode from './components/PreCode';
import {
  type YourAIMarkdownRenderConfig,
  type YourAIMarkdownMetadata,
  defaultYourAIMarkdownRenderConfig,
} from './defs';

export interface YourAIMarkdownProps<
  TConfig extends YourAIMarkdownRenderConfig = YourAIMarkdownRenderConfig,
  TRenderData extends YourAIMarkdownMetadata = YourAIMarkdownMetadata,
> extends AIMarkdownProps<TConfig, TRenderData> {}

const DEFAULT_COMPONENTS: AIMarkdownCustomComponents = {
  pre: YourPreCode,
  // …add more if your integration overrides other elements
};

const YourAIMarkdownComponent = <
  TConfig extends YourAIMarkdownRenderConfig = YourAIMarkdownRenderConfig,
  TRenderData extends YourAIMarkdownMetadata = YourAIMarkdownMetadata,
>({
  Typography = YourTypography,
  ExtraStyles = YourExtraStyles,
  defaultConfig = defaultYourAIMarkdownRenderConfig as TConfig,
  customComponents,
  ...rest
}: YourAIMarkdownProps<TConfig, TRenderData>) => {
  const stableCustomComponents = useStableValue(customComponents);

  // Merge: caller overrides win over your defaults.
  const usedComponents = useMemo(
    () => (stableCustomComponents ? { ...DEFAULT_COMPONENTS, ...stableCustomComponents } : DEFAULT_COMPONENTS),
    [stableCustomComponents]
  );

  return (
    <AIMarkdown<TConfig, TRenderData>
      Typography={Typography}
      ExtraStyles={ExtraStyles}
      defaultConfig={defaultConfig}
      customComponents={usedComponents}
      {...rest}
    />
  );
};

export const YourAIMarkdown = memo(YourAIMarkdownComponent);
YourAIMarkdown.displayName = 'YourAIMarkdown';
export default YourAIMarkdown as typeof YourAIMarkdownComponent;
```

**Key points**:

- Wrap with `memo` — the wrapper component itself benefits from referential-equality skip.
- Use `useStableValue(customComponents)` before merging — caller-inline `customComponents` would otherwise create a new merged object every render.
- Order of spread in the merge: `{ ...DEFAULT_COMPONENTS, ...callerComponents }` so caller wins. The opposite order would silently override their explicit choices.

---

## Step 3: Build the typography wrapper

```tsx
// packages/your-integration/src/components/Typography.tsx
import type { AIMarkdownTypographyComponent } from '@ai-react-markdown/core';
import { Box, useTheme } from 'your-design-system';

const YourTypography: AIMarkdownTypographyComponent = ({ children, fontSize, variant, colorScheme, style }) => {
  const theme = useTheme();
  return (
    <Box
      data-variant={variant}
      data-color-scheme={colorScheme}
      style={{
        fontSize,
        fontFamily: theme.fonts.body,
        ...style, // ← MUST spread style for --aim-font-size-root to reach descendants
      }}
    >
      {children}
    </Box>
  );
};

export default YourTypography;
```

See [Custom Typography](./custom-typography.md) for the full Typography contract, including why `style` must be spread.

---

## Step 4: Build the extra-styles wrapper

```tsx
// packages/your-integration/src/components/ExtraStyles.tsx
import type { AIMarkdownExtraStylesComponent } from '@ai-react-markdown/core';

const YourExtraStyles: AIMarkdownExtraStylesComponent = ({ children }) => (
  <div className="your-integration-scope">{children}</div>
);

export default YourExtraStyles;
```

Ship a corresponding CSS file with selectors under `.your-integration-scope` for any em-based or theme-aware overrides specific to your design system.

---

## Step 5: Build the pre/code component (if you override code blocks)

This is where most of an integration's value lives. Typical features:

- Syntax highlighting (via your highlighter of choice)
- Copy button
- Expand/collapse for long blocks
- Language label
- Mermaid diagram rendering for `mermaid` blocks
- JSON pretty-print for `json` blocks
- LaTeX/math passthrough (handled by core; you don't need to do anything for this)

```tsx
// packages/your-integration/src/components/PreCode.tsx
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';
import { useYourRenderState } from '../hooks/useYourRenderState';

interface PreCodeProps {
  node?: any; // hast Element
  children?: React.ReactNode;
}

function YourPreCode({ node, children }: PreCodeProps) {
  const { streaming } = useAIMarkdownRenderState();
  const { config } = useYourRenderState();
  const code = node?.children?.[0];
  if (code?.tagName !== 'code') return <pre>{children}</pre>;

  const className = (code.properties?.className as string[] | undefined) ?? [];
  const language = className.find((c) => c.startsWith('language-'))?.slice('language-'.length);
  const text = (code.children?.map((c: any) => c.value ?? '').join('') ?? '').trimEnd();

  if (language === 'mermaid') return <YourMermaidBlock source={text} />;
  if (language === 'json') return <YourJsonBlock source={text} />;
  return (
    <YourHighlightedBlock
      language={language ?? config.codeBlock.defaultLanguage}
      source={text}
      showCopy={!streaming && config.codeBlock.showCopyButton}
    />
  );
}

export default YourPreCode;
```

> Notice this component uses both `useAIMarkdownRenderState` (for `streaming`) and `useYourRenderState` (for `config.codeBlock.*`). Both are valid — they read from separate contexts that are always both available inside `<AIMarkdown>`.

---

## Step 6: Wrapper hooks for typed access

```ts
// packages/your-integration/src/hooks/useYourRenderState.ts
import { useAIMarkdownRenderState } from '@ai-react-markdown/core';
import type { YourAIMarkdownRenderConfig } from '../defs';

export const useYourRenderState = () => useAIMarkdownRenderState<YourAIMarkdownRenderConfig>();
```

```ts
// packages/your-integration/src/hooks/useYourMetadata.ts
import { useAIMarkdownMetadata } from '@ai-react-markdown/core';
import type { YourAIMarkdownMetadata } from '../defs';

export const useYourMetadata = () => useAIMarkdownMetadata<YourAIMarkdownMetadata>();
```

These are one-liners but worth the indirection — they let consumers of your package use `useYourRenderState()` without thinking about generics, and **your** package is the single source of the caller-asserted type.

---

## Step 7: Index / barrel exports

```ts
// packages/your-integration/src/index.ts
export type { YourAIMarkdownProps } from './YourAIMarkdown';
export { default } from './YourAIMarkdown';
export { default as YourTypography } from './components/Typography';
export { default as YourExtraStyles } from './components/ExtraStyles';
export type { YourAIMarkdownRenderConfig, YourAIMarkdownMetadata } from './defs';
export { defaultYourAIMarkdownRenderConfig } from './defs';
export { useYourRenderState } from './hooks/useYourRenderState';
export { useYourMetadata } from './hooks/useYourMetadata';
```

Match the shape of `@ai-react-markdown/mantine`'s barrel for consistency. Re-export the typography and extra-styles components so consumers can wrap or compose them.

---

## Step 8: Peer dependencies

```jsonc
// packages/your-integration/package.json
{
  "peerDependencies": {
    "@ai-react-markdown/core": "^1.4.0",
    "react": ">=19",
    "react-dom": ">=19",
    "your-design-system": "^1.0.0",
  },
  "dependencies": {
    // Direct deps your integration needs (e.g. a mermaid library, a syntax highlighter)
  },
}
```

Keep `@ai-react-markdown/core` as a **peer** dep — never a direct dep. Otherwise consumers can end up with two copies of core in their bundle, and the React context identity check fails (silent breakage: hooks find no provider).

---

## Step 9: Use it

```tsx
import YourAIMarkdown from '@yourorg/ai-react-markdown-yourds';
import { YourDesignSystemProvider } from 'your-design-system';

function App() {
  return (
    <YourDesignSystemProvider>
      <YourAIMarkdown content="Hello **world**!" />
    </YourDesignSystemProvider>
  );
}
```

Consumers don't need to know about core — they install your package and the Mantine-style "drop in" experience is preserved.

---

## Tips from the Mantine integration

| Practice                                                                                                | Why                                                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Use `useStableValue` on caller-passed `customComponents` before merging                                 | A new merged object every render flushes the block-memo cache                                 |
| Auto-detect color scheme from your design system if not overridden                                      | Match the surrounding UI without explicit prop                                                |
| Ship a CSS file that overrides design-system spacing/font tokens to em-based units inside `ExtraStyles` | Markdown should scale with `fontSize` regardless of the design system's absolute tokens       |
| Keep `mermaid` (or whichever heavy lib) as a **direct** dep, not peer                                   | Consumers shouldn't have to install it separately for a feature they enabled via your package |
| Memo the wrapper at the top level                                                                       | Standard React perf hygiene                                                                   |

---

## What to avoid

### Re-implementing the pipeline

Don't fork `MarkdownContent` or the remark/rehype plugin chain. The core's pipeline is the value you're building on; bypassing it loses cross-chunk coordination, block memoization, LaTeX preprocessing, sanitization, and CJK handling. Compose at the public extension points instead.

### Pinning to a patch version of `@ai-react-markdown/core`

Use a caret range (`^1.4.0`). Minor and patch versions of core are non-breaking. A strict pin causes resolution headaches for downstream consumers.

### Re-exporting internal core types

Stick to `AIMarkdownProps`, `AIMarkdownCustomComponents`, `AIMarkdownTypographyComponent`, etc. — the documented public surface. If your integration needs something internal-looking, that's a signal to either request the export upstream or work around it.

### Forgetting to test cross-chunk coordination

`<AIMarkdownDocuments>` works through `<YourAIMarkdown>` transparently — but the test that verifies this should live in your package. The Mantine test suite has equivalents; mirror them.

---

## Distribution

Publishing a `@yourorg/ai-react-markdown-…` package is the natural unit of distribution. There's no central "integration registry" — discoverability is through npm keywords, your README, and the broader ai-react-markdown community (link to your package in the parent project's discussion forum or via a PR adding a row to a hypothetical integrations table).

When you publish, consider:

- A README following the structure of `@ai-react-markdown/mantine`.
- A peer-dep statement that's permissive enough (`>=19` for React, `^1.4.0` for core).
- npm keywords: `react`, `markdown`, `ai`, `llm`, `<your-design-system>`, `ai-react-markdown-integration`.
- Bundle size disclosure (bundlephobia badges).

Optionally, propose to add a row to the parent project's "Integrations" section if/when one exists.
