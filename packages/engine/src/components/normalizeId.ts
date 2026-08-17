/**
 * CommonMark §4.7 label normalization. Used as the single canonical form
 * for all label-keyed structures (registry maps, phantomFootnoteLabels Set,
 * labelSet, etc.) and for handler comparisons against mdast-util-to-hast's
 * internal `state.definitionById` / `state.footnoteById` keys.
 *
 * Delegates to micromark's own `normalizeIdentifier` (collapse
 * `[\t\n\r ]+` runs to one space, STRIP leading/trailing whitespace, then
 * `toLowerCase().toUpperCase()` Unicode case folding) so the result is
 * byte-identical to mdast-util-to-hast's key
 * (`String(identifier).toUpperCase()`, where `identifier` is already
 * micromark-normalized). An earlier hand-rolled version skipped the trim
 * (and used `\s`, which also folds NBSP): a placeholder carrying the
 * ORIGINAL source label (`[ foo ]`, or `[foo\nbar]` broken at a soft line
 * ending) looked up `' FOO '` while the def was keyed `'FOO'` — every
 * padded reference fell back to literal text in coordinated mode only
 * (2026-08 project review, eng-stream-01).
 *
 * @module components/normalizeId
 */
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

export function normalizeId(s: string): string {
  return normalizeIdentifier(s);
}

/**
 * Same as {@link normalizeId} plus resolution of backslash escapes.
 * Used by PASS 0.5 substring pre-check against raw chunk source text:
 * sources may write `[foo\]bar]` but the resulting label identifier is
 * `foo]bar`, so we must unescape source before substring matching.
 */
export function normalizeForMatch(s: string): string {
  return normalizeIdentifier(s.replace(/\\(.)/g, '$1'));
}
