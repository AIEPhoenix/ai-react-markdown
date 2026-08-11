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
 * child's gap slot; separators MERGED into raw trailing literals count via
 * their trailing newlines — `literalCredit`). Layouts outside the model
 * return null → full-parse fallback for the frame.
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
  /** False when the plan must NOT be cached for resume: a position-less
   *  top-level child cannot be partitioned by the resume offset, so a
   *  resumed walk would re-visit it and duplicate its events (round-2
   *  review). Fresh walks stay correct — they just can't be incremental. */
  cacheable?: boolean;
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
  // O(stream²) shape). Boundary validity gates EVERYTHING resumed —
  // including the sticky-uninjectable short-circuit: the boundary is
  // monotone within an append lineage today, but a regressed cache must
  // degrade to a fresh walk, never to a stale verdict (round-2 review).
  const resumeValid = resume != null && resume.boundary <= boundary;
  // `uninjectable` is sticky: the offending node stays in the prefix for
  // the lineage's lifetime.
  if (resumeValid && resume!.uninjectable) return { events: resume!.events, uninjectable: true };
  const resumeAt = resumeValid ? resume!.boundary : 0;
  const events: InjectionEvent[] = resumeAt > 0 ? cloneEventsForAppend(resume!.events) : [];
  let uninjectable = false;
  let cacheable = true;
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
    if (start === undefined) {
      // A position-less top-level child cannot be partitioned by offset: a
      // resumed walk would re-visit it and DUPLICATE its cached events.
      // Restart fresh once (correct by construction) and mark the plan
      // uncacheable. Unreachable with the shipped chain (the parser
      // positions every top-level node); defense for plugin-shaped trees.
      if (resumeAt > 0) return collectPrefixInjection(mdast, content, boundary, null);
      cacheable = false;
      visit(child, false);
      continue;
    }
    if (start >= boundary) break;
    if (start < resumeAt) continue;
    visit(child, false);
  }
  return { events, uninjectable, cacheable };
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
 *  rest of the injected region.
 *
 *  Unlike the phantom sentinel URLs (values — they can never change parse
 *  SHAPE), a definition LABEL is resolvable by any `[label]` mention, so a
 *  document that literally writes the sentinel label would have its tail
 *  mentions resolve against the terminator (round-2 review, probe-
 *  confirmed). {@link tailMentionsTerminator} closes that structurally:
 *  such frames take the full path instead of splicing. */
const TERMINATOR_LABEL = '__aimd_injection_terminator__';
const INJECTION_TERMINATOR = `[${TERMINATOR_LABEL}]: __aimd_sentinel_link__`;

/** True when the tail input could REFERENCE the terminator's label — the
 *  one input class where the splice's synthetic definition would change how
 *  the tail parses. Prefix mentions need no check: an unresolved mention is
 *  reference-tainted (pinned into the tail), and a resolved one has a real
 *  def that wins first-def-wins over the terminator. */
export function tailMentionsTerminator(tailSource: string): boolean {
  return tailSource.includes(`[${TERMINATOR_LABEL}`);
}

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
  // Filter semantics (no ordered-children early break): together with G4's
  // full straddle scan this keeps the cut correct-or-bailing even for
  // disordered trees a plugin-shaped mdast could present (round-2 review).
  const prefixMdast: MdastContent[] = [];
  for (const child of prevMdast.children) {
    const start = child.position?.start?.offset;
    if (start !== undefined && start < boundary) prefixMdast.push(child);
  }
  const attrs = attributeHastChildren(prevMdast, prevHast, boundary);
  const cutRegion: HastContent[] = [];
  for (let i = 0; i < prevHast.children.length; i++) {
    if (attrs[i] < boundary) {
      const node = prevHast.children[i];
      // HAST STRADDLE BAIL (campaign, 2026-08-03): an mdast-clean boundary
      // does not imply a hast-clean one — parse5's tree construction can
      // hoist an unclosed inline element (`<details>` open tag in a frozen
      // paragraph) to the root, where it swallows every later sibling. The
      // frozen subtree then CONTAINS tail bytes, and the tail re-parse
      // duplicates them (seed-20260751 counterexample). A positioned cut
      // child whose source extends past the boundary is exactly that shape.
      const end = node.position?.end?.offset;
      if (end !== undefined && end > boundary) return null;
      // A position-less CONTENT text is only attributable when it directly
      // follows a positioned element — its owner (parse5 merges adjacent
      // texts, so one block never emits two literal nodes). One that
      // follows another text is a stripped-construct remnant whose owner
      // may live PAST the boundary (`<?instr <b> ?>` → ` ?>`, seed-20260830:
      // attribution stalls on the last positioned child and pulled the
      // CURRENT TAIL's remnant into the cut, duplicating it). Ownership is
      // undecidable here — bail to a full parse.
      if (isTrailingLiteralText(node)) {
        const prev = i > 0 ? prevHast.children[i - 1] : undefined;
        if (!prev || prev.type !== 'element' || prev.position === undefined) return null;
      }
      cutRegion.push(node);
      continue;
    }
    // Raw trailing literal of a frozen html block (fuzz counterexample):
    // `</tag>` followed by an unblanked text line makes rehype-raw emit the
    // line as a POSITION-LESS non-whitespace text after the element. Being
    // position-less it is attributed FORWARD (to the first tail block), but
    // its bytes live before the boundary — it must freeze with its owner,
    // the preceding included node. Whitespace-only texts stay excluded:
    // those are separators/foster-hoist, owned by the model below.
    //
    // OWNERSHIP is element-adjacency (seed-20260830 regression, exposed by
    // removing the coarse tail bail): a real trailing literal always sits
    // DIRECTLY after its owner's element output — parse5 merges adjacent
    // texts, so one block never emits two literal nodes. A position-less
    // non-whitespace text after a TEXT node is the current tail's own
    // stripped-construct remnant (`<?instr <b> ?>` → ` ?>`), which the tail
    // re-parse reproduces — freezing it would duplicate it.
    const node = prevHast.children[i];
    if (
      i > 0 &&
      attrs[i - 1] < boundary &&
      prevHast.children[i - 1].type === 'element' &&
      isTrailingLiteralText(node)
    ) {
      cutRegion.push(node);
    }
    break;
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
  const stripResult = stripInjectedHast(tailMdast, tailHast, injectedLen, tailWrapVisible);
  if (stripResult === null) return null;
  const strippedTailHast = stripResult.rest;
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
  // Layout-driven verdict when the injection gap proved it (see
  // stripInjectedHast docs); the classification covers uninjected tails and
  // bails to a full parse when the seam is genuinely ambiguous.
  const seamMergeVerdict = stripResult.remnantMerged ?? tailLeadingTextIsHoist(tailMdastChildren, strippedTailHast);
  if (seamMergeVerdict === null) return null;
  const seamMergeAllowed = seamMergeVerdict;
  let firstTailChild = true;
  for (const child of strippedTailHast) {
    const tailEnd = hastChildren[hastChildren.length - 1];
    if (firstTailChild && child.type === 'text' && child.position !== undefined) {
      // The tail LEADS with a positioned bare text — a raw literal whose
      // preceding construct vanished at the tokenizer (stray end tag's
      // trailing spaces, deep-soak counterexample). A full parse merges it
      // into the seam separator (or keeps it apart when the vanished thing
      // was sanitize-stripped) — classifying which means modeling the
      // tokenizer. Bail to a full parse.
      return null;
    }
    if (firstTailChild && tailEnd && tailEnd.type === 'text' && child.type === 'text' && child.position === undefined) {
      // A trailing html-block literal absorbs adjacent tail text the same
      // way (footer separator of an all-invisible tail — no wrap slot sat
      // between them at reparse time), and the merge drops the source
      // position, matching hast-util-raw's merged-text output.
      const literalSeam = tailEnd.value.trim() !== '' && !tailWrapVisible;
      if (seamMergeAllowed || literalSeam) {
        // Adjacent text at the seam — the full parse would have merged
        // these during rehype-raw's reparse. Replace (don't mutate) the
        // seam node: it may be a reference into the previous frame's tree.
        hastChildren[hastChildren.length - 1] = { type: 'text', value: tailEnd.value + child.value };
        firstTailChild = false;
        continue;
      }
    }
    firstTailChild = false;
    hastChildren.push(child);
  }

  // No POSITIONED top-level output → bail (fuzz + exhaustive-sweep
  // finding). hast-util-raw anchors the rebuilt root's position on its
  // positioned output nodes: a sanitize-stripped comment still anchored it
  // (positioned pre-sanitize), while a defs-only doc, a tokenizer-dropped
  // `<?…` opener, or a stray `</d>` end tag (dropped, leaving only a bare
  // position-less wrap separator behind) do not — and removeComments
  // shifts the comment case across that line. Reconstructing the verdict
  // for position-less-only output means re-modeling the parse5 tokenizer
  // per child; such frames are tiny by construction, so a full parse costs
  // nothing.
  if (!hastChildren.some((child) => child.position !== undefined)) return null;

  // Root positions must match a full parse: start of document to end of
  // document. The re-based tail MDAST root end IS the document end. The
  // tail HAST root's position is NOT source-based after rehype-raw's
  // reparse (hast-util-raw rewrites it in serialized-HTML coordinates), so
  // it cannot be re-based — but a full parse with POSITIONED output (the
  // other case bailed above) leaves the hast root position equal to the
  // mdast root position (arbiter-verified), so reuse that.
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
  // Wrap separators MERGED into pushed trailing literals (every trailing
  // '\n' on a literal is a merged separator — see the trailing-region
  // note). They count toward the NEXT gap's run length: without the
  // credit, separator runs after a literal UNDERCOUNT the stripped
  // children and the run-length rule mispairs position-less content
  // (seed-20260752: the KaTeX span paired with the stripped comment,
  // inflating the trailing gap count and duplicating the seam separator).
  let literalCredit = 0;

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
    if (sawContent && isTrailingLiteralText(node)) {
      // Raw trailing literal of the SAME html block (position-less,
      // non-whitespace — cannot be foster-parenting hoist, which is
      // whitespace-only). Serialized adjacent to its element output, so no
      // separator may intervene; the pairing cursor stays put.
      if (sepBuffer.length !== 0) return null;
      out.push(node);
      literalCredit += countTrailingNewlines(node.value);
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
      // Excess leading texts beyond the stripped-child slots can only be
      // hoist, and hoist exists as a SEPARATE node only when there is no
      // slot to merge into (nextIdx === 0, probe-verified). Any excess in
      // the presence of slots is out of model → bail (round-2 review
      // tightened this from `excess > 1`).
      const excess = sepBuffer.length - nextIdx;
      if (excess > (nextIdx === 0 ? 1 : 0)) return null;
    } else {
      // Run length = observed bare separators PLUS the ones merged into
      // trailing literals since the last pairing (literalCredit) — the gap
      // ground truth the stripped-children arithmetic needs.
      const stripped = sawContent ? sepBuffer.length + literalCredit - 1 : sepBuffer.length;
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
    literalCredit = 0; // merged separators consumed by this gap
    pairIdx = nextIdx;
    sawContent = true;
  }

  // Trailing region: every visible child after the last paired one must be
  // stripped. The observed run came from the PREVIOUS frame (its length
  // includes that frame's seam separator when its tail was wrap-visible),
  // so it is discarded and rebuilt for the current tail.
  const trailingStripped = visibles.length - (pairIdx + 1);
  const trailingGaps = sawContent ? trailingStripped : Math.max(0, visibles.length - 1);
  const seam = visibles.length > 0 && tailWrapVisible ? 1 : 0;

  // Trailing-literal seam merge: when the cut ends in an html block's raw
  // trailing literal, the full parse MERGES the wrap separator into that
  // text node (adjacent text at reparse time) instead of keeping a bare
  // '\n' — and the merge DROPS the text's source position (an unmerged
  // document-final literal keeps hast-util-raw's position; the same
  // literal followed by wrap-visible content comes out position-less,
  // fuzz-verified both ways). The literal's intrinsic value never ends
  // with '\n' (an html node's source ends at line content), so EVERY
  // trailing '\n' on the cut node is a previous frame's merged artifact —
  // seam separator, footer separator, or table hoist (which GROWS with the
  // streaming tail and must never be carried forward). Shed them all, then
  // re-merge (and re-drop the position) for the CURRENT tail's layout — the
  // join merges the tail's own leading text back in. Stripped children
  // after a trailing literal are out of model — bail to the full parse.
  const last = out[out.length - 1];
  if (last !== undefined && last.type === 'text' && last.value.trim() !== '') {
    if (trailingGaps > 0 || sepBuffer.length > 0) return null;
    const body = last.value.replace(/\n+$/, '');
    if (seam > 0) {
      out[out.length - 1] = { type: 'text', value: `${body}\n` };
    } else {
      // Document-final literal (nothing wrap-visible follows): hast-util-raw
      // keeps its SOURCE position — [previous element's end, owner html
      // node's end]. A literal that got merged in an earlier frame lost its
      // position, so reconstruct it from the neighbors; bail when they
      // don't carry the needed points. (If the current tail still appends a
      // footer, the join's literal-seam merge re-drops the position — the
      // same order a full parse resolves it in.)
      const prevEl = out.length >= 2 ? out[out.length - 2] : undefined;
      const owner = pairIdx >= 0 ? visibles[pairIdx] : undefined;
      const start = prevEl?.type === 'element' ? prevEl.position?.end : undefined;
      const end = owner?.position?.end;
      if (!start || !end) return null;
      out[out.length - 1] = { type: 'text', value: body, position: { start, end } };
    }
    return out;
  }

  // A trailing separator whose value is not a PLAIN '\n' carries a merged
  // raw remnant (a dropped construct's whitespace, a prior merged gap) —
  // rebuilding it as bare '\n' silently drops those bytes (deep-soak
  // counterexample: a stripped comment's preceding ' ' merged into ' \n').
  // Out of the plain-slot model — bail to a full parse.
  if (sepBuffer.some((s) => s.type !== 'text' || s.value !== '\n')) return null;
  // An interior literal whose merged separators were never consumed by a
  // later pairing (literal, bare separators, then nothing) — its credit
  // would have to offset the trailing-run arithmetic below, a shape the
  // trailing rebuild does not model. Bail to a full parse.
  if (literalCredit > 0) return null;
  // A frozen html child ENDING in a sanitize-stripped construct (`…-->`,
  // `…?>`, `…]]>`, declarations) leaves interior whitespace between its
  // last element and the stripped tail — whitespace the full parse MERGES
  // into the seam separator (`"\n\n"`, seed-20260850) while the plain-slot
  // rebuild below synthesizes a bare `'\n'`. The merged node never reaches
  // the cut (attribution excludes it), so the rebuild is blind to it —
  // bail to a full parse when the last paired child has such a tail.
  const lastPaired = pairIdx >= 0 ? visibles[pairIdx] : undefined;
  if (lastPaired && lastPaired.type === 'html') {
    const v = (lastPaired as { value: string }).value;
    const lastLt = v.lastIndexOf('<');
    if (lastLt !== -1 && /^<[!?]/.test(v.slice(lastLt))) return null;
  }
  if (sepBuffer.length !== trailingGaps && sepBuffer.length !== trailingGaps + 1) return null;
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
 * gapSep's value beyond its wrap '\n' is text the raw reparse MERGED into
 * the slot — rehype-raw hoist ahead of a table, or the orphan separator of
 * an opener the tokenizer dropped outright (an unterminated `<?`/`<!`, fuzz
 * counterexample) — retained as a leading text node.
 *
 * `remnantMerged` carries the seam verdict that merge PROVES: the injected
 * region occupies the same serialized-adjacency position inside the tail
 * parse that the frozen prefix occupies in a full parse, so "the tail's raw
 * pass merged the gap with what follows" ⇔ "a full parse merges the seam
 * separator there too". Null when no gap was consumed (no injection): the
 * caller falls back to the hoist heuristic.
 *
 * Returns null on any layout surprise (caller falls back to a full parse).
 */
function stripInjectedHast(
  tailMdast: MdastRoot,
  tailHast: HastRoot,
  injectedLen: number,
  tailWrapVisible: boolean
): { rest: HastContent[]; remnantMerged: boolean | null } | null {
  if (injectedLen === 0) return { rest: tailHast.children.slice(), remnantMerged: null };
  const injectedVisibleCount = tailMdast.children.filter((c) => {
    const start = c.position?.start?.offset;
    return start !== undefined && start < injectedLen && !isWrapInvisible(c);
  }).length;
  if (injectedVisibleCount === 0) return { rest: tailHast.children.slice(), remnantMerged: null };

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
  let remnantMerged: boolean | null = null;
  if (tailWrapVisible) {
    const gap = children[idx];
    if (!gap || !isSeparatorText(gap)) return null;
    remnant = (gap as { value: string }).value.slice(1);
    remnantMerged = remnant !== '';
    idx += 1;
  }
  const rest = children.slice(idx);
  if (remnant !== '') rest.unshift({ type: 'text', value: remnant });
  return { rest, remnantMerged };
}

/**
 * Decide whether the tail hast's LEADING position-less text may merge with
 * the seam separator. True only when it is rehype-raw hoist output sitting
 * directly against the seam in serialized HTML — i.e. the tail's first
 * wrap-visible mdast child SURVIVED sanitize (its output is the first tail
 * content node). If that child was stripped (leading comment), the leading
 * text is a gap SLOT the full parse keeps as a separate node.
 *
 * Three-valued (fuzz-arbiter finding — the old boolean version claimed
 * "false is provably right wherever evidence is ambiguous", and fuzz
 * disproved it): a tail whose first wrap-visible child VANISHES at raw time
 * (an unterminated `<?`/`<!` opener the tokenizer drops outright) leaves
 * the same post-sanitize shape as one stripped at sanitize time (a
 * complete comment), but the full parse MERGES the seam in the first case
 * and keeps it separate in the second. Positive classifications:
 * - `true`  — hoist: first content is positioned inside the first visible
 *   child (table foster-parenting), merge;
 * - `false` — the vanished/position-less output is positively attributable:
 *   math (KaTeX emits its own output, never dropped) or a COMPLETE
 *   comment/PI/decl/CDATA html child (a raw-time node existed; sanitize
 *   stripped it, so the slots stay separate);
 * - `null`  — cannot classify (unterminated raw constructs, mixed html
 *   values): caller falls back to a full parse for the frame.
 */
function tailLeadingTextIsHoist(tailMdastChildren: MdastContent[], tailHastChildren: HastContent[]): boolean | null {
  const firstText = tailHastChildren[0];
  if (!firstText || !isSeparatorText(firstText)) return false;
  const firstVisible = tailMdastChildren.find((c) => !isWrapInvisible(c));
  if (!firstVisible) return false;
  const firstContent = tailHastChildren.find((c) => !isSeparatorText(c));
  if (firstContent) {
    const start = firstContent.position?.start?.offset;
    const vStart = firstVisible.position?.start?.offset;
    const vEnd = firstVisible.position?.end?.offset;
    if (start !== undefined && vStart !== undefined && vEnd !== undefined) {
      if (start >= vStart && start < vEnd) return true; // hoist
      // First visible's output vanished; classify by the child itself below.
    }
  }
  if (firstVisible.type === 'math') return false; // KaTeX output, never dropped
  if (firstVisible.type === 'html' && isCompleteRawConstruct(firstVisible.value)) return false;
  return null;
}

/** Single complete comment / PI / declaration / CDATA — raw-time node
 *  guaranteed (sanitize strips it later, so its separator slots stay
 *  separate). Anything unterminated or mixed → not classifiable here. */
function isCompleteRawConstruct(value: string): boolean {
  const v = value.trim();
  return (
    (v.startsWith('<!--') && v.endsWith('-->')) ||
    (v.startsWith('<?') && v.endsWith('?>')) ||
    (v.startsWith('<![CDATA[') && v.endsWith(']]>')) ||
    (/^<![A-Za-z]/.test(v) && v.endsWith('>'))
  );
}

/** Position-less whitespace-only root text — wrap()/rehype-raw separator runs. */
function isSeparatorText(node: HastContent): boolean {
  return node.type === 'text' && node.position === undefined && node.value.trim() === '';
}

/** Position-less NON-whitespace text at the top level — the raw reparse's
 *  literal trailing output of an html block (an unblanked text line after
 *  the block's closing tag). Distinct from separators and foster-parenting
 *  hoist, which are whitespace-only. */
function isTrailingLiteralText(node: HastContent): node is HastContent & { type: 'text'; value: string } {
  return node.type === 'text' && node.position === undefined && node.value.trim() !== '';
}

/** Trailing '\n' run length on a literal's value — its merged separators. */
function countTrailingNewlines(value: string): number {
  let n = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === '\n'; i--) n += 1;
  return n;
}

/** Newlines in `text` before `end` (defaults to the whole string) — the
 *  bound avoids allocating prefix slices on the per-frame hot path. */
function countNewlines(text: string, end = text.length): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) count += 1;
  return count;
}
