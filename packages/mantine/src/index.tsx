/**
 * Public API surface for `@ai-react-markdown/mantine`.
 *
 * Re-exports the Mantine-integrated AI markdown component, its supporting
 * sub-components, extended types, default configuration, and typed hooks.
 *
 * @packageDocumentation
 */

// --- Components ---

/** Props for the main {@link MantineAIMarkdown} component. */
export type { MantineAIMarkdownProps } from './MantineAIMarkdown';

/** Main component -- Mantine-integrated AI markdown renderer (default export). */
export { default } from './MantineAIMarkdown';

/** Mantine-themed typography wrapper used by default inside {@link MantineAIMarkdown}. */
export { default as MantineAIMarkdownTypography } from './components/typography/MantineTypography';

/** Default extra styles wrapper providing Mantine-compatible CSS scoping and overrides. */
export { default as MantineAIMDefaultExtraStyles } from './components/extra-styles/DefaultExtraStyles';

// --- Types, config, and hooks ---

/** Extended render configuration and metadata types for the Mantine integration. */
export type { MantineAIMarkdownRenderConfig, MantineAIMarkdownMetadata } from './defs';

/** Default Mantine render configuration (frozen). */
export { defaultMantineAIMarkdownRenderConfig } from './defs';

/** Typed hook for accessing render state with Mantine-specific config fields. */
export { useMantineAIMarkdownRenderState } from './hooks/useMantineAIMarkdownRenderState';

/** Typed hook for accessing metadata within the Mantine AI markdown tree. */
export { useMantineAIMarkdownMetadata } from './hooks/useMantineAIMarkdownMetadata';
