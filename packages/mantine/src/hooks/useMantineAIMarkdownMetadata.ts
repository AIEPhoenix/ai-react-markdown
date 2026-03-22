import { useAIMarkdownMetadata } from '@ai-react-markdown/core';
import { MantineAIMarkdownMetadata } from '../defs';

/**
 * Typed wrapper around the core {@link useAIMarkdownMetadata} hook.
 *
 * Returns the current metadata defaulting to {@link MantineAIMarkdownMetadata}.
 * Accepts an optional generic parameter for further extension.
 *
 * Metadata lives in a separate React context from the render state, meaning
 * metadata updates do not trigger re-renders in components that only consume
 * render state.
 *
 * Must be called inside a component rendered within the `<MantineAIMarkdown>` tree.
 *
 * @typeParam TMetadata - Metadata type (defaults to {@link MantineAIMarkdownMetadata}).
 * @returns The current metadata, or `undefined` if none was provided.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const metadata = useMantineAIMarkdownMetadata();
 *   // Access Mantine-specific metadata fields
 * }
 * ```
 */
export const useMantineAIMarkdownMetadata = <
  TMetadata extends MantineAIMarkdownMetadata = MantineAIMarkdownMetadata,
>() => {
  return useAIMarkdownMetadata<TMetadata>();
};
