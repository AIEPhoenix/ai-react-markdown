/**
 * Anchor detection for the streaming cursor.
 *
 * Walks the rendered content DOM to find the text node the cursor should
 * attach after: the deepest last text inside the last content block. The
 * walk is a whitelist descent — only elements whose content is plain
 * rendered prose are entered. Anything else (code, KaTeX output, SVG such
 * as rendered mermaid, raw-HTML-produced unknown tags, void elements)
 * aborts the walk and the cursor hides for that frame (the shell re-detects
 * on the next mutation).
 *
 * Only a tiny structural surface of the DOM is touched (`nodeType`,
 * `childNodes`, `tagName`, `classList.contains`, `hasAttribute`,
 * `getAttribute`, `data`), so the walk is unit-testable in the node
 * environment with plain-object fakes — no jsdom required.
 *
 * Definition tails: the renderer stamps a hidden tail marker while a
 * (footnote / link-reference) definition is streaming (see
 * `tailSignal.ts`), because definitions render in the relocated footer —
 * the DOM tail and the source tail diverge and no DOM-only heuristic can
 * reconcile them. With a marker present the walk anchors inside the
 * TARGETED footer `<li>` (or hides); without one it keeps its original
 * bet: skip the footer, anchor at the body tail.
 *
 * @module components/streamingCursor/detectAnchor
 */

import { sourceIdFromFootnoteLiId } from '../extractDefBodiesFromHast';
import { normalizeId } from '../normalizeId';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Attribute names of the tail marker `MarkdownContent` stamps while
 *  streaming (see `tailSignal.ts`). Read via `getAttribute` so the walk's
 *  plain-object fake surface stays tiny. */
const TAIL_KIND_ATTR = 'data-aimd-tail-kind';
const TAIL_LABEL_ATTR = 'data-aimd-tail-label';
const TAIL_CLOBBER_ATTR = 'data-aimd-clobber-prefix';

/**
 * Elements the walk may enter. Block-level containers markdown rendering
 * produces, plus inline formatting containers. Everything absent is
 * conservatively unsafe — this is what makes raw-HTML output (arbitrary
 * tags) and void elements abort the walk without an explicit denylist.
 * `SPAN` is listed because typography helpers (e.g. CJK spacing) wrap prose
 * in spans; KaTeX output is also span-based, which is why the walk
 * additionally rejects `.katex` / `.katex-display` by class.
 */
const SAFE_CONTAINERS = new Set([
  // Block containers
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'DL',
  'DT',
  'DD',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'BLOCKQUOTE',
  // Inline containers
  'A',
  'EM',
  'STRONG',
  'B',
  'I',
  'S',
  'U',
  'DEL',
  'INS',
  'MARK',
  'SUB',
  'SUP',
  'SMALL',
  'SPAN',
]);

function isWhitespaceOnlyText(node: Node): boolean {
  return node.nodeType === TEXT_NODE && !/\S/.test((node as Text).data);
}

/** Last child that is a non-whitespace text node or an element, or null. */
function lastMeaningfulChild(parent: Node, skip?: (node: Node) => boolean): Node | null {
  const children = parent.childNodes;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (skip && skip(child)) continue;
    if (child.nodeType === TEXT_NODE) {
      if (isWhitespaceOnlyText(child)) continue;
      return child;
    }
    if (child.nodeType === ELEMENT_NODE) return child;
    // Comments and other node types are never anchors and never containers.
  }
  return null;
}

function isFootnoteSection(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  const el = node as Element;
  return el.tagName === 'SECTION' && el.hasAttribute('data-footnotes');
}

function isTailMarker(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && (node as Element).hasAttribute(TAIL_KIND_ATTR);
}

function isFootnoteBackref(node: Node): boolean {
  return node.nodeType === ELEMENT_NODE && (node as Element).hasAttribute('data-footnote-backref');
}

/** Whitelist descent to the deepest last text, threading `skip` through
 *  EVERY level — the footer descent needs it because a definition body
 *  ending in a paragraph carries its backref `<a>↩</a>` INSIDE that
 *  trailing paragraph, not as a direct `<li>` child. */
function descendToText(start: Node | null, skip?: (node: Node) => boolean): Text | null {
  let node = start;
  while (node) {
    if (node.nodeType === TEXT_NODE) return node as Text;
    if (node.nodeType !== ELEMENT_NODE) return null;
    const el = node as Element;
    if (!SAFE_CONTAINERS.has(el.tagName)) return null;
    if (el.classList.contains('katex') || el.classList.contains('katex-display')) return null;
    node = lastMeaningfulChild(el, skip);
  }
  return null;
}

/** The last tail-marker element among `root`'s children, or null. The
 *  renderer appends it after the content blocks, so scan from the end. */
function findTailMarker(root: Element): Element | null {
  const children = root.childNodes;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (isTailMarker(child)) return child as Element;
  }
  return null;
}

/** Locate the footnote `<li>` whose id encodes `label`, using the exact
 *  same two-tier id parsing the aggregate-footer harvest uses
 *  (`sourceIdFromFootnoteLiId`): exact clobber-prefix slice when the
 *  marker supplies one, `user-content-fn-` regex fallback otherwise. */
function findFootnoteLi(root: Element, label: string, clobberPrefix: string | null): Element | null {
  const section = ((): Element | null => {
    const children = root.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      if (isFootnoteSection(children[i])) return children[i] as Element;
    }
    return null;
  })();
  if (!section) return null;
  const target = normalizeId(label);
  // section children: sr-only heading + <ol>; defs are the <ol>'s <li>s.
  for (const child of Array.from(section.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE || (child as Element).tagName !== 'OL') continue;
    for (const li of Array.from(child.childNodes)) {
      if (li.nodeType !== ELEMENT_NODE || (li as Element).tagName !== 'LI') continue;
      const id = (li as Element).getAttribute('id');
      if (!id) continue;
      const sourceId = sourceIdFromFootnoteLiId(id, clobberPrefix ?? undefined);
      if (sourceId !== null && normalizeId(sourceId) === target) return li as Element;
    }
  }
  return null;
}

/**
 * Find the text node the streaming cursor anchors after, or `null` when the
 * cursor must hide for this frame.
 *
 * When the renderer's tail marker says the source tail is inside a footnote
 * definition, the anchor is the deepest last text of THAT definition's
 * footer `<li>` (targeted by label — footer `<li>` order is first-reference
 * order, not definition source order, so "last li" would mis-anchor on
 * out-of-order references), skipping backref links at every level. A
 * missing li (aggregate footer living in another chunk's root, an
 * unreferenced definition, an id whose encoding defeats matching) hides the
 * cursor — conservative, never wrong-place. An `invisible-def` tail (link
 * reference definitions render nothing) hides too. Without a marker the
 * walk keeps its original bet: skip the footer, anchor at the body tail.
 *
 * @param root - The content root: the DOM element whose children are the
 *   rendered top-level blocks (the cursor shell's `parentElement`).
 * @param exclude - The shell's own wrapper element (a child of `root`),
 *   skipped so the cursor never anchors to itself.
 */
export function detectAnchorTextNode(root: Element, exclude: Element | null): Text | null {
  const marker = findTailMarker(root);
  if (marker) {
    const kind = marker.getAttribute(TAIL_KIND_ATTR);
    if (kind === 'invisible-def') return null;
    if (kind === 'footnote-def') {
      const label = marker.getAttribute(TAIL_LABEL_ATTR);
      if (!label) return null;
      const li = findFootnoteLi(root, label, marker.getAttribute(TAIL_CLOBBER_ATTR));
      if (!li) return null;
      return descendToText(li, isFootnoteBackref);
    }
    // Unknown kind (a future marker version): fall through to the default
    // walk rather than hiding — fail toward today's behavior.
  }
  return descendToText(lastMeaningfulChild(root, (n) => n === exclude || isFootnoteSection(n) || isTailMarker(n)));
}
