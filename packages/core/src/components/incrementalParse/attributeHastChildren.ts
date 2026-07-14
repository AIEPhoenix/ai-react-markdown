/**
 * Source-offset attribution for top-level hast children.
 *
 * hast positions alone cannot delimit a frozen prefix: rehype-katex
 * replaces a math block with a position-less span (and other plugins can
 * do the same), and mdast-util-to-hast's root `wrap()` interleaves
 * position-less `'\n'` text separators. Each top-level hast child is
 * therefore attributed a source offset:
 *
 * - its own `position.start.offset` when present;
 * - otherwise the start of the first top-level MDAST child at or after the
 *   running cursor (top-level mdast children always carry positions — this
 *   mirrors blockMemo's source-offset lookup);
 * - the synthetic footnote section is attributed `Infinity` — it is never
 *   freeze-eligible (production handles it via `FootnoteSectionEntry` /
 *   `aggregateFootnotesIfLast`, not positional identity).
 *
 * The returned array is non-decreasing except for `Infinity` entries, so
 * "children attributed before offset b" is always a prefix of the child
 * list.
 *
 * Extracted from the prefixFreeze experiment's falsification harness
 * (which now imports this module) — the production splice and the
 * experiment must cut prefixes identically or the experiment stops being
 * evidence.
 */

import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';

import { isFootnoteSection } from '../blockMemo';

export function attributeHastChildren(mdast: MdastRoot, hast: HastRoot): number[] {
  const mdastStarts: number[] = [];
  for (const child of mdast.children) {
    const off = child.position?.start?.offset;
    if (off !== undefined) mdastStarts.push(off);
  }
  let cursor = 0;
  let mdastIdx = 0;
  return hast.children.map((child) => {
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (start !== undefined && start !== null) {
      cursor = Math.max(cursor, end ?? start);
      return start;
    }
    if (child.type === 'element' && isFootnoteSection(child)) return Infinity;
    while (mdastIdx < mdastStarts.length && mdastStarts[mdastIdx] < cursor) mdastIdx += 1;
    return mdastIdx < mdastStarts.length ? mdastStarts[mdastIdx] : cursor;
  });
}
