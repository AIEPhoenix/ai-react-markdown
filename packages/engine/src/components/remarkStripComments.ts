/**
 * remark transformer behind the `removeComments` engine plugin: drop mdast
 * `html` nodes whose value is nothing but complete HTML comments
 * (`<!-- … -->`) and whitespace. Every other html node is left exactly as
 * parsed — the value is never edited.
 *
 * Why only whole nodes: downstream, rehype-raw (parse5) tokenizes comments
 * correctly — a `<!--` inside a quoted attribute is attribute text, a
 * comment between tags is a comment node — and rehype-sanitize drops comment
 * nodes, so comments embedded in other markup vanish from the rendered
 * output without any mdast surgery. Editing the value would do harm twice:
 * `<div title="<!-- keep -->">` lost its attribute, and a node that keeps
 * its `position` while losing bytes shifts every position hast-util-raw
 * derives for the elements after the removed span, which breaks the splice
 * contract (spliced trees equal a full parse, positions included) and the
 * cache keys built on those positions.
 *
 * What removing the comment-only nodes buys: a comment-only block does not
 * survive as a raw-HTML region that forces conservative block planning, and
 * an inline `<!-- x -->` node disappears from its paragraph.
 *
 * Why not `remark-remove-comments`: it removed the whole node whenever the
 * value CONTAINED a comment, and an html block is one node up to its blank
 * line, so `<details>…<!-- hidden -->…</details>` rendered as nothing.
 *
 * The comment-only check is deliberately conservative. It accepts only a
 * sequence of `<!--` + text + `-->` comments separated by whitespace, where
 * the text holds none of `-->`, `--!>` or `<!--` and does not start with
 * `>` or `->`. `<!-->` and `<!--->` (CommonMark 0.31 empty comments), a
 * body parse5 would close early (`--!>`, a nested `<!--`), and an UNCLOSED
 * `<!--` — a comment still streaming — all leave the node alone: rehype-raw
 * and sanitize decide what shows, and the node keeps anchoring the tree's
 * position (see the empty-output bail in spliceParse).
 *
 * The parent's children array is spliced; no node is mutated. The splice
 * path keeps references into an earlier frame's tree, and a transformer that
 * edits a shared node would edit that frame too.
 *
 * @module components/remarkStripComments
 */

import type { Html, Root } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

const OPEN = '<!--';
const CLOSE = '-->';

function isWhitespace(code: number): boolean {
  // Space, tab, LF, CR, FF: the whitespace micromark leaves around an html
  // block's lines and between inline nodes.
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

/** True when `value` is one or more complete HTML comments separated by whitespace. */
export function isCommentOnlyHtml(value: string): boolean {
  const n = value.length;
  let i = 0;
  let comments = 0;
  for (;;) {
    while (i < n && isWhitespace(value.charCodeAt(i))) i += 1;
    if (i === n) return comments > 0;
    if (!value.startsWith(OPEN, i)) return false;
    const bodyStart = i + OPEN.length;
    // `<!-->` / `<!--->`: empty-comment edge forms, left to parse5.
    if (value.startsWith('>', bodyStart) || value.startsWith('->', bodyStart)) return false;
    const end = value.indexOf(CLOSE, bodyStart);
    if (end < 0) return false; // Unclosed: still streaming.
    const body = value.slice(bodyStart, end);
    // A body parse5 would end before CommonMark does.
    if (body.includes('--!>') || body.includes(OPEN)) return false;
    i = end + CLOSE.length;
    comments += 1;
  }
}

export default function remarkStripComments() {
  return (tree: Root): void => {
    visit(tree, 'html', (node: Html, index, parent) => {
      if (parent === undefined || index === undefined || !node.value.includes(OPEN)) return;
      if (!isCommentOnlyHtml(node.value)) return SKIP;
      parent.children.splice(index, 1);
      // Continue at the node that now sits at `index`.
      return [SKIP, index];
    });
  };
}
