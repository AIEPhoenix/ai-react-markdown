/**
 * Pure splice helpers for incremental (prefix-freeze) parsing: cut the
 * frozen prefix out of the previous frame's trees, re-base a tail-only
 * parse into document coordinates, and join the two into fresh roots.
 *
 * Invariant these helpers exist to uphold (enforced by the
 * splice-equivalence arbiter test, NOT asserted at runtime): the spliced
 * `{mdast, hast}` is deep-equal — positions included — to a full pipeline
 * run over the whole content. Defined on UNRENDERED trees; after a render,
 * `renderHastSubtree` mutates hast in place (convergent `data.originalUrls`
 * stash, raw→text rewrite — see Markdown.tsx), so no in-component
 * deep-equal check is possible or attempted.
 *
 * Prefix link/image definitions are PREPENDED to the tail source (not
 * appended: a streaming tail routinely ends inside an unclosed fence or
 * `$$` block that would swallow appended lines, and appended defs would
 * invert CommonMark first-def-wins against a same-label tail def).
 * Definitions emit zero hast (mdast-util-to-hast has no `definition`
 * handler), so their only trace is `definition` mdast nodes inside the
 * injected region, which are dropped before the join. Definition text is
 * sliced verbatim from the previous content via node positions — exact
 * source roundtrip preserves escapes and multi-line titles.
 */

import type { Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Root as MdastRoot, RootContent as MdastContent } from 'mdast';
import type { Node as UnistNode, Position } from 'unist';

import { attributeHastChildren } from './attributeHastChildren';

export interface PrefixDefCollection {
  /** Verbatim source slices, injectable as standalone def lines. */
  sources: string[];
  /** True when a def exists that CANNOT be injected reliably — the caller
   *  must fall back to a full parse for this frame (safe, one-frame cost). */
  uninjectable: boolean;
}

/** Source slices of link/image definitions that start before `boundary`.
 *
 * Walks the FULL subtree, not just top-level children: definitions nested
 * inside blockquotes/lists are document-scoped in CommonMark
 * (probe-confirmed A3 — a `> [a]: /url` def must resolve a later tail
 * ref). A nested definition's position starts at its own `[`, so a
 * single-line slice is a valid standalone def line; a MULTI-LINE nested
 * slice would drag `> ` container prefixes into the injection text, so it
 * is flagged uninjectable instead (full-parse fallback). */
export function collectPrefixDefSources(mdast: MdastRoot, content: string, boundary: number): PrefixDefCollection {
  const sources: string[] = [];
  let uninjectable = false;
  const visit = (node: UnistNode, nested: boolean): void => {
    if ((node as { type?: string }).type === 'definition') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start !== undefined && end !== undefined && start < boundary) {
        const slice = content.slice(start, end);
        if (nested && slice.includes('\n')) uninjectable = true;
        else sources.push(slice);
      }
      return;
    }
    const children = (node as TreeWithChildren).children;
    if (children) {
      for (const child of children) visit(child, true);
    }
  };
  for (const child of mdast.children) {
    // Top-level children are position-ordered — nothing at or past the
    // boundary can contribute a prefix definition (E5).
    const start = child.position?.start?.offset;
    if (start !== undefined && start >= boundary) break;
    if (child.type === 'definition') visit(child, false);
    else visit(child, true);
  }
  return { sources, uninjectable };
}

/** The injection block prepended to the tail source ('' when no defs). */
export function buildInjectionPrefix(defSources: string[]): string {
  return defSources.length > 0 ? `${defSources.join('\n')}\n\n` : '';
}

interface TreeWithChildren extends UnistNode {
  children?: UnistNode[];
}

/**
 * Shift every position in the subtree from tail-parse coordinates into
 * document coordinates. Tolerates position-less subtrees (KaTeX output).
 * Mutates in place — callers only pass freshly-parsed tail trees.
 */
export function rebaseTree(node: UnistNode, offsetDelta: number, lineDelta: number): void {
  const position = node.position as Position | undefined;
  if (position) {
    if (position.start.offset !== undefined) position.start.offset += offsetDelta;
    position.start.line += lineDelta;
    if (position.end.offset !== undefined) position.end.offset += offsetDelta;
    position.end.line += lineDelta;
  }
  const children = (node as TreeWithChildren).children;
  if (children) {
    for (const child of children) rebaseTree(child, offsetDelta, lineDelta);
  }
}

export interface SpliceInput {
  prevMdast: MdastRoot;
  prevHast: HastRoot;
  /** Tail trees, freshly parsed from `injectionPrefix + content.slice(boundary)`. */
  tailMdast: MdastRoot;
  tailHast: HastRoot;
  content: string;
  boundary: number;
  injectionPrefix: string;
}

/**
 * Cut the frozen prefix from the previous trees, drop injected-def nodes
 * from the tail, re-base the tail, synthesize the root-level `'\n'` seam
 * separator (mdast-util-to-hast's `wrap()` inserts one strictly BETWEEN
 * root children — the full parse has it at the prefix/tail junction, the
 * tail-only parse does not), and join into fresh root objects. Fresh roots
 * every frame keep blockMemo's node-identity assumptions intact while
 * never mutating the previous frame's roots.
 */
export function spliceTrees(input: SpliceInput): { mdast: MdastRoot; hast: HastRoot } | null {
  const { prevMdast, prevHast, tailMdast, tailHast, content, boundary, injectionPrefix } = input;

  const injectedLen = injectionPrefix.length;
  const injectedLines = countNewlines(injectionPrefix);
  const prefixLines = countNewlines(content.slice(0, boundary));
  const offsetDelta = boundary - injectedLen;
  const lineDelta = prefixLines - injectedLines;

  // --- prefix cuts (non-mutating reads of the previous frame's trees) ---
  const prefixMdast: MdastContent[] = [];
  for (const child of prevMdast.children) {
    const start = child.position?.start?.offset;
    if (start !== undefined && start < boundary) prefixMdast.push(child);
  }
  const attrs = attributeHastChildren(prevMdast, prevHast, boundary);
  const prefixHast: HastContent[] = [];
  for (let i = 0; i < prevHast.children.length && attrs[i] < boundary; i++) {
    prefixHast.push(prevHast.children[i]);
  }

  // Wrap-separator bookkeeping is only sound when every wrap-visible prefix
  // mdast child still has a hast output node: a sanitize-STRIPPED node
  // (HTML comment, `<?…?>` bogus comment — probe-confirmed A6) leaves its
  // wrap separators behind but no output, so the seam would need a
  // stripped-node-position-aware separator count. Rather than model that,
  // bail to a full parse for the frame (the default config removes
  // comments at the mdast level, so this fallback is rare in practice).
  const visiblePrefixCount = prefixMdast.filter((c) => c.type !== 'definition').length;
  const outputCount = prefixHast.filter((c) => !isSeparatorText(c)).length;
  if (visiblePrefixCount !== outputCount) return null;

  // --- tail: drop injected definitions, then re-base into document space ---
  const tailMdastChildren = tailMdast.children.filter((child) => {
    const start = child.position?.start?.offset;
    return !(child.type === 'definition' && start !== undefined && start < injectedLen);
  });
  for (const child of tailMdastChildren) rebaseTree(child, offsetDelta, lineDelta);
  for (const child of tailHast.children) rebaseTree(child, offsetDelta, lineDelta);

  // --- join ---
  //
  // Seam anatomy (all learned from the arbiter, not theory):
  // - Pre-raw, wrap() puts exactly ONE '\n' text node between any two root
  //   children — including between the last frozen block and the first
  //   tail block. Attribution quirk: a separator following an UNPOSITIONED
  //   element (KaTeX output) is pinned to the PRECEDING mdast block and is
  //   already inside the cut; after a positioned element it attaches to
  //   the next block and falls outside it. Synthesize only in the latter
  //   case.
  // - rehype-raw's reserialize+reparse HOISTS whitespace-only text out of
  //   table internals to just BEFORE the <table> (parse5 foster-parenting),
  //   then merges it with the wrap separator into one multi-'\n' text
  //   node. That run is TAIL-derived and grows with the table — it must
  //   come from the tail parse (which reproduces it as leading text), not
  //   from the previous frame's tree. Joining therefore MERGES adjacent
  //   text nodes across the seam, exactly like the reparse would.
  const mdastChildren = prefixMdast.concat(tailMdastChildren);
  const hastChildren: HastContent[] = prefixHast.slice();
  const last = hastChildren[hastChildren.length - 1];
  // wrap() emits the seam separator per mdast-child ADJACENCY, before
  // sanitize strips anything — so its existence is decided by the tail's
  // post-transform MDAST (excluding definitions, which produce no to-hast
  // output), not by whether the tail hast ends up non-empty. (Learned from
  // the arbiter: a sanitize-removed comment leaves its separator behind.)
  const tailWrapVisible = tailMdastChildren.some((child) => child.type !== 'definition');
  if (hastChildren.length > 0 && tailWrapVisible) {
    if (last && isSeparatorText(last)) {
      // The cut-trailing separator (attribution pins it to the preceding
      // block after unpositioned elements like KaTeX output) may already
      // contain the PREVIOUS frame's hoisted-table newlines — tail-derived
      // and stale. The prefix-side contribution is always exactly one
      // wrap '\n'; the tail's own hoist re-merges below.
      hastChildren[hastChildren.length - 1] = { type: 'text', value: '\n' };
    } else {
      hastChildren.push({ type: 'text', value: '\n' });
    }
  }
  for (const child of tailHast.children) {
    const tailEnd = hastChildren[hastChildren.length - 1];
    if (
      tailEnd &&
      tailEnd.type === 'text' &&
      tailEnd.position === undefined &&
      child.type === 'text' &&
      child.position === undefined
    ) {
      // Adjacent position-less text at the seam — the full parse would have
      // merged these during rehype-raw's reparse. Replace (don't mutate) the
      // seam node: it may be a reference into the previous frame's tree.
      hastChildren[hastChildren.length - 1] = { ...tailEnd, value: tailEnd.value + child.value };
      continue;
    }
    hastChildren.push(child);
  }

  // Root positions must match a full parse: start of document to end of
  // document. The re-based tail MDAST root end IS the document end. The
  // tail HAST root's position is NOT source-based after rehype-raw's
  // reparse (hast-util-raw rewrites it in serialized-HTML coordinates), so
  // it cannot be re-based — but a full parse leaves the hast root position
  // equal to the mdast root position (arbiter-verified), so reuse that.
  const docStart = { line: 1, column: 1, offset: 0 };
  const mdastRootPosition = tailMdast.position
    ? { start: docStart, end: rebasePoint(tailMdast.position.end, offsetDelta, lineDelta) }
    : prevMdast.position;
  const hastRootPosition = mdastRootPosition;

  const mdast: MdastRoot = { type: 'root', children: mdastChildren };
  if (mdastRootPosition) mdast.position = mdastRootPosition;
  const hast: HastRoot = { type: 'root', children: hastChildren };
  if (hastRootPosition) hast.position = hastRootPosition;
  if (prevHast.data !== undefined) hast.data = prevHast.data;
  return { mdast, hast };
}

function rebasePoint(point: Position['end'], offsetDelta: number, lineDelta: number): Position['end'] {
  return {
    line: point.line + lineDelta,
    column: point.column,
    offset: point.offset !== undefined ? point.offset + offsetDelta : undefined,
  };
}

/** Position-less whitespace-only root text — wrap()/rehype-raw separator runs. */
function isSeparatorText(node: HastContent): boolean {
  return node.type === 'text' && node.position === undefined && node.value.trim() === '';
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) count += 1;
  return count;
}
