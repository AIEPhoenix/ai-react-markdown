/**
 * Shared hast predicates — engine-side home for detection helpers consumed
 * by both the incremental-parse engine (attributeHastChildren's seam
 * attribution) and core's block-memo renderer.
 *
 * Lifted verbatim from core's blockMemo.ts (boundary action ①): blockMemo
 * stays React-side while incrementalParse moves into the engine, and this
 * predicate was the one value-level edge between them.
 *
 * @module components/hastPredicates
 */

import type { Element as HastElement, ElementContent } from 'hast';

/**
 * Detect mdast-util-to-hast's synthesized footnote `<section data-footnotes>`.
 * Position-based detection alone would be too broad — any future rehype plugin
 * that appends a position-less node would be misclassified. We assert by
 * `tagName === 'section'` AND presence of the `dataFootnotes` property.
 */
export function isFootnoteSection(node: HastElement): boolean {
  if (node.tagName !== 'section') return false;
  const props = node.properties as Record<string, unknown> | undefined;
  return props?.dataFootnotes !== undefined;
}

/**
 * Whitespace-only text node. `mdast-util-to-hast`'s `state.wrap(content,
 * true)` interleaves `\n` text nodes between (and around) the block-level
 * children of an `<li>`, so any code reasoning about a list item's real
 * children has to look past them.
 */
export function isWhitespaceText(c: ElementContent): boolean {
  return c.type === 'text' && /^\s*$/.test((c as { value: string }).value);
}

/**
 * Index of the last child that is not a whitespace-only text node, or -1 if
 * there is none.
 *
 * Both footnote-footer paths need exactly this and for the same reason.
 * Appending a backref follows mdast-util-to-hast's contract — "if the tail of
 * the `<li>`'s content is a `<p>`, push into it, else push onto the `<li>`" —
 * and stripping one has to find that tail again. Read the trailing
 * wrap-emitted `\n` as the tail and the `<p>` path is bypassed in one case
 * and the wrong node stripped in the other.
 *
 * Lived in two copies until 2.5.2 (core's aggregate footer and the engine's
 * body extractor), one on each side of the 2.3.0 package split.
 */
export function lastMeaningfulIdx(children: ElementContent[]): number {
  for (let i = children.length - 1; i >= 0; i--) {
    if (!isWhitespaceText(children[i])) return i;
  }
  return -1;
}
