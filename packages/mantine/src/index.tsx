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
export type { MantineAIMarkdownMetadata, MantineCodeBlockOptions } from './defs';

// ── v2 surface (props-api v2) ───────────────────────────────────────────────

/** Shipped defaults of the `codeBlock` behavior group. */
export { defaultMantineCodeBlockOptions } from './defs';

/** Narrow hook for the `codeBlock` behavior group — the single assertion site. */
export { useMantineCodeBlockOptions } from './hooks/useMantineCodeBlockOptions';

/** Widened behaviors factory (core fields + mantine's `codeBlock` group). */
export { defineMantineBehaviors } from './define';
export type { MantineBehaviorProps } from './define';

/** Typed hook for accessing metadata within the Mantine AI markdown tree. */
export { useMantineAIMarkdownMetadata } from './hooks/useMantineAIMarkdownMetadata';
