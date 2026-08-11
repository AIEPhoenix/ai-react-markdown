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

import type { Element as HastElement } from 'hast';

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
