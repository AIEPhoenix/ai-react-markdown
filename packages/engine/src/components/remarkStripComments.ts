/**
 * remark transformer behind the `removeComments` engine plugin: strip HTML
 * comments (`<!-- … -->`) out of `html` mdast nodes.
 *
 * Why a local transformer and not `remark-remove-comments`: that plugin
 * removed the whole `html` NODE whenever its value contained a comment. An
 * html block in mdast is one node from its opening line to the next blank
 * line, so `<details>\n<summary>Sum</summary>\n<!-- hidden -->\nBody\n</details>`
 * and `<!-- note --> visible text` both rendered as nothing. This one
 * rewrites the comment spans to `''` and drops the node only when nothing
 * but whitespace is left — which is what a comment-only node becomes, so
 * that case renders exactly as before.
 *
 * The comment lexicon is the one the old plugin used (`<!--` to the nearest
 * `-->`). An UNCLOSED `<!--` — a comment still streaming — is left alone:
 * rehype-raw turns it into a comment node to the end of the value, which
 * sanitize drops, so nothing after it shows either way, and the node keeps
 * anchoring the tree's position (see the empty-output bail in spliceParse).
 *
 * Nodes are replaced, not mutated in place: the splice path keeps references
 * into an earlier frame's tree, and a transformer that edits a shared node
 * would edit that frame too.
 *
 * @module components/remarkStripComments
 */

import type { Html, Root } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

export default function remarkStripComments() {
  return (tree: Root): void => {
    visit(tree, 'html', (node: Html, index, parent) => {
      if (parent === undefined || index === undefined || !node.value.includes('<!--')) return;
      const stripped = node.value.replace(HTML_COMMENT_RE, '');
      if (stripped === node.value) return;
      if (stripped.trim() === '') {
        parent.children.splice(index, 1);
        // Continue at the node that now sits at `index`.
        return [SKIP, index];
      }
      parent.children[index] = { ...node, value: stripped };
      return SKIP;
    });
  };
}
