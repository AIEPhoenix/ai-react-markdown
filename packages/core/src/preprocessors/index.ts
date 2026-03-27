/**
 * Content preprocessing pipeline.
 *
 * Runs all preprocessors (built-in + user-supplied) in sequence before
 * the markdown string is handed to react-markdown. The built-in LaTeX
 * preprocessor always runs first, followed by any extra preprocessors
 * provided by the consumer.
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

/**
 * Run the full preprocessing pipeline on raw markdown content.
 *
 * @param content - Raw markdown string.
 * @param extraPreprocessors - Optional user-supplied preprocessors appended after the built-in ones.
 * @returns The preprocessed markdown string ready for rendering.
 */
export default function preprocessAIMDContent(
  content: string,
  extraPreprocessors: AIMDContentPreprocessor[] = defaultExtraPreprocessors
) {
  return applyPreprocessors(content, preprocessLaTeX, ...extraPreprocessors);
}
