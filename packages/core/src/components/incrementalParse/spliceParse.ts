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
 *
 * Sanitize-STRIPPED prefix nodes (HTML comments, `<?…?>` bogus comments,
 * `<script>`) are modeled explicitly: their wrap separators survive as
 * orphans, and `alignPrefixCut` re-derives the mdast↔hast pairing from
 * separator-run lengths (B0-probe-verified: one orphan '\n' per stripped
 * child's gap slot). Layouts outside the model return null → full-parse
 * fallback for the frame.
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
  const cutRegion: HastContent[] = [];
  for (let i = 0; i < prevHast.children.length && attrs[i] < boundary; i++) {
    cutRegion.push(prevHast.children[i]);
  }

  // wrap() emits separators per mdast-child ADJACENCY, before sanitize
  // strips anything — so the seam's existence is decided by the tail's
  // post-transform MDAST (excluding wrap-invisible types, which produce no
  // to-hast output), not by whether the tail hast ends up non-empty.
  // (Learned from the arbiter: a sanitize-removed comment leaves its
  // separator behind.)
  const tailMdastChildren = tailMdast.children.filter((child) => {
    const start = child.position?.start?.offset;
    return !(isWrapInvisible(child) && start !== undefined && start < injectedLen);
  });
  const tailWrapVisible = tailMdastChildren.some((child) => !isWrapInvisible(child));

  // Align the cut region against the prefix mdast (stripped-node aware) and
  // rebuild its trailing separators. Bails null on any layout the model
  // does not cover — the caller falls back to a full parse for the frame.
  const hastChildren = alignPrefixCut(prefixMdast, cutRegion, tailWrapVisible);
  if (hastChildren === null) return null;

  // --- tail: drop injected definitions, then re-base into document space ---
  for (const child of tailMdastChildren) rebaseTree(child, offsetDelta, lineDelta);
  for (const child of tailHast.children) rebaseTree(child, offsetDelta, lineDelta);

  // --- join ---
  //
  // Seam anatomy (all learned from the arbiter, not theory):
  // - Pre-raw, wrap() puts exactly ONE '\n' text node between any two root
  //   children — including between the last frozen block and the first
  //   tail block; `alignPrefixCut` has already synthesized it (plus one per
  //   trailing stripped-child gap) as plain '\n' nodes.
  // - rehype-raw's reserialize+reparse HOISTS whitespace-only text out of
  //   table internals to just BEFORE the <table> (parse5 foster-parenting),
  //   then merges it with the adjacent separator into one multi-'\n' text
  //   node. That run is TAIL-derived and grows with the table — it must
  //   come from the tail parse (which reproduces it as leading text), not
  //   from the previous frame's tree. Joining therefore MERGES the seam
  //   separator with the tail's leading text, exactly like the reparse
  //   would — but ONLY when they were literally adjacent in the serialized
  //   HTML. A tail whose first wrap-visible child was sanitize-STRIPPED
  //   (leading comment) emits its leading text as a gap SLOT that the full
  //   parse keeps as a separate node (the comment sat between them at
  //   reparse time), so merging would be wrong there.
  const mdastChildren = prefixMdast.concat(tailMdastChildren);
  const seamMergeAllowed = tailLeadingTextIsHoist(tailMdastChildren, tailHast.children);
  let firstTailChild = true;
  for (const child of tailHast.children) {
    const tailEnd = hastChildren[hastChildren.length - 1];
    if (
      firstTailChild &&
      seamMergeAllowed &&
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
      firstTailChild = false;
      continue;
    }
    firstTailChild = false;
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

/** mdast types with no to-hast output AND no wrap separator slot. Everything
 *  else gets a slot at wrap() time — even nodes sanitize later strips
 *  (comments, PIs, `<script>`), whose slots survive as orphan separators. */
function isWrapInvisible(node: MdastContent): boolean {
  return node.type === 'definition' || node.type === 'footnoteDefinition';
}

/**
 * Stripped-node-aware prefix cut (B0-probe-verified layout model).
 *
 * The cut region of the previous hast interleaves CONTENT nodes with
 * position-less '\n' SEPARATORS. wrap() emitted one separator per gap
 * between adjacent wrap-visible mdast children; sanitize then stripped some
 * children's output (HTML comment / PI / `<script>`), leaving their
 * separators orphaned. The walk below re-derives the pairing:
 *
 * - separator-run lengths are the gap ground truth (a run of length L
 *   between two content nodes ⇒ L−1 stripped children between them; a
 *   leading run of length L ⇒ L leading stripped children);
 * - positioned content cross-checks the pairing (its start offset must fall
 *   inside the paired mdast child's range). Multiple positioned content
 *   nodes inside ONE child's range are a raw-reparse multi-output html
 *   block — legal, zero separators between them;
 * - position-less content (KaTeX span) pairs by cursor arithmetic alone.
 *
 * Internal separators are kept VERBATIM (one before a frozen <table> may
 * legitimately hold hoisted newlines — frozen with the table, stable). The
 * TRAILING run is rebuilt from scratch as plain '\n' nodes: its last member
 * is seam-adjacent and may carry the previous frame's tail-derived hoist
 * (stale), and its length must reflect the CURRENT tail's wrap visibility,
 * not the previous frame's.
 *
 * Returns null whenever the observed layout contradicts the model — the
 * caller falls back to a full parse (safe, one-frame cost).
 */
function alignPrefixCut(
  prefixMdast: MdastContent[],
  cutRegion: HastContent[],
  tailWrapVisible: boolean
): HastContent[] | null {
  const visibles = prefixMdast.filter((c) => !isWrapInvisible(c));

  const out: HastContent[] = [];
  let sepBuffer: HastContent[] = [];
  let pairIdx = -1; // index into `visibles` of the child paired with the last content node
  let sawContent = false;

  for (const node of cutRegion) {
    if (isSeparatorText(node)) {
      sepBuffer.push(node);
      continue;
    }
    const start = node.position?.start?.offset;
    const paired = pairIdx >= 0 ? visibles[pairIdx] : undefined;
    if (
      sawContent &&
      start !== undefined &&
      paired &&
      paired.position?.start?.offset !== undefined &&
      paired.position?.end?.offset !== undefined &&
      start >= paired.position.start.offset &&
      start < paired.position.end.offset
    ) {
      // Multi-output continuation of the SAME mdast child (raw reparse of a
      // multi-element html block) — serialized adjacently, so no separator
      // may sit between the outputs.
      if (sepBuffer.length !== 0) return null;
      out.push(node);
      continue;
    }
    // New pairing: the separator run before this node covers the gap from
    // the previous content node (1 separator) plus one per stripped child.
    const stripped = sawContent ? sepBuffer.length - 1 : sepBuffer.length;
    if (stripped < 0) return null;
    const nextIdx = pairIdx + 1 + stripped;
    const candidate = visibles[nextIdx];
    if (!candidate) return null;
    if (start !== undefined) {
      const cStart = candidate.position?.start?.offset;
      const cEnd = candidate.position?.end?.offset;
      if (cStart === undefined || cEnd === undefined || start < cStart || start >= cEnd) return null;
    }
    out.push(...sepBuffer, node);
    sepBuffer = [];
    pairIdx = nextIdx;
    sawContent = true;
  }

  // Trailing region: every visible child after the last paired one must be
  // stripped. The observed run came from the PREVIOUS frame (its length
  // includes that frame's seam separator when its tail was wrap-visible),
  // so it is discarded and rebuilt for the current tail.
  const trailingStripped = visibles.length - (pairIdx + 1);
  const trailingGaps = sawContent ? trailingStripped : Math.max(0, visibles.length - 1);
  if (sepBuffer.length !== trailingGaps && sepBuffer.length !== trailingGaps + 1) return null;
  const seam = visibles.length > 0 && tailWrapVisible ? 1 : 0;
  for (let i = 0; i < trailingGaps + seam; i++) {
    out.push({ type: 'text', value: '\n' });
  }
  return out;
}

/**
 * Decide whether the tail hast's LEADING position-less text may merge with
 * the seam separator. True only when it is rehype-raw hoist output sitting
 * directly against the seam in serialized HTML — i.e. the tail's first
 * wrap-visible mdast child SURVIVED sanitize (its output is the first tail
 * content node). If that child was stripped (leading comment), the leading
 * text is a gap SLOT the full parse keeps as a separate node.
 */
function tailLeadingTextIsHoist(tailMdastChildren: MdastContent[], tailHastChildren: HastContent[]): boolean {
  const firstText = tailHastChildren[0];
  if (!firstText || !isSeparatorText(firstText)) return false;
  const firstVisible = tailMdastChildren.find((c) => !isWrapInvisible(c));
  if (!firstVisible) return false;
  const firstContent = tailHastChildren.find((c) => !isSeparatorText(c));
  const start = firstContent?.position?.start?.offset;
  const vStart = firstVisible.position?.start?.offset;
  const vEnd = firstVisible.position?.end?.offset;
  if (start === undefined || vStart === undefined || vEnd === undefined) return false;
  return start >= vStart && start < vEnd;
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
