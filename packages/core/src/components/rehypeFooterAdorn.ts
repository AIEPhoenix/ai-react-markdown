/**
 * Rehype plugin that normalizes the auto-generated footnote footer so its
 * shape matches the cross-chunk aggregate footer (rendered by
 * `AggregateFootnotesIfLast`).
 *
 * mdast-util-to-hast's default `state.footer()` emits:
 *
 *   <section data-footnotes class="footnotes">
 *     <h2 id="...footnote-label" class="sr-only">Footnotes</h2>
 *     <ol>...</ol>
 *   </section>
 *
 * The aggregate footer used in coordinated mode (and which the user prefers
 * visually) emits:
 *
 *   <section data-footnotes class="footnotes">
 *     <hr />
 *     <ol>...</ol>
 *   </section>
 *
 * Running this plugin on the parsed hast lets standalone single-doc
 * rendering produce the same structure as the aggregate, so a 1-chunk doc and
 * an N-chunk coordinated doc with identical content look the same.
 *
 * Operates only on `<section data-footnotes>` and is idempotent.
 *
 * @module components/rehypeFooterAdorn
 */
import { visit } from 'unist-util-visit';
import type { Element as HastElement, Root as HastRoot, ElementContent } from 'hast';

const FOOTNOTE_LABEL_ID_RE = /(?:^|-)footnote-label$/;

function isFootnoteLabelH2(node: ElementContent): boolean {
  if (node.type !== 'element') return false;
  const el = node as HastElement;
  if (el.tagName !== 'h2') return false;
  const id = el.properties?.id;
  return typeof id === 'string' && FOOTNOTE_LABEL_ID_RE.test(id);
}

function isHr(node: ElementContent): boolean {
  if (node.type !== 'element') return false;
  return (node as HastElement).tagName === 'hr';
}

export default function rehypeFooterAdorn() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (n) => {
      const el = n as HastElement;
      if (el.tagName !== 'section') return;
      if (!(el.properties && 'dataFootnotes' in el.properties)) return;
      // Strip the auto-generated <h2 id="...footnote-label"> — the visible
      // "Footnotes" header reads awkwardly, especially in streaming AI chat
      // contexts. To keep screen-reader announcement working, set
      // `aria-label="Footnotes"` on the section landmark so assistive tech
      // still names the region.
      const filtered = el.children.filter((c) => !isFootnoteLabelH2(c)) as ElementContent[];
      // Prepend <hr> as the first child, unless one is already present.
      if (!filtered.some(isHr)) {
        const hr: HastElement = {
          type: 'element',
          tagName: 'hr',
          properties: {},
          children: [],
        };
        filtered.unshift(hr);
      }
      el.children = filtered;
      if (!el.properties) el.properties = {};
      if (!('ariaLabel' in el.properties)) {
        el.properties.ariaLabel = 'Footnotes';
      }
    });
  };
}
