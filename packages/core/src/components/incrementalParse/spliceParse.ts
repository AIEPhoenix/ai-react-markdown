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

/** One injected footnote-definition block's coordinate mapping — footer
 *  `<li>` content carries positions from the DEF node, so injected-copy
 *  coordinates must be rewritten back to the original's (C0 probe). */
export interface InjectedSegment {
  injStart: number;
  injEnd: number;
  offsetDelta: number;
  lineDelta: number;
}

/** Prefix footnote/definition events in DOCUMENT ORDER. Order is the whole
 *  point: mdast-util-to-hast's footnoteOrder/footnoteCounts are built from
 *  encounter order, and the replay must reproduce it exactly. */
export type InjectionEvent =
  /** Link/image definition — parse-time resolution only, zero hast. */
  | { kind: 'def'; source: string }
  /** Footnote definition — sliced from the PHYSICAL LINE START (column
   *  invariance for the footer position rebase). */
  | { kind: 'footnoteDef'; source: string; origStart: number; origLine: number }
  /** Consecutive footnote references, verbatim source tokens. Seeds
   *  footnoteOrder (first-encounter) and footnoteCounts (backref -N ids). */
  | { kind: 'refs'; tokens: string[] };

export interface PrefixInjectionPlan {
  events: InjectionEvent[];
  /** True when an event exists that CANNOT be injected reliably — the caller
   *  must fall back to a full parse for this frame (safe, one-frame cost). */
  uninjectable: boolean;
}

/** A plan cached in engine state: valid for any LATER boundary of the same
 *  append lineage, because events derive from (content, positions) alone
 *  and the boundary is monotone under appends — new frames only APPEND
 *  events for children in [cached.boundary, newBoundary). */
export interface CachedInjectionPlan extends PrefixInjectionPlan {
  boundary: number;
}

/** Collect the prefix's injectable events (document order).
 *
 * Walks the FULL subtree, not just top-level children: definitions nested
 * inside blockquotes/lists are document-scoped in CommonMark
 * (probe-confirmed A3 — a `> [a]: /url` def must resolve a later tail
 * ref). A nested link definition's position starts at its own `[`, so a
 * single-line slice is a valid standalone def line; a MULTI-LINE nested
 * slice would drag `> ` container prefixes into the injection text, so it
 * is flagged uninjectable instead (full-parse fallback).
 *
 * Footnote definitions must be sliced from their physical line start (the
 * footer position rebase requires column invariance), so ANY nested
 * footnote def is uninjectable — the line-start slice would drag the `> `
 * container prefix in, and a node-start slice would shift columns.
 *
 * footnoteDefinition subtrees are NOT descended: refs inside a def body are
 * counted at FOOTER time (state.all over the stored def node), and the
 * injected def text replays them there; emitting them as inline events
 * would double-count.
 */
export function collectPrefixInjection(
  mdast: MdastRoot,
  content: string,
  boundary: number,
  resume?: CachedInjectionPlan | null
): PrefixInjectionPlan {
  // Resume path (final-review R3): the frozen prefix is byte-identical
  // frame to frame, so a cached plan only needs the children in
  // [resume.boundary, boundary) appended — without this the deep visit
  // re-walks the ENTIRE prefix every splice frame (the collectDefLabels
  // O(stream²) shape). `uninjectable` is sticky: the offending node stays
  // in the prefix for the lineage's lifetime.
  if (resume && resume.uninjectable) return { events: resume.events, uninjectable: true };
  const resumeAt = resume && resume.boundary <= boundary ? resume.boundary : 0;
  const events: InjectionEvent[] = resumeAt > 0 ? cloneEventsForAppend(resume!.events) : [];
  let uninjectable = false;
  const pushRef = (token: string): void => {
    const last = events[events.length - 1];
    if (last && last.kind === 'refs') last.tokens.push(token);
    else events.push({ kind: 'refs', tokens: [token] });
  };
  const visit = (node: UnistNode, nested: boolean): void => {
    const type = (node as { type?: string }).type;
    if (type === 'definition') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start !== undefined && end !== undefined && start < boundary) {
        const slice = content.slice(start, end);
        if (nested && slice.includes('\n')) uninjectable = true;
        else events.push({ kind: 'def', source: slice });
      }
      return;
    }
    if (type === 'footnoteDefinition') {
      const start = node.position?.start;
      const end = node.position?.end?.offset;
      if (start?.offset === undefined || end === undefined || start.offset >= boundary) return;
      if (nested) {
        uninjectable = true;
        return;
      }
      const lineStart = start.offset - (start.column - 1);
      events.push({
        kind: 'footnoteDef',
        source: content.slice(lineStart, end),
        origStart: lineStart,
        origLine: start.line,
      });
      return; // body refs replay at footer time via the injected text
    }
    if (type === 'footnoteReference') {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start === undefined || end === undefined) {
        uninjectable = true; // cannot reproduce the token verbatim
        return;
      }
      pushRef(content.slice(start, end));
      return;
    }
    const children = (node as TreeWithChildren).children;
    if (children) {
      for (const child of children) visit(child, true);
    }
  };
  for (const child of mdast.children) {
    // Top-level children are position-ordered — nothing at or past the
    // boundary can contribute a prefix event (E5), and nothing before the
    // resume point needs re-visiting.
    const start = child.position?.start?.offset;
    if (start !== undefined && start >= boundary) break;
    if (start !== undefined && start < resumeAt) continue;
    visit(child, false);
  }
  return { events, uninjectable };
}

/** Cached plans are shared with the previous state — clone the array, and
 *  the trailing refs event too (pushRef mutates its token list when the new
 *  region opens with another reference). */
function cloneEventsForAppend(events: InjectionEvent[]): InjectionEvent[] {
  const out = events.slice();
  const last = out[out.length - 1];
  if (last && last.kind === 'refs') out[out.length - 1] = { kind: 'refs', tokens: last.tokens.slice() };
  return out;
}

export interface InjectionPrefix {
  text: string;
  segments: InjectedSegment[];
}

/** The injection TERMINATOR: a sentinel link-definition block appended after
 *  the last event. The detector's blockers prove the REAL prefix is inert
 *  toward the tail — but the injection text itself introduces continuation
 *  context the real prefix did not have (final-review R1, probe-confirmed):
 *
 *  - a trailing footnote-def event's body continues across blank lines into
 *    any >=4-indented tail line, swallowing real content into a node the
 *    splice then strips;
 *  - with the definition-list extension, a tail-leading `: desc` separated
 *    from the ORIGINAL prefix by two blank lines (claim-immune) sits only
 *    ONE '\n\n' from the last injected block and would claim it as a <dt>.
 *
 *  A column-0 link definition neutralizes both: it terminates a footnote
 *  body (not >=4-indented), cannot be claimed as a <dt> (not a paragraph),
 *  emits zero hast and zero wrap-separator slots, and is stripped with the
 *  rest of the injected region. The sentinel label collides with real
 *  content only if a document defines the exact same label — the same
 *  accepted-risk class as the phantom sentinel URLs. */
const INJECTION_TERMINATOR = '[__aimd_injection_terminator__]: __aimd_sentinel_link__';

/** Build the injection text prepended to the tail source (with per-footnote-
 *  def coordinate segments). Blocks are '\n\n'-joined: a def line directly
 *  after a ref paragraph would be a paragraph CONTINUATION (A2, literal
 *  text), and anything unindented after a footnote def line would join its
 *  body. */
export function buildInjectionPrefix(events: InjectionEvent[]): InjectionPrefix {
  if (events.length === 0) return { text: '', segments: [] };
  let text = '';
  // Rolling line number of the text end — recounting the accumulated text
  // per event would be O(events × textLength) (final-review R3).
  let line = 1;
  const segments: InjectedSegment[] = [];
  for (const event of events) {
    if (text.length > 0) {
      text += '\n\n';
      line += 2;
    }
    const injStart = text.length;
    const source = event.kind === 'refs' ? event.tokens.join(' ') : event.source;
    if (event.kind === 'footnoteDef') {
      segments.push({
        injStart,
        injEnd: injStart + source.length,
        offsetDelta: event.origStart - injStart,
        lineDelta: event.origLine - line,
      });
    }
    text += source;
    line += countNewlines(source);
  }
  return { text: `${text}\n\n${INJECTION_TERMINATOR}\n\n`, segments };
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
  // Exactly rebaseTreeDual with no segments (find never matches) — one
  // implementation, two names for the two call sites' semantics.
  rebaseTreeDual(node, EMPTY_SEGMENTS, offsetDelta, lineDelta);
}

const EMPTY_SEGMENTS: InjectedSegment[] = [];

/**
 * Dual-rule position rebase for the tail HAST (C0-probe-verified): the
 * footer's `<li>` content carries positions from footnoteById's DEF nodes —
 * for INJECTED defs those are injection coordinates (per-segment mapping),
 * while tail-native nodes (inline content and tail-defined footnotes) take
 * the ordinary tail shift. Dispatch is per POINT with CLOSED segment bounds:
 * END offsets are exclusive, so a node ending exactly at a segment's last
 * byte has offset === injEnd (segments are '\n\n'-separated — unambiguous).
 * Column is invariant under both rules (defs are sliced from line start).
 */
export function rebaseTreeDual(
  node: UnistNode,
  segments: InjectedSegment[],
  offsetDelta: number,
  lineDelta: number
): void {
  // Segments live entirely inside the injection prefix; after the injected
  // region is stripped, ~every remaining point sits past them all. One
  // bound check replaces an always-failing O(segments) scan per point
  // (final-review R3).
  const maxEnd = segments.length > 0 ? segments[segments.length - 1].injEnd : -1;
  rebaseDualWalk(node, segments, maxEnd, offsetDelta, lineDelta);
}

function rebaseDualWalk(
  node: UnistNode,
  segments: InjectedSegment[],
  maxEnd: number,
  offsetDelta: number,
  lineDelta: number
): void {
  const position = node.position as Position | undefined;
  if (position) {
    for (const point of [position.start, position.end]) {
      const seg =
        point.offset !== undefined && point.offset <= maxEnd
          ? segments.find((s) => point.offset! >= s.injStart && point.offset! <= s.injEnd)
          : undefined;
      if (seg) {
        point.offset! += seg.offsetDelta;
        point.line += seg.lineDelta;
      } else {
        if (point.offset !== undefined) point.offset += offsetDelta;
        point.line += lineDelta;
      }
    }
  }
  const children = (node as TreeWithChildren).children;
  if (children) {
    for (const child of children) rebaseDualWalk(child, segments, maxEnd, offsetDelta, lineDelta);
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
  /** Coordinate mappings for injected footnote-def blocks (footer rebase). */
  injectedSegments: InjectedSegment[];
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
  const { prevMdast, prevHast, tailMdast, tailHast, content, boundary, injectionPrefix, injectedSegments } = input;

  const injectedLen = injectionPrefix.length;
  const injectedLines = countNewlines(injectionPrefix);
  // Bounded count — slicing the prefix would allocate a copy of the whole
  // frozen document every frame just to count newlines (final-review R3).
  const prefixLines = countNewlines(content, boundary);
  const offsetDelta = boundary - injectedLen;
  const lineDelta = prefixLines - injectedLines;

  // --- prefix cuts (non-mutating reads of the previous frame's trees) ---
  const prefixMdast: MdastContent[] = [];
  for (const child of prevMdast.children) {
    // Position-ordered — the first child at/past the boundary ends the prefix.
    const start = child.position?.start?.offset;
    if (start !== undefined && start >= boundary) break;
    if (start !== undefined) prefixMdast.push(child);
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
  //
  // ALL injected nodes are dropped from the tail mdast — wrap-invisible
  // defs (v1) and the replay's footnote-ref paragraphs alike; non-injected
  // children can never start before injectedLen.
  const tailMdastChildren = tailMdast.children.filter((child) => {
    const start = child.position?.start?.offset;
    return !(start !== undefined && start < injectedLen);
  });
  const tailWrapVisible = tailMdastChildren.some((child) => !isWrapInvisible(child));

  // Align the cut region against the prefix mdast (stripped-node aware) and
  // rebuild its trailing separators. Bails null on any layout the model
  // does not cover — the caller falls back to a full parse for the frame.
  const hastChildren = alignPrefixCut(prefixMdast, cutRegion, tailWrapVisible);
  if (hastChildren === null) return null;

  // --- tail: strip the injected region's hast, then re-base ---
  const strippedTailHast = stripInjectedHast(tailMdast, tailHast, injectedLen, tailWrapVisible);
  if (strippedTailHast === null) return null;
  for (const child of tailMdastChildren) rebaseTree(child, offsetDelta, lineDelta);
  for (const child of strippedTailHast) rebaseTreeDual(child, injectedSegments, offsetDelta, lineDelta);

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
  const seamMergeAllowed = tailLeadingTextIsHoist(tailMdastChildren, strippedTailHast);
  let firstTailChild = true;
  for (const child of strippedTailHast) {
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
    //
    // LEADING-run exception (final-review R2): when the FIRST wrap-visible
    // child is a table (or any foster-parenting element), rehype-raw's
    // hoisted whitespace has no preceding wrap slot to merge into and lands
    // as a bare leading text node — one leading text with ZERO stripped
    // children. A positioned first content node therefore locates its own
    // pair by containment within [0..sepBuffer.length]; the excess leading
    // texts are hoist, kept verbatim (frozen with their table, stable —
    // interior hoist always merges into an existing slot, so only the
    // leading run needs this). Position-less first content (KaTeX — never
    // hoist-preceded) keeps the pure run-length rule.
    let nextIdx: number;
    if (!sawContent && start !== undefined) {
      nextIdx = -1;
      for (let j = 0; j <= sepBuffer.length && j < visibles.length; j++) {
        const vStart = visibles[j].position?.start?.offset;
        const vEnd = visibles[j].position?.end?.offset;
        if (vStart !== undefined && vEnd !== undefined && start >= vStart && start < vEnd) {
          nextIdx = j;
          break;
        }
      }
      if (nextIdx === -1) return null;
      // j slots belong to the j leading stripped children; the rest is hoist.
      // Only the no-stripped shape is probe-verified (hoist merges into the
      // last slot when slots exist) — mixed shapes beyond one hoist text are
      // out of model.
      if (sepBuffer.length - nextIdx > 1) return null;
    } else {
      const stripped = sawContent ? sepBuffer.length - 1 : sepBuffer.length;
      if (stripped < 0) return null;
      nextIdx = pairIdx + 1 + stripped;
      const candidate = visibles[nextIdx];
      if (!candidate) return null;
      if (start !== undefined) {
        const cStart = candidate.position?.start?.offset;
        const cEnd = candidate.position?.end?.offset;
        if (cStart === undefined || cEnd === undefined || start < cStart || start >= cEnd) return null;
      }
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
 * Drop the injected region's output from a freshly-parsed tail hast.
 *
 * The injection contributes two kinds of root output: the replay's footnote
 * REF paragraphs (one `<p>` each — footnote/link defs are wrap-invisible)
 * and the wrap separators around them. Consume exactly:
 *
 *   output_1 [sep output_2 … sep output_k] [gapSep]
 *
 * where k = injected wrap-visible children and gapSep (present only when
 * the REAL tail has wrap-visible children) is the injected|tail gap slot.
 * gapSep's value beyond its wrap '\n' is rehype-raw HOIST text belonging to
 * the tail's first element (a table) — retained as a leading text node so
 * the seam-merge reproduces the full parse's layout.
 *
 * Returns null on any layout surprise (caller falls back to a full parse).
 */
function stripInjectedHast(
  tailMdast: MdastRoot,
  tailHast: HastRoot,
  injectedLen: number,
  tailWrapVisible: boolean
): HastContent[] | null {
  if (injectedLen === 0) return tailHast.children.slice();
  const injectedVisibleCount = tailMdast.children.filter((c) => {
    const start = c.position?.start?.offset;
    return start !== undefined && start < injectedLen && !isWrapInvisible(c);
  }).length;
  if (injectedVisibleCount === 0) return tailHast.children.slice();

  const children = tailHast.children;
  let idx = 0;
  let consumed = 0;
  while (idx < children.length && consumed < injectedVisibleCount) {
    const node = children[idx];
    if (isSeparatorText(node)) {
      idx += 1;
      continue;
    }
    const start = node.position?.start?.offset;
    // Injected outputs are always positioned paragraphs; running into tail
    // content (or anything unpositioned) before finishing is a surprise.
    if (start === undefined || start >= injectedLen) return null;
    consumed += 1;
    idx += 1;
  }
  if (consumed < injectedVisibleCount) return null;

  let remnant = '';
  if (tailWrapVisible) {
    const gap = children[idx];
    if (!gap || !isSeparatorText(gap)) return null;
    remnant = (gap as { value: string }).value.slice(1);
    idx += 1;
  }
  const rest = children.slice(idx);
  if (remnant !== '') rest.unshift({ type: 'text', value: remnant });
  return rest;
}

/**
 * Decide whether the tail hast's LEADING position-less text may merge with
 * the seam separator. True only when it is rehype-raw hoist output sitting
 * directly against the seam in serialized HTML — i.e. the tail's first
 * wrap-visible mdast child SURVIVED sanitize (its output is the first tail
 * content node). If that child was stripped (leading comment), the leading
 * text is a gap SLOT the full parse keeps as a separate node.
 *
 * Classification exhaustiveness under the SHIPPED plugin chain (this is the
 * one seam decision without a null→full-parse escape, so the false branch
 * must be provably correct wherever the evidence is ambiguous): every
 * "cannot positively classify" case returns false, and false is right for
 * each — no first content node ⇒ the leading texts are stripped-child slots
 * (comment-only tail); position-less first content ⇒ KaTeX output, which no
 * foster-parenting element precedes (hoist comes only from positioned
 * tables). A consumer rehype plugin emitting novel root-level position-less
 * text could defeat this — such a plugin changes depsKey/G3 identity and is
 * outside the arbiter's modeled chain, like every other plugin-behavior
 * assumption in this file.
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

/** Newlines in `text` before `end` (defaults to the whole string) — the
 *  bound avoids allocating prefix slices on the per-frame hot path. */
function countNewlines(text: string, end = text.length): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) count += 1;
  return count;
}
