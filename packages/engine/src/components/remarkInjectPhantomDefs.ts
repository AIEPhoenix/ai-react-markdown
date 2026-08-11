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
