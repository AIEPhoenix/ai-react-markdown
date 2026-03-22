/**
 * Main Mantine integration component for AI markdown rendering.
 *
 * Wraps the core {@link AIMarkdown} component with Mantine-specific defaults:
 * - {@link MantineAIMarkdownTypography} as the typography wrapper
 * - {@link MantineAIMDefaultExtraStyles} as the extra styles wrapper
 * - {@link MantineAIMPreCode} as the default `<pre>` component (with syntax
 *   highlighting via Mantine's CodeHighlight and mermaid diagram support)
 * - Automatic color scheme detection via Mantine's `useComputedColorScheme`
 *
 * @module MantineAIMarkdown
 */

import { memo, useMemo } from 'react';
import AIMarkdown from '@ai-react-markdown/core';
import { type AIMarkdownProps, type AIMarkdownCustomComponents, useStableValue } from '@ai-react-markdown/core';
import MantineAIMarkdownTypography from './components/typography/MantineTypography';
import MantineAIMDefaultExtraStyles from './components/extra-styles/DefaultExtraStyles';
import { MantineAIMarkdownRenderConfig, MantineAIMarkdownMetadata, defaultMantineAIMarkdownRenderConfig } from './defs';
import MantineAIMPreCode from './components/customized/PreCode';
import { useComputedColorScheme } from '@mantine/core';

/**
 * Props for the {@link MantineAIMarkdown} component.
 *
 * Extends {@link AIMarkdownProps} with Mantine-specific config and metadata generics.
 * All core props (`content`, `streaming`, `fontSize`, `config`, etc.) are inherited.
 *
 * @typeParam TConfig - Render configuration type, defaults to {@link MantineAIMarkdownRenderConfig}.
 * @typeParam TRenderData - Metadata type, defaults to {@link MantineAIMarkdownMetadata}.
 */
export interface MantineAIMarkdownProps<
  TConfig extends MantineAIMarkdownRenderConfig = MantineAIMarkdownRenderConfig,
  TRenderData extends MantineAIMarkdownMetadata = MantineAIMarkdownMetadata,
> extends AIMarkdownProps<TConfig, TRenderData> {}

/**
 * Default custom component overrides applied by the Mantine integration.
 *
 * Overrides the `<pre>` element to extract code blocks and render them via
 * {@link MantineAIMPreCode}, which provides syntax highlighting, expand/collapse,
 * and mermaid diagram support. Falls back to a plain `<pre>` when the child
 * is not a recognized code element.
 */
const DefaultCustomComponents: AIMarkdownCustomComponents = {
  pre: ({ node, ...usefulProps }) => {
    const code = node?.children[0] as
      | {
          type: string;
          tagName?: string;
          position?: { start?: { offset?: number } };
          properties?: Record<string, unknown>;
          children: { value?: string }[];
        }
      | undefined;
    if (!code || code.type !== 'element' || code.tagName !== 'code' || !code.position) {
      return <pre {...usefulProps} />;
    }
    const key = `pre-code-${node?.position?.start?.offset || 0}`;
    const detectedLanguage = (code.properties?.className as string[])
      ?.find((className: string) => className.startsWith('language-'))
      ?.substring('language-'.length);
    const codeText = code.children.map((child: { value?: string }) => child.value ?? '').join('\n');
    return <MantineAIMPreCode key={key} codeText={codeText} existLanguage={detectedLanguage} />;
  },
};

/**
 * Inner (non-memoized) implementation of the Mantine AI markdown component.
 *
 * Merges caller-provided `customComponents` with the Mantine defaults (the caller's
 * overrides take precedence). Automatically resolves the color scheme from Mantine's
 * `useComputedColorScheme` when no explicit `colorScheme` prop is provided.
 *
 * @typeParam TConfig - Render configuration type.
 * @typeParam TRenderData - Metadata type.
 */
const MantineAIMarkdownComponent = <
  TConfig extends MantineAIMarkdownRenderConfig = MantineAIMarkdownRenderConfig,
  TRenderData extends MantineAIMarkdownMetadata = MantineAIMarkdownMetadata,
>({
  Typography = MantineAIMarkdownTypography,
  ExtraStyles = MantineAIMDefaultExtraStyles,
  defaultConfig = defaultMantineAIMarkdownRenderConfig as TConfig,
  customComponents,
  colorScheme,
  ...props
}: MantineAIMarkdownProps<TConfig, TRenderData>) => {
  const stableCustomComponents = useStableValue(customComponents);

  const usedComponents = useMemo(() => {
    return stableCustomComponents ? { ...DefaultCustomComponents, ...stableCustomComponents } : DefaultCustomComponents;
  }, [stableCustomComponents]);

  const computedColorScheme = useComputedColorScheme('light');

  return (
    <AIMarkdown<MantineAIMarkdownRenderConfig, MantineAIMarkdownMetadata>
      Typography={Typography}
      ExtraStyles={ExtraStyles}
      defaultConfig={defaultConfig}
      customComponents={usedComponents}
      colorScheme={colorScheme ?? computedColorScheme}
      {...props}
    />
  );
};

/**
 * Mantine-integrated AI markdown renderer.
 *
 * A memoized wrapper around the core `<AIMarkdown>` component that provides
 * Mantine-themed typography, code highlighting (via `@mantine/code-highlight`),
 * mermaid diagram rendering, and automatic color scheme detection.
 *
 * This is the default export of `@ai-react-markdown/mantine`.
 *
 * @example
 * ```tsx
 * import MantineAIMarkdown from '@ai-react-markdown/mantine';
 *
 * function Chat({ content }: { content: string }) {
 *   return <MantineAIMarkdown content={content} />;
 * }
 * ```
 */
export const MantineAIMarkdown = memo(MantineAIMarkdownComponent);

MantineAIMarkdown.displayName = 'MantineAIMarkdown';

export default MantineAIMarkdown as typeof MantineAIMarkdownComponent;
