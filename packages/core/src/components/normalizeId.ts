/**
 * CommonMark §4.7 label normalization. Used as the single canonical form
 * for all label-keyed structures (registry maps, phantomFootnoteLabels Set,
 * labelSet, etc.) and for handler comparisons against mdast-util-to-hast's
 * internal `state.definitionById` / `state.footnoteById` keys.
 *
 * Direction is uppercase to align with mdast-util-to-hast internals
 * (`String(identifier).toUpperCase()`). Direction is irrelevant once both
 * sides agree; uppercase chosen to match the upstream library to minimize
 * adapter calls.
 *
 * @module components/normalizeId
 */
export function normalizeId(s: string): string {
  return s.replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Same as {@link normalizeId} plus resolution of backslash escapes.
 * Used by PASS 0.5 substring pre-check against raw chunk source text:
 * sources may write `[foo\]bar]` but the resulting label identifier is
 * `foo]bar`, so we must unescape source before substring matching.
 */
export function normalizeForMatch(s: string): string {
  return s.replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').toUpperCase();
}
