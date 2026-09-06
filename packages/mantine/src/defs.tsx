/**
 * Mantine-specific type definitions and defaults: the `codeBlock` behavior
 * group and the metadata extension point.
 *
 * @module defs
 */

import { AIMarkdownMetadata } from '@ai-react-markdown/core';

/**
 * Code block rendering options (the mantine `codeBlock` behavior group).
 *
 * v2 transport: passed as the flat `codeBlock` prop on `MantineAIMarkdown`
 * (group value replaces atomically) and read through
 * `useMantineCodeBlockOptions()`, which applies the defaults below inside
 * the hook — the single place defaults live at read time.
 */
export interface MantineCodeBlockOptions {
  /**
   * Whether code blocks start in their expanded state.
   * When `false`, long code blocks are collapsed with an expand button.
   *
   * @default true
   */
  defaultExpanded: boolean;

  /**
   * When `true`, uses `highlight.js` auto-detection to determine the language
   * of code blocks that lack an explicit language annotation.
   *
   * @default false
   */
  autoDetectUnknownLanguage: boolean;
  /** Format JSON for display without changing numeric literals. @default true */
  formatJson?: boolean;
  /** Expand string values containing JSON objects/arrays for display. @default true */
  expandNestedJson?: boolean;
}

/** Shipped defaults for the `codeBlock` behavior group. */
export const defaultMantineCodeBlockOptions: Readonly<MantineCodeBlockOptions> = Object.freeze({
  defaultExpanded: true,
  autoDetectUnknownLanguage: false,
  formatJson: true,
  expandNestedJson: true,
});

/**
 * Metadata type for the Mantine integration.
 *
 * Currently identical to {@link AIMarkdownMetadata}. Exists as an extension point
 * so that consumers can augment metadata in Mantine-specific wrappers without
 * needing to reference the core type directly.
 */
export interface MantineAIMarkdownMetadata extends AIMarkdownMetadata {}
