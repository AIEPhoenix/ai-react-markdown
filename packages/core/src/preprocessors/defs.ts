/**
 * Type definitions for the content preprocessor pipeline.
 *
 * @module preprocessors/defs
 */

/**
 * A synchronous function that transforms raw markdown content before it is
 * passed to the remark/rehype rendering pipeline.
 *
 * Preprocessors run in sequence -- each receives the output of the previous one.
 *
 * @param content - The raw (or partially processed) markdown string.
 * @returns The transformed markdown string.
 *
 * @example
 * ```ts
 * const stripFrontmatter: AIMDContentPreprocessor = (content) =>
 *   content.replace(/^---[\s\S]*?---\n/, '');
 * ```
 */
export type AIMDContentPreprocessor = (content: string) => string;
