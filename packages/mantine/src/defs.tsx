/**
 * Mantine-specific type definitions and default configuration.
 *
 * Extends the core {@link AIMarkdownRenderConfig} and {@link AIMarkdownMetadata}
 * with Mantine-themed options such as uniform heading sizes and code block behavior.
 *
 * @module defs
 */

import { AIMarkdownRenderConfig, AIMarkdownMetadata, defaultAIMarkdownRenderConfig } from '@ai-react-markdown/core';

/**
 * Extended render configuration for the Mantine integration.
 *
 * Inherits all core config fields (extra syntax, display optimizations) and adds
 * Mantine-specific options for typography sizing and code block behavior.
 */
export interface MantineAIMarkdownRenderConfig extends AIMarkdownRenderConfig {
  /** Code block rendering options. */
  codeBlock: {
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
  };
}

/**
 * Default Mantine render configuration.
 *
 * Extends {@link defaultAIMarkdownRenderConfig} with Mantine-specific defaults.
 * Frozen to prevent accidental mutation.
 */
export const defaultMantineAIMarkdownRenderConfig: MantineAIMarkdownRenderConfig = Object.freeze({
  ...defaultAIMarkdownRenderConfig,
  codeBlock: Object.freeze({
    defaultExpanded: true,
    autoDetectUnknownLanguage: false,
  }),
});

/**
 * Metadata type for the Mantine integration.
 *
 * Currently identical to {@link AIMarkdownMetadata}. Exists as an extension point
 * so that consumers can augment metadata in Mantine-specific wrappers without
 * needing to reference the core type directly.
 */
export interface MantineAIMarkdownMetadata extends AIMarkdownMetadata {}
