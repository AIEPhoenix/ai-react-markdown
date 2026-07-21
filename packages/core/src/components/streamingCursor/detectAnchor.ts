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
 * `childNodes`, `tagName`, `classList.contains`, `hasAttribute`, `data`),
 * so the walk is unit-testable in the node environment with plain-object
 * fakes — no jsdom required.
 *
 * @module components/streamingCursor/detectAnchor
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

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

/**
 * Find the text node the streaming cursor anchors after, or `null` when the
 * cursor must hide for this frame.
 *
 * @param root - The content root: the DOM element whose children are the
 *   rendered top-level blocks (the cursor shell's `parentElement`).
 * @param exclude - The shell's own wrapper element (a child of `root`),
 *   skipped so the cursor never anchors to itself.
 */
export function detectAnchorTextNode(root: Element, exclude: Element | null): Text | null {
  let node: Node | null = lastMeaningfulChild(root, (n) => n === exclude || isFootnoteSection(n));
  while (node) {
    if (node.nodeType === TEXT_NODE) return node as Text;
    if (node.nodeType !== ELEMENT_NODE) return null;
    const el = node as Element;
    if (!SAFE_CONTAINERS.has(el.tagName)) return null;
    if (el.classList.contains('katex') || el.classList.contains('katex-display')) return null;
    node = lastMeaningfulChild(el);
  }
  return null;
}
