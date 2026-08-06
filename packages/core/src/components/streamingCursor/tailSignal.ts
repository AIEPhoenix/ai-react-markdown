/**
 * Source-tail classification for the streaming cursor.
 *
 * The cursor's DOM walk cannot know whether the source tail is in the body
 * or inside a footnote definition — mdast-util-to-hast relocates every
 * definition into the synthetic end-of-document footer, decoupling the
 * footer's DOM position from source position. This module answers the
 * question at the mdast level, where micromark has already made every
 * grammar decision (lazy continuation lines, container nesting, blank-line
 * attachment, label escapes): the renderer derives a signal per frame from
 * the tree it is about to render and stamps it on a DOM marker the cursor
 * shell reads in the same commit.
 *
 * Deliberately NOT a text scan of the trailing lines: a hand-rolled
 * back-walk would be a third parallel grammar in the repo and provably
 * mis-classifies lazy continuations (`[^1]: line\nline2` keeps line2 in
 * the definition with zero indentation), resurfacing the exact bug this
 * exists to fix.
 *
 * @module components/streamingCursor/tailSignal
 */

import type { Parent, Root, RootContent } from 'mdast';

export type TailSignal =
  /** The source tail is inside a footnote definition — its text renders in
   *  the footnote footer's `<li>` for `identifier` (mdast's case-folded
   *  form), not at the body tail. */
  | { kind: 'footnote-def'; identifier: string }
  /** The source tail is inside a link-reference definition — it renders
   *  nothing at all; the cursor should hide rather than point at stale
   *  body text. */
  | { kind: 'invisible-def' }
  /** The source tail is ordinary body content — the DOM-tail heuristic is
   *  correct as-is. */
  | null;

/** Node types the descent passes THROUGH looking for the tail definition.
 *  Definitions legally nest inside all of these (`> [^a]: x`,
 *  `- [^a]: x`, and a def inside another def's body), and their rendered
 *  text still relocates to the footer — so the descent is required for
 *  correctness, not an optimization. Nothing else can contain a def. */
const DESCEND_THROUGH = new Set(['blockquote', 'list', 'listItem', 'footnoteDefinition']);

/**
 * Classify the source tail of `mdast`.
 *
 * @param mdast - The tree the renderer is about to render (post-pipeline
 *   parse output; the incremental path's spliced tree carries correct
 *   positions on real nodes).
 * @param contentLength - Length of the PREPROCESSED content string the
 *   renderer parsed (not the caller's raw prop). Phantom definitions are
 *   injected as an appended suffix before parsing, so every node whose
 *   start offset sits at or past the real content's end is a phantom — the
 *   scan walks backwards past ALL of them (a real trailing def plus
 *   several phantoms is a normal shape) and classifies the first real
 *   node.
 */
export function deriveTailSignal(mdast: Root, contentLength: number): TailSignal {
  const children = mdast.children;
  let index = children.length - 1;
  while (index >= 0) {
    const offset = children[index].position?.start?.offset;
    if (offset !== undefined && offset >= contentLength) {
      index--;
      continue;
    }
    break;
  }
  if (index < 0) return null;

  let node: RootContent = children[index];
  let deepestFootnoteDef: { identifier: string } | null = null;
  for (;;) {
    if (node.type === 'footnoteDefinition') deepestFootnoteDef = node;
    if (node.type === 'definition') {
      // A link-reference definition renders nothing wherever it sits —
      // including as the last child of a footnote definition's body.
      return { kind: 'invisible-def' };
    }
    if (!DESCEND_THROUGH.has(node.type)) break;
    const kids = (node as Parent).children;
    if (!kids || kids.length === 0) break;
    node = kids[kids.length - 1] as RootContent;
  }
  // The DEEPEST definition on the last-child chain is where text is
  // streaming (a def nested in another def's body renders in ITS OWN li).
  return deepestFootnoteDef ? { kind: 'footnote-def', identifier: deepestFootnoteDef.identifier } : null;
}
