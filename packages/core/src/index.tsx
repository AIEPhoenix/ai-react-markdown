/**
 * @ai-react-markdown/core
 *
 * A batteries-included React component for rendering AI-generated markdown
 * with first-class support for LaTeX math, GFM, CJK text, syntax highlighting,
 * and streaming content.
 *
 * ## Quick Start
 *
 * ```tsx
 * import AIMarkdown from '@ai-react-markdown/core';
 * import '@ai-react-markdown/core/typography/default.css';
 *
 * function App() {
 *   return <AIMarkdown content="Hello **world**!" />;
 * }
 * ```
 *
 * @module @ai-react-markdown/core
 */

'use client';

import { useMemo, memo, type CSSProperties } from 'react';
import AIMarkdownRenderStateProvider, {
  AIMarkdownMetadataProvider,
  AIMarkdownRenderStateProviderProps,
  AIMarkdownMetadataProviderProps,
} from './context';
import { AIMDContentPreprocessor } from './preprocessors/defs';
import preprocessAIMDContent from './preprocessors';
import AIMarkdownContent from './components/MarkdownContent';
import {
  AIMarkdownCustomComponents,
  AIMarkdownRenderConfig,
  AIMarkdownMetadata,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
} from './defs';
import useStableValue from './hooks/useStableValue';
import DefaultTypography from './components/typography/Default';

/**
 * Props for the `<AIMarkdown>` component.
 *
 * @typeParam TConfig - Custom render configuration type (extends {@link AIMarkdownRenderConfig}).
 * @typeParam TRenderData - Custom metadata type (extends {@link AIMarkdownMetadata}).
 */
export interface AIMarkdownProps<
  TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig,
  TRenderData extends AIMarkdownMetadata = AIMarkdownMetadata,
>
  extends
    Omit<AIMarkdownRenderStateProviderProps<TConfig>, 'streaming' | 'fontSize' | 'variant' | 'colorScheme'>,
    AIMarkdownMetadataProviderProps<TRenderData> {
  /**
   * Whether content is actively being streamed (e.g. token-by-token from an LLM).
   * When `true`, the flag is propagated via context so custom components can adapt
   * their behavior (show cursors, disable copy buttons, skip animations, etc.).
   * Defaults to `false`.
   */
  streaming?: boolean;
  /**
   * Base font size for the rendered output.
   * Accepts a CSS length string (e.g. `'14px'`, `'0.875rem'`) or a number
   * which is treated as pixels. Defaults to `'0.9375rem'`.
   */
  fontSize?: number | string;
  /** Raw markdown content to render. */
  content: string;
  /**
   * Additional preprocessors to run on the raw markdown before rendering.
   * These run *after* the built-in LaTeX preprocessor.
   */
  contentPreprocessors?: AIMDContentPreprocessor[];
  /**
   * Custom `react-markdown` component overrides.
   * Use this to replace the default renderers for specific HTML elements
   * (e.g. code blocks, links, images).
   */
  customComponents?: AIMarkdownCustomComponents;
  /**
   * Typography wrapper component. Receives `fontSize`, `variant`, and `colorScheme`.
   * Defaults to the built-in {@link DefaultTypography}.
   */
  Typography?: AIMarkdownTypographyComponent;
  /**
   * Optional extra style wrapper component rendered between the typography
   * wrapper and the markdown content. Useful for injecting additional
   * CSS scope or theme providers.
   */
  ExtraStyles?: AIMarkdownExtraStylesComponent;
  /** Typography variant name. Defaults to `'default'`. */
  variant?: AIMarkdownVariant;
  /** Color scheme name. Defaults to `'light'`. */
  colorScheme?: AIMarkdownColorScheme;
}

/**
 * Root component that preprocesses markdown content and renders it through
 * a configurable remark/rehype pipeline wrapped in typography and style layers.
 */
const AIMarkdownComponent = <
  TConfig extends AIMarkdownRenderConfig = AIMarkdownRenderConfig,
  TRenderData extends AIMarkdownMetadata = AIMarkdownMetadata,
>({
  streaming = false,
  content,
  fontSize,
  contentPreprocessors,
  customComponents,
  defaultConfig,
  config,
  metadata,
  Typography = DefaultTypography,
  ExtraStyles,
  variant = 'default',
  colorScheme = 'light',
}: AIMarkdownProps<TConfig, TRenderData>) => {
  // Normalize fontSize: number -> px string, undefined -> default rem value.
  // Branch on `undefined` (not truthiness) so `fontSize={0}` resolves to `'0px'`.
  const usedFontSize =
    fontSize === undefined ? '0.9375rem' : typeof fontSize === 'number' ? `${fontSize}px` : fontSize;

  // Stabilize object/array props to prevent unnecessary re-renders
  // when the consumer creates new references on each render.
  const stableDefaultConfig = useStableValue(defaultConfig);
  const stableConfig = useStableValue(config);
  const stablePreprocessors = useStableValue(contentPreprocessors);
  const stableCustomComponents = useStableValue(customComponents);

  // Run the preprocessing pipeline (LaTeX normalization + user preprocessors).
  const usedContent = useMemo(
    () => (content ? preprocessAIMDContent(content, stablePreprocessors) : content),
    [content, stablePreprocessors]
  );

  return (
    <AIMarkdownMetadataProvider<TRenderData> metadata={metadata}>
      <AIMarkdownRenderStateProvider<TConfig>
        streaming={streaming}
        fontSize={usedFontSize}
        variant={variant}
        colorScheme={colorScheme}
        defaultConfig={stableDefaultConfig}
        config={stableConfig}
      >
        <Typography
          fontSize={usedFontSize}
          variant={variant}
          colorScheme={colorScheme}
          // Inject CSS custom properties onto the Typography root element.
          // --aim-font-size-root: absolute font-size anchor so inner CSS can
          //   bypass em-compounding in deeply nested markdown structures.
          // See AIMarkdownTypographyProps.style JSDoc for the full variable list.
          style={{ '--aim-font-size-root': usedFontSize } as CSSProperties}
        >
          {ExtraStyles ? (
            <ExtraStyles>
              <AIMarkdownContent content={usedContent} customComponents={stableCustomComponents} />
            </ExtraStyles>
          ) : (
            <AIMarkdownContent content={usedContent} customComponents={stableCustomComponents} />
          )}
        </Typography>
      </AIMarkdownRenderStateProvider>
    </AIMarkdownMetadataProvider>
  );
};

/**
 * A React component for rendering AI-generated markdown with rich formatting support.
 *
 * Features:
 * - GFM (tables, strikethrough, task lists, autolinks)
 * - LaTeX math rendering via KaTeX
 * - Emoji shortcodes
 * - CJK-friendly line breaking and spacing
 * - Configurable syntax extensions (highlight, definition lists, super/subscript)
 * - Configurable display optimizations (SmartyPants, pangu, comment removal)
 * - Streaming-aware rendering
 * - Customizable typography, color scheme, and component overrides
 *
 * @example
 * ```tsx
 * <AIMarkdown
 *   content={markdownString}
 *   streaming={isStreaming}
 *   colorScheme="dark"
 *   config={{ extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT] }}
 * />
 * ```
 */
const AIMarkdown = memo(AIMarkdownComponent);
AIMarkdown.displayName = 'AIMarkdown';

export default AIMarkdown as typeof AIMarkdownComponent;

// ── Public API re-exports ───────────────────────────────────────────────────

// Types
export type { AIMDContentPreprocessor };
export type {
  AIMarkdownCustomComponents,
  AIMarkdownRenderConfig,
  AIMarkdownRenderState,
  AIMarkdownMetadata,
  AIMarkdownTypographyProps,
  AIMarkdownTypographyComponent,
  AIMarkdownExtraStylesProps,
  AIMarkdownExtraStylesComponent,
  AIMarkdownVariant,
  AIMarkdownColorScheme,
} from './defs';

// Enums & Constants
export {
  AIMarkdownRenderExtraSyntax,
  AIMarkdownRenderDisplayOptimizeAbility,
  defaultAIMarkdownRenderConfig,
} from './defs';

// Hooks -- for custom components to access render state & metadata
export { useAIMarkdownRenderState, useAIMarkdownMetadata } from './context';
export { useStableValue };

// Utils
export type { PartialDeep } from './typings/partial-deep';
