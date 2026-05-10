/**
 * Block-level memoization for streaming markdown.
 *
 * A single unified parse produces both an mdast (for syntax-level ctx like
 * footnote / link / image references) and a hast (the actual render input).
 * `buildBlocks` cuts the hast into per-block units 1:1 with hast top-level
 * children that have an mdast counterpart, plus an optional synthetic
 * footnote section. `renderBlocksWithCache` then memoizes each block by
 * `(raw, occurrence index, ctx, startOffset)` so cached blocks skip the
 * downstream `toJsxRuntime` + React reconcile work.
 *
 * Design contract is in `/tmp/phase5-block-memo-decisions.md`. Read it before
 * touching any of the invariants in this file.
 *
 * @module components/blockMemo
 */

import type { Element as HastElement, Root as HastRoot, RootContent as HastChild } from 'hast';
import type { Root as MdastRoot, RootContent as MdastContent, Nodes as MdastNodes } from 'mdast';
import type { ReactNode } from 'react';
import { visit } from 'unist-util-visit';
import { renderHastSubtree, type Options } from './markdown';

/**
 * mdast types whose presence in a block makes that block dependent on
 * cross-block syntax (footnote/link/image references and definitions).
 * Tainted blocks invalidate via the document `globalCtx` digest; non-tainted
 * blocks invalidate only on raw + position change.
 */
const TAINT_TYPES: ReadonlySet<string> = new Set([
  'footnoteReference',
  'footnoteDefinition',
  'linkReference',
  'imageReference',
  'definition',
]);

/**
 * mdast types that contribute to the document-wide `globalCtx` digest.
 * Currently identical to {@link TAINT_TYPES} — refs/defs are simultaneously
 * "things that make a block tainted" and "things that change a tainted
 * block's render output". Kept as a separate constant so the two roles can
 * diverge later (e.g. a future plugin that introduces a new node type which
 * is a ctx contributor but not a per-block taint source).
 */
const CTX_TYPES: ReadonlySet<string> = TAINT_TYPES;

/**
 * Subset of {@link Options} consumed by per-block rendering — i.e. everything
 * except the pipeline plugins (those have already run by the time we reach
 * `renderHastSubtree`). Marked Readonly to discourage callers from mutating
 * the captured options reference between frames.
 */
export type PostOptions = Readonly<Options>;

/** Source-level identity of one renderable hast block. */
export interface BlockInfo {
  raw: string;
  startOffset: number;
  endOffset: number;
  /**
   * Line and column at the block's start. Tracked alongside `startOffset`
   * because two different source documents can produce the same byte offset
   * for the "same" content (`A\n\nB\n\nTarget` vs `ABCD\n\nTarget` — both
   * have `Target` starting at offset 6 but on different lines). Custom
   * components that read `node.position.start.line` would otherwise see
   * stale data from a false-positive cache hit.
   */
  startLine: number;
  startColumn: number;
  /** True if the block contains any TAINT_TYPES node — invalidate on globalCtx change. */
  hasReference: boolean;
}

/** Cache entry for one rendered block. */
export interface BlockCacheEntry {
  node: ReactNode;
  /** `globalCtx` digest if the block is tainted, '' otherwise. Sentinel collapses both code paths. */
  ctx: string;
  /** Position triple — must all match for the cached node to be valid. */
  startOffset: number;
  startLine: number;
  startColumn: number;
}

/** Cache entry for the synthesized footnote section (single slot, keyed by globalCtx). */
export interface FootnoteSectionEntry {
  ctx: string;
  node: ReactNode;
}

/**
 * Per-instance memo state.
 *
 * ## Memory characteristics
 *
 * The cache holds one `ReactNode` reference per live block in the current
 * document plus an optional single slot for the synthesized footnote
 * section. Memory therefore scales linearly with document size, NOT with
 * session duration: every frame's render produces a fresh `next` Cache, and
 * the previous frame's Cache is atomically replaced (orphaned for GC).
 * Blocks that disappear between frames are dropped from the cache the same
 * frame they vanish from the document.
 *
 * For typical AI chat (≤ 1000 blocks per response, individual ReactNode
 * trees in the low-KB range), per-instance memory stays comfortably below
 * ~10 MB. If you build a UI that keeps very long single-document instances
 * alive indefinitely (≥ 10k live blocks), consider mounting on a virtual
 * scroll boundary so blocks above the fold can unmount and release their
 * cached subtrees.
 */
export interface Cache {
  /** raw → bucket of entries indexed by occurrence within the document. */
  blocks: Map<string, BlockCacheEntry[]>;
  /** Synthesized footnote section, if the previous frame produced one. */
  footnoteSection?: FootnoteSectionEntry;
}

/** Build a fresh, empty Cache. */
export function createCache(): Cache {
  return { blocks: new Map() };
}

/**
 * Slice the source string for the given mdast node's position. mdast nodes
 * produced by remark-parse always carry `position`; the empty-string fallback
 * is purely defensive.
 */
function extractRaw(node: MdastNodes, source: string): string {
  if (!node.position) return '';
  return source.slice(node.position.start.offset, node.position.end.offset);
}

/**
 * Detect mdast-util-to-hast's synthesized footnote `<section data-footnotes>`.
 * Position-based detection alone would be too broad — any future rehype plugin
 * that appends a position-less node would be misclassified. We assert by
 * `tagName === 'section'` AND presence of the `dataFootnotes` property.
 */
export function isFootnoteSection(node: HastElement): boolean {
  if (node.tagName !== 'section') return false;
  const props = node.properties as Record<string, unknown> | undefined;
  return props?.dataFootnotes !== undefined;
}

/** Dev invariant: every block hast child must retain its mdast `position`. */
export function hasMdastSource(node: HastElement): boolean {
  return node.position !== undefined;
}

/**
 * One step of the document render plan, in source order.
 *
 * The plan covers EVERY top-level hast child so that {@link renderBlocksWithCache}
 * can preserve react-markdown's byte-equivalent output — including the whitespace
 * `text` nodes that `mdast-util-to-hast` inserts between block elements.
 *
 * - `block`: a hast element with an mdast counterpart, eligible for caching by
 *   `(raw, occurrence index, ctx, startOffset)`.
 * - `inline`: a non-element top-level child (whitespace text, comment, …) or
 *   an element that has no mdast counterpart but is still safe to render.
 *   These are rendered every frame without caching — they are typically
 *   single whitespace characters.
 * - `synthetic`: the synthesized footnote `<section data-footnotes>`, cached
 *   in a single slot keyed by `globalCtx`.
 */
export type RenderItem =
  | { kind: 'block'; el: HastElement; reactKey: string; info: BlockInfo }
  | { kind: 'inline'; el: HastChild; reactKey: string }
  | { kind: 'synthetic'; el: HastElement; reactKey: string };

/** Result of {@link buildBlocks}. */
export interface BuildBlocksResult {
  /** Render plan in document order — drives {@link renderBlocksWithCache}. */
  plan: RenderItem[];
  /** JSON-stringified ordered list of TAINT-typed nodes in document order. */
  globalCtx: string;
  // ── Derived views (kept for tests and convenience) ─────────────────────
  /** Flat list of `BlockInfo` for cacheable blocks, in document order. */
  blocks: BlockInfo[];
  /** 1:1 with `blocks` — the hast Element each BlockInfo refers to. */
  blockHasts: HastElement[];
  /** Synthesized footnote section, if present. */
  synthetic?: HastElement;
}

/** A single rendered output item with its stable React key. */
export interface RenderedItem {
  node: ReactNode;
  reactKey: string;
}

const FOOTNOTE_SECTION_KEY = '__footnote_section__';

/**
 * Build the document render plan + ctx digest from a parsed mdast and its
 * rendered hast.
 *
 * Plan construction is driven by `hast.children` (NOT `mdast.children`):
 * pipeline transformers like `remarkSqueezeParagraphs` and
 * `remarkRemoveComments` drop blocks, so the rendered hast may have fewer
 * top-level children than the parsed mdast. Driving by hast guarantees the
 * plan covers exactly what will be rendered.
 *
 * Each hast top-level child becomes one plan item:
 * - `<section data-footnotes>` → `synthetic` (cached in a single slot)
 * - element with mdast counterpart → `block` (cacheable by raw + occurrence + ctx + offset)
 * - text / comment / element-without-counterpart → `inline` (rendered fresh every frame)
 *
 * The mdast counterpart of a block element is found by source offset using
 * a two-tier lookup: an exact-offset Map (mdast-util-to-hast's default 1:1
 * propagation), then range-containment `findLast` fallback for cases like
 * `rehype-raw` splitting one mdast `html` node into multiple hast siblings
 * (e.g. `   <div>Hi</div>` — leading spaces shift the `<div>` offset
 * inside the parent html node's source range).
 *
 * In dev, a hast block whose offset matches no mdast counterpart at all
 * throws — that means a rehype plugin synthesized positions outside the
 * source range, which is a bug worth surfacing. In production it falls
 * through to an `inline` plan item so user content is never silently lost.
 *
 * `globalCtx` walks the full mdast for footnote/link/image refs and
 * definitions in document order (no dedupe — order matters for footnote
 * numbering), then JSON-stringifies the collected tuples. That string is the
 * invalidation key for tainted blocks and the synthetic footnote section.
 */
export function buildBlocks(mdast: MdastRoot, hast: HastRoot, source: string): BuildBlocksResult {
  const mdastByOffset = new Map<number, MdastContent>();
  for (const child of mdast.children) {
    const off = child.position?.start.offset;
    if (off !== undefined) {
      mdastByOffset.set(off, child);
    }
  }

  const ctxParts: unknown[] = [];
  visit(mdast, (n) => {
    if (!CTX_TYPES.has(n.type)) return;
    if (n.type === 'footnoteReference') ctxParts.push(['fr', n.identifier]);
    else if (n.type === 'footnoteDefinition') ctxParts.push(['fd', n.identifier, extractRaw(n, source)]);
    else if (n.type === 'linkReference') ctxParts.push(['lr', n.identifier]);
    else if (n.type === 'imageReference') ctxParts.push(['ir', n.identifier]);
    else if (n.type === 'definition') ctxParts.push(['d', n.identifier, n.url, n.title ?? null]);
  });
  const globalCtx = JSON.stringify(ctxParts);

  const plan: RenderItem[] = [];
  const blocks: BlockInfo[] = [];
  const blockHasts: HastElement[] = [];
  let synthetic: HastElement | undefined;

  for (let i = 0; i < hast.children.length; i++) {
    const hastChild = hast.children[i];

    if (hastChild.type !== 'element') {
      // Top-level non-element child (whitespace text inserted by
      // mdast-util-to-hast between block elements, sanitized comment, …).
      // Render inline without caching to preserve byte-equivalent output.
      const off = hastChild.position?.start.offset;
      const reactKey = off !== undefined ? `inline-${off}` : `inline-i${i}`;
      plan.push({ kind: 'inline', el: hastChild, reactKey });
      continue;
    }

    const el = hastChild;

    if (isFootnoteSection(el)) {
      synthetic = el;
      plan.push({ kind: 'synthetic', el, reactKey: FOOTNOTE_SECTION_KEY });
      continue;
    }
    const hastOffset = el.position?.start.offset;
    if (hastOffset === undefined) {
      // Element without position (synthesized by some plugin) — preserve in
      // document order, rendered as inline (no cache key available).
      plan.push({ kind: 'inline', el, reactKey: `inline-i${i}` });
      continue;
    }

    let mdastNode = mdastByOffset.get(hastOffset);

    if (!mdastNode) {
      mdastNode = mdast.children.findLast((child) => {
        const startOff = child.position?.start.offset;
        const endOff = child.position?.end.offset;
        return startOff !== undefined && endOff !== undefined && startOff <= hastOffset && hastOffset < endOff;
      });
    }

    if (!mdastNode) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          `block-memo: hast block at offset ${hastOffset} has no mdast counterpart. ` +
            `A rehype plugin may have synthesized positions outside source. tagName=${el.tagName}`
        );
      }
      // Production fallback: render inline, no cache.
      plan.push({ kind: 'inline', el, reactKey: `inline-${hastOffset}` });
      continue;
    }

    if (mdastNode.type === 'footnoteDefinition') {
      // Footnote definitions are hoisted into the synthetic section by
      // mdast-util-to-hast — they should not appear as top-level hast blocks
      // in any current plugin chain. If the range fallback ever resolves an
      // unrelated hast block to a footnoteDefinition's mdast source range,
      // preserve it as `inline` rather than silently dropping it (defensive
      // parity with the other no-counterpart fallbacks above).
      plan.push({ kind: 'inline', el, reactKey: `inline-${hastOffset}` });
      continue;
    }

    let hasReference = false;
    visit(mdastNode, (n) => {
      if (TAINT_TYPES.has(n.type)) {
        hasReference = true;
        return false;
      }
      return undefined;
    });

    const mdastPos = mdastNode.position;
    if (!mdastPos || mdastPos.start.offset === undefined || mdastPos.end.offset === undefined) {
      continue;
    }

    const info: BlockInfo = {
      raw: extractRaw(mdastNode, source),
      startOffset: mdastPos.start.offset,
      endOffset: mdastPos.end.offset,
      startLine: mdastPos.start.line,
      startColumn: mdastPos.start.column,
      hasReference,
    };
    blocks.push(info);
    blockHasts.push(el);
    // React key is keyed off the HAST element's source offset (not the mdast
    // node's), because multi-root raw HTML produces multiple hast siblings
    // that share one mdast `html` node — same `mdastPos.start.offset` for
    // both, which would collide as a React key. Hast positions are unique
    // per element in the rendered tree.
    plan.push({ kind: 'block', el, info, reactKey: `block-${hastOffset}` });
  }

  return { plan, globalCtx, blocks, blockHasts, synthetic };
}

/**
 * Render the document plan with cache lookup + atomic Cache replacement.
 *
 * Cache identity for a `block` item is `(raw, occurrence index within bucket,
 * ctx, startOffset)`. ctx == globalCtx for tainted blocks, '' otherwise
 * (sentinel collapses both paths into one validation).
 *
 * The synthesized footnote section is a single-slot cache keyed by globalCtx.
 * Atomic Cache replacement (`cacheRef.current = next`) ensures stale slots
 * cannot leak across frames: when synthetic disappears in frame T2,
 * `next.footnoteSection` is left undefined and the old node is orphaned with
 * the rest of the previous Cache for GC.
 *
 * `inline` items (top-level whitespace text, sanitized comments, etc.) are
 * rendered every frame without caching — they are typically a single
 * character and would not benefit from memoization.
 */
export function renderBlocksWithCache(
  cacheRef: { current: Cache },
  plan: RenderItem[],
  globalCtx: string,
  postOptions: PostOptions
): RenderedItem[] {
  const prev = cacheRef.current;
  const next: Cache = { blocks: new Map() };
  const rendered: RenderedItem[] = [];

  if (process.env.NODE_ENV !== 'production') {
    for (const item of plan) {
      if (item.kind === 'block' && !hasMdastSource(item.el)) {
        throw new Error(
          'block-memo: block hast child has no position. Did a rehype plugin strip it? ' +
            '(Run positionPropagation.test.ts to verify.)'
        );
      }
    }
  }

  for (const item of plan) {
    if (item.kind === 'inline') {
      rendered.push({
        node: renderHastSubtree(item.el, postOptions),
        reactKey: item.reactKey,
      });
      continue;
    }

    if (item.kind === 'synthetic') {
      const cached = prev.footnoteSection;
      const node = cached && cached.ctx === globalCtx ? cached.node : renderHastSubtree(item.el, postOptions);
      next.footnoteSection = { ctx: globalCtx, node };
      rendered.push({ node, reactKey: item.reactKey });
      continue;
    }

    // kind === 'block'
    const block = item.info;
    let bucket = next.blocks.get(block.raw);
    if (!bucket) {
      bucket = [];
      next.blocks.set(block.raw, bucket);
    }
    const occ = bucket.length;

    const blockCtx = block.hasReference ? globalCtx : '';
    const entry = prev.blocks.get(block.raw)?.[occ];
    const valid =
      entry !== undefined &&
      entry.ctx === blockCtx &&
      entry.startOffset === block.startOffset &&
      entry.startLine === block.startLine &&
      entry.startColumn === block.startColumn;
    const node = valid ? entry.node : renderHastSubtree(item.el, postOptions);

    bucket.push({
      node,
      ctx: blockCtx,
      startOffset: block.startOffset,
      startLine: block.startLine,
      startColumn: block.startColumn,
    });
    rendered.push({ node, reactKey: item.reactKey });
  }

  cacheRef.current = next;
  return rendered;
}
