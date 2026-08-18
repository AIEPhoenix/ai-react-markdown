/**
 * Mirror of `rehype-unwrap-images` for the coordinated pipeline's
 * placeholders. Upstream unwraps a `<p>` whose content is only images (and
 * whitespace, or links wrapping only images) — but it only knows `<img>` /
 * `<a>`. In coordinated mode a reference-style image is a
 * `<cross-chunk-image>` placeholder (a link a `<cross-chunk-link>`), so
 * `![pic][x]` alone in a paragraph stayed wrapped: `<p><img></p>` where
 * the standalone render is a bare `<img>` (v2.4.0 review — the wrapped
 * server output diverged from standalone, and the client resolved path had
 * always differed). Runs AFTER rehype-unwrap-images with the same rule,
 * extended to the placeholder tags. Standalone documents contain no
 * placeholders, so this is a no-op there.
 *
 * @module components/rehypeUnwrapCrossChunkImages
 */
import type { Element, ElementContent, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

const IMAGE_TAGS = new Set(['img', 'cross-chunk-image']);
const LINK_TAGS = new Set(['a', 'cross-chunk-link']);

const enum Verdict {
  Unknown,
  ContainsImage,
  ContainsOther,
}

/** `seen.placeholder` flips when any placeholder tag (image OR link) took
 *  part in the verdict — only such paragraphs are ours to unwrap; plain
 *  `<img>`/`<a>` paragraphs were already unwrapped by rehype-unwrap-images. */
function applicable(node: Element, inLink: boolean, seen: { placeholder: boolean }): Verdict {
  let image = Verdict.Unknown;
  for (const child of node.children as ElementContent[]) {
    if (child.type === 'text' && /^\s*$/.test(child.value)) continue;
    if (child.type === 'element' && IMAGE_TAGS.has(child.tagName)) {
      if (child.tagName !== 'img') seen.placeholder = true;
      image = Verdict.ContainsImage;
    } else if (!inLink && child.type === 'element' && LINK_TAGS.has(child.tagName)) {
      if (child.tagName !== 'a') seen.placeholder = true;
      const inner = applicable(child, true, seen);
      if (inner === Verdict.ContainsOther) return Verdict.ContainsOther;
      if (inner === Verdict.ContainsImage) image = Verdict.ContainsImage;
    } else {
      return Verdict.ContainsOther;
    }
  }
  return image;
}

export function rehypeUnwrapCrossChunkImages() {
  return function transform(tree: Root): void {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'p' || !parent || typeof index !== 'number') return;
      // Only paragraphs where a placeholder took part — an image placeholder
      // OR a link placeholder around a plain `<img>` (`[![pic](url)][ref]`,
      // v2.4.1 review: the old guard only looked for the image tag).
      const seen = { placeholder: false };
      if (applicable(node, false, seen) === Verdict.ContainsImage && seen.placeholder) {
        parent.children.splice(index, 1, ...node.children);
        return [SKIP, index];
      }
    });
  };
}
