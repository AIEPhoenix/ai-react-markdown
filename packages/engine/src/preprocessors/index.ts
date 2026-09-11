/**
 * Content preprocessing pipeline.
 *
 * Runs all preprocessors (built-in + user-supplied) in sequence before
 * the markdown string is handed to react-markdown. Every document-leading
 * byte order mark (U+FEFF) is removed first, then the built-in LaTeX
 * preprocessor runs, followed by any extra preprocessors provided by the
 * consumer.
 *
 * Why the BOM strip sits here, before everything else: micromark drops ONE
 * leading BOM before tokenizing, so the positions of every node in the
 * parsed trees are string indices MINUS ONE for such a document, while
 * every consumer that pairs positions with the source string (the
 * incremental-parse boundary scanner and prefix cut, the block planner's
 * source slices, the definition-label scanner's line-start probe) works in
 * raw string indices. Removing the character before any of them sees the
 * text keeps the two coordinate systems identical.
 *
 * Why ALL leading BOMs and not just the first: stripping exactly one and
 * handing the rest to the parser made the outcome depend on the count.
 * `\uFEFF\uFEFF# Heading` lost one BOM here and one in micromark and
 * rendered a heading, while three BOMs left one in the text and rendered a
 * paragraph; a raw micromark parse of the double-BOM input is a paragraph.
 * A run of leading BOMs is an encoding artifact (a file re-encoded with a
 * BOM-writing tool, a stream that re-prefixed its first frame), never
 * content, so the pipeline normalizes the whole run. This is an explicit
 * preprocessing contract, not raw-micromark equivalence for multi-BOM
 * input. A U+FEFF anywhere else is ordinary text and is left alone. A
 * stream that starts with BOMs stays an append-only stream after the
 * strip, so the append-aware stages keep their fast paths.
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

/** Drop every document-leading U+FEFF; see the module comment for why this
 *  runs first and why the whole run goes. */
function stripLeadingBom(content: string): string {
  let i = 0;
  while (content.charCodeAt(i) === 0xfeff) i++;
  return i === 0 ? content : content.slice(i);
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
