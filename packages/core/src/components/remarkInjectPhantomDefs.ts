/**
 * Direction B: source-level phantom-definition injection helpers.
 *
 * @module components/remarkInjectPhantomDefs
 */

export const SENTINEL_LINK_URL = '__aimd_sentinel_link__';
export const SENTINEL_FN_CONTENT = '__aimd_sentinel_fn__';

export interface PhantomLabels {
  missingFootnotes: Set<string>;
  missingLinks: Set<string>;
}

/**
 * Compute the source string to feed to the full PASS 1 parser: original
 * content + appended phantom definitions for labels not locally defined.
 *
 * Labels are expected to already be normalized via normalizeId (uppercase).
 * The output is suitable as input to remark-parse with the standard pipeline.
 *
 * Labels are injected RAW — do not "escape" them. micromark's identifier
 * normalization retains source backslash escapes (a definition `[foo\]bar]:`
 * yields the identifier `foo\]bar`, backslash included), so writing the
 * identifier back verbatim round-trips to the same identifier by
 * construction, and the phantom matches the reference. Escaping would
 * double the backslash and break the match. A label containing a BARE `]`
 * would fail to parse as a definition, but such a label cannot come out of
 * a real parse (brackets must be escaped in source, and the escape survives
 * into the identifier) — and today backslash-bearing labels never reach
 * injection anyway (PASS 0.5's substring gate treats them as its documented
 * false-negative).
 */
export function augmentSourceWithPhantoms(source: string, phantoms: PhantomLabels): string {
  if (phantoms.missingFootnotes.size === 0 && phantoms.missingLinks.size === 0) {
    return source;
  }
  let suffix = '\n\n';
  for (const label of phantoms.missingLinks) {
    suffix += `[${label}]: ${SENTINEL_LINK_URL}\n`;
  }
  for (const label of phantoms.missingFootnotes) {
    suffix += `[^${label}]: ${SENTINEL_FN_CONTENT}\n`;
  }
  return source + suffix;
}
