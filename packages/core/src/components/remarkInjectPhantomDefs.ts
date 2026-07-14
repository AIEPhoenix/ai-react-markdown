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
 * The phantom-definition SUFFIX for labels not locally defined ('' when
 * there are none). Kept separate from the join so the incremental engine
 * can treat it as always-tail: the suffix may shrink/grow/reorder between
 * frames (registry label churn) without breaking the append gate.
 *
 * Labels are expected to already be normalized via normalizeId (uppercase).
 */
export function buildPhantomSuffix(phantoms: PhantomLabels): string {
  if (phantoms.missingFootnotes.size === 0 && phantoms.missingLinks.size === 0) {
    return '';
  }
  let suffix = '\n\n';
  for (const label of phantoms.missingLinks) {
    suffix += `[${label}]: ${SENTINEL_LINK_URL}\n`;
  }
  for (const label of phantoms.missingFootnotes) {
    suffix += `[^${label}]: ${SENTINEL_FN_CONTENT}\n`;
  }
  return suffix;
}

/**
 * Compute the source string to feed to the full PASS 1 parser: original
 * content + appended phantom definitions for labels not locally defined.
 * The output is suitable as input to remark-parse with the standard pipeline.
 */
export function augmentSourceWithPhantoms(source: string, phantoms: PhantomLabels): string {
  return source + buildPhantomSuffix(phantoms);
}
