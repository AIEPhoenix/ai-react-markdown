import { useAIMarkdownRenderState } from '@ai-react-markdown/core';
import { MantineAIMarkdownRenderConfig } from '../defs';

/**
 * Typed wrapper around the core {@link useAIMarkdownRenderState} hook.
 *
 * Returns the current {@link AIMarkdownRenderState} defaulting to
 * {@link MantineAIMarkdownRenderConfig}. Accepts an optional generic parameter
 * for further extension, giving consumers direct access to Mantine-specific
 * config fields (`codeBlock`, etc.) without manual annotation.
 *
 * Must be called inside a component rendered within the `<MantineAIMarkdown>` tree.
 * Throws if called outside the provider boundary.
 *
 * @typeParam TConfig - Config type (defaults to {@link MantineAIMarkdownRenderConfig}).
 * @returns The current render state typed with `TConfig`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { config, streaming, colorScheme } = useMantineAIMarkdownRenderState();
 *   const isExpanded = config.codeBlock.defaultExpanded;
 *   // ...
 * }
 * ```
 */
export const useMantineAIMarkdownRenderState = <
  TConfig extends MantineAIMarkdownRenderConfig = MantineAIMarkdownRenderConfig,
>() => {
  return useAIMarkdownRenderState<TConfig>();
};
