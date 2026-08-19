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
 * The form of raw chunk SOURCE that the PASS 0.5 substring pre-check compares
 * registry labels against. It is exactly {@link normalizeId}: micromark's
 * `identifier` (what the registry keys are built from) is the label's
 * source bytes with backslashes KEPT (`[^a\*b]` → `a\*b`; only the `label`
 * field is unescaped), so the source must NOT be unescaped before matching
 * — an unescaping pass made every label holding an escaped punctuation
 * character miss the pre-check for good, and the cross-chunk reference
 * rendered as literal `[text][label]` (2026-08-19 review r2 P2-5; the
 * 2.4.5 narrowing to ASCII punctuation kept the wrong premise). Kept as a
 * named export for API stability.
 */
export function normalizeForMatch(s: string): string {
  return normalizeIdentifier(s);
}
