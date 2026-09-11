/**
 * Content preprocessing pipeline.
 *
 * Runs all preprocessors (built-in + user-supplied) in sequence before
 * the markdown string is handed to react-markdown. A document-leading
 * byte order mark (U+FEFF) is removed first, then the built-in LaTeX
 * preprocessor runs, followed by any extra preprocessors provided by the
 * consumer.
 *
 * Why the BOM strip sits here, before everything else: micromark drops a
 * leading BOM before tokenizing, so the positions of every node in the
 * parsed trees are string indices MINUS ONE for such a document, while
 * every consumer that pairs positions with the source string (the
 * incremental-parse boundary scanner and prefix cut, the block planner's
 * source slices, the definition-label scanner's line-start probe) works in
 * raw string indices. Removing the character before any of them sees the
 * text keeps the two coordinate systems identical. Only the FIRST character
 * qualifies — that is the only BOM micromark ignores; a U+FEFF anywhere
 * else is ordinary text and is left alone. A stream that starts with a BOM
 * stays an append-only stream after the strip, so the append-aware stages
 * keep their fast paths.
 *
 * @module preprocessors
 */

import { AIMDContentPreprocessor } from './defs';
import { preprocessLaTeX } from './latex';

/** Sequentially apply an array of preprocessor functions via left-fold. */
function applyPreprocessors(value: string, ...fns: Array<AIMDContentPreprocessor>): string {
  return fns.reduce((result, fn) => fn(result), value);
}

/** Stable empty array to avoid re-renders when no extra preprocessors are given. */
const defaultExtraPreprocessors: AIMDContentPreprocessor[] = [];

/** Drop a document-leading U+FEFF; see the module comment for why this runs first. */
function stripLeadingBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Run the full preprocessing pipeline on raw markdown content.
 *
 * @param content - Raw markdown string.
 * @param extraPreprocessors - Optional user-supplied preprocessors appended after the built-in ones.
 * @param latexPreprocessor - The LaTeX stage. Defaults to the stateless
 *   {@link preprocessLaTeX}; the renderer passes a per-instance
 *   append-aware wrapper (byte-identical output, O(active tail) on
 *   streaming appends) so per-frame reveals stop paying O(document).
 * @returns The preprocessed markdown string ready for rendering.
 */
export default function preprocessAIMDContent(
  content: string,
  extraPreprocessors: readonly AIMDContentPreprocessor[] = defaultExtraPreprocessors,
  latexPreprocessor: AIMDContentPreprocessor = preprocessLaTeX
) {
  return applyPreprocessors(stripLeadingBom(content), latexPreprocessor, ...extraPreprocessors);
}
