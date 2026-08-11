/**
 * Block-level memoization for streaming markdown.
 *
 * A single unified parse produces both an mdast (for syntax-level ctx like
 * footnote / link / image references) and a hast (the actual render input).
 * `buildBlocks` cuts the hast into per-block units 1:1 with hast top-level
 * children that have an mdast counterpart, plus an optional synthetic
 * footnote section. `renderBlocksWithCache` then memoizes each block by
 * `(raw, occurrence index, ctx, position triple[, hastDigest])` so cached
 * blocks skip the downstream `toJsxRuntime` + React reconcile work. The
 * `hastDigest` component exists only for raw-HTML blocks — see
 * {@link BlockInfo.hastDigest} for the rehype-raw swallow problem it solves.
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
import { isFootnoteSection, normalizeId } from '@ai-react-markdown/engine';
import type { Registry } from '@ai-react-markdown/engine';

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
export interface PostOptions extends Readonly<Options> {
  /** Required for cross-chunk coordination. Provided by AIMarkdownContent
   *  when wrapped in <AIMarkdownDocuments>; undefined in standalone mode. */
  registry?: Registry;
  /** Required when registry is set. Per-chunk Symbol; used by fingerprint
   *  to encode canonical-vs-this comparison. */
  thisChunkSymbol?: symbol;
  /** Required when registry is set. From the document context; entered
   *  into fingerprint so id/href prefix changes invalidate the cache. */
  clobberPrefix?: string;
}

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
  /**
   * Structural digest of the block's hast subtree, computed ONLY for blocks
   * that originate from raw HTML (mdast `html` nodes, or blocks resolved via
   * the range-containment fallback). Undefined for markdown-native blocks.
   *
   * Why it exists: rehype-raw applies the HTML parsing algorithm, so an
   * UNCLOSED container tag (`<details>` mid-stream, before its `</details>`
   * arrives) swallows every FOLLOWING top-level sibling into itself —
   * including the synthetic `<section data-footnotes>`. The block's mdast
   * identity (raw, position, ctx) is byte-identical across all those frames,
   * so without this digest the first swallowed snapshot would be a permanent
   * cache hit: content rendered inside the container freezes, and when the
   * close tag finally arrives the real nodes re-render at top level while the
   * stale copies stay trapped in the cached container (the "duplicate
   * footnote section inside <details>" bug).
   *
   * Digest composition — `maxEnd:descendantCount:hasFootnoteSection`:
   * - max end offset over the subtree catches swallowed POSITIONED siblings
   *   (their offsets lie beyond the mdast node's own range);
   * - descendant count catches position-less synthetic content moving in or
   *   out (the footnote section's own element carries no position, and its
   *   li contents point BACK at the definitions' offsets, which can be
   *   smaller than the container's end — maxEnd alone misses that case);
   * - the explicit dataFootnotes bit closes the degenerate corner where a
   *   swallowed section and later real children tie on both numbers.
   *
   * Markdown-native blocks (paragraph/list/math/code/…) never receive
   * reparented content — every hast descendant derives from their own mdast
   * source range — so they skip the subtree walk entirely. This keeps the
   * per-frame cost away from huge deterministic subtrees like KaTeX output.
   */
  hastDigest?: string;
  /** TAINT-block 专属：按节点类型分桶的 label set。Normalized 形态（uppercase）。
   *  Undefined when hasReference === false. */
  taintLabels?: {
    footnoteRefLabels: string[];
    linkRefLabels: string[];
    imageRefLabels: string[];
    footnoteDefLabels: string[];
  };
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
  /** Mirrors {@link BlockInfo.hastDigest} — must match for raw-HTML blocks
   *  (undefined === undefined for markdown-native blocks). */
  hastDigest?: string;
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

// isFootnoteSection lives in the engine now (boundary action ①): the
// incremental-parse engine's attributeHastChildren needs it too, and
// engine→core imports are forbidden. Re-exported so this module's export
// surface (and its tests) stay unchanged.
export { isFootnoteSection };

/** Dev invariant: every block hast child must retain its mdast `position`. */
export function hasMdastSource(node: HastElement): boolean {
  return node.position !== undefined;
}

/**
 * Compute {@link BlockInfo.hastDigest} for a raw-HTML block: iterative walk
 * over the hast subtree collecting (max end offset, descendant count,
 * contains-footnote-section). See the field's JSDoc for why each component
 * is load-bearing. Exported for tests.
 */
export function computeHtmlBlockDigest(el: HastElement): string {
  let maxEnd = el.position?.end?.offset ?? 0;
  let count = 0;
  let hasFootnoteSection = false;
  const stack: HastElement['children'][number][] = [...el.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    const end = node.position?.end?.offset;
    if (end !== undefined && end > maxEnd) {
      maxEnd = end;
    }
    if (node.type === 'element') {
      if (isFootnoteSection(node)) {
        hasFootnoteSection = true;
      }
      for (const child of node.children) {
        stack.push(child);
      }
    }
  }
  return `${maxEnd}:${count}:${hasFootnoteSection ? 1 : 0}`;
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
  // Sorted [start, end, node] table for the range-containment fallback used
  // when a hast block's offset is INSIDE an mdast node's source range
  // (`rehype-raw` splitting one mdast `html` node into multiple hast
  // siblings is the canonical case). Pre-sorted because mdast children come
  // out of remark-parse in source order; we collect positioned ones in
  // place, preserving order. Binary search at lookup time replaces the
  // previous O(N) `findLast` — without it, M hast blocks × N mdast children
  // degrades to O(N×M) on pathological streams with many splits.
  type Range = { start: number; end: number; node: MdastContent };
  const mdastRanges: Range[] = [];
  for (const child of mdast.children) {
    const off = child.position?.start.offset;
    const endOff = child.position?.end.offset;
    if (off !== undefined) {
      mdastByOffset.set(off, child);
    }
    if (off !== undefined && endOff !== undefined) {
      mdastRanges.push({ start: off, end: endOff, node: child });
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    for (let i = 1; i < mdastRanges.length; i++) {
      if (mdastRanges[i].start < mdastRanges[i - 1].start) {
        // Should never trip: mdast.children is source-order. If it does
        // trip, the binary search below is wrong — surface it loudly so
        // we sort defensively rather than silently misroute hast blocks.
        throw new Error(
          'block-memo: mdast.children not sorted by source offset — ' +
            'a remark plugin is reordering top-level children.'
        );
      }
    }
  }
  function findContainingMdast(offset: number): MdastContent | undefined {
    // Upper-bound binary search: find first index where range.start > offset.
    // The candidate is the immediate predecessor (largest start <= offset).
    let lo = 0;
    let hi = mdastRanges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (mdastRanges[mid].start <= offset) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo - 1;
    if (idx < 0) return undefined;
    const r = mdastRanges[idx];
    // Top-level mdast children have non-overlapping source ranges, so the
    // single largest-start candidate is the unique container (if any).
    return offset < r.end ? r.node : undefined;
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
    let viaRangeFallback = false;

    if (!mdastNode) {
      mdastNode = findContainingMdast(hastOffset);
      viaRangeFallback = mdastNode !== undefined;
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
    const footnoteRefLabels: string[] = [];
    const linkRefLabels: string[] = [];
    const imageRefLabels: string[] = [];
    const footnoteDefLabels: string[] = [];
    visit(mdastNode, (n) => {
      if (!TAINT_TYPES.has(n.type)) return;
      hasReference = true;
      const id = 'identifier' in n ? normalizeId(String(n.identifier)) : null;
      if (id === null) return;
      if (n.type === 'footnoteReference') footnoteRefLabels.push(id);
      else if (n.type === 'linkReference') linkRefLabels.push(id);
      else if (n.type === 'imageReference') imageRefLabels.push(id);
      else if (n.type === 'footnoteDefinition') footnoteDefLabels.push(id);
      // 'definition' nodes don't carry per-block fingerprint significance
      // (they're metadata, not visible); intentionally not bucketed.
    });

    const mdastPos = mdastNode.position;
    if (!mdastPos || mdastPos.start.offset === undefined || mdastPos.end.offset === undefined) {
      continue;
    }

    // Raw-HTML blocks are the only ones rehype-raw can reparent following
    // siblings into (unclosed container tags mid-stream). Two origins:
    // a top-level mdast `html` node, or a block resolved via the
    // range-containment fallback (raw HTML embedded in another node, split
    // into extra hast siblings). Digest their subtree so the cache
    // invalidates when the swallowed extent changes; markdown-native blocks
    // skip the walk (their subtrees derive purely from their own source
    // range, already covered by `raw` + position).
    const hastDigest = mdastNode.type === 'html' || viaRangeFallback ? computeHtmlBlockDigest(el) : undefined;

    const info: BlockInfo = {
      raw: extractRaw(mdastNode, source),
      startOffset: mdastPos.start.offset,
      endOffset: mdastPos.end.offset,
      startLine: mdastPos.start.line,
      startColumn: mdastPos.start.column,
      hasReference,
      ...(hastDigest !== undefined ? { hastDigest } : {}),
      ...(hasReference
        ? {
            taintLabels: { footnoteRefLabels, linkRefLabels, imageRefLabels, footnoteDefLabels },
          }
        : {}),
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
 * Compute a per-block cache fingerprint from the registry slice this block
 * actually depends on (footnote/link/image refs and footnote defs). Two blocks
 * with the same fingerprint render byte-equal output; if any encoded value
 * differs, the block must re-render.
 *
 * Encoding format (deterministic, stable across versions):
 *   `<clobberPrefix>|fn:<L>=<globalNumber>|lr:<L>=<url>|<title>|ir:<L>=<url>|fd:<L>=<canonical>/<refCount>`
 *
 * @param taintLabels - Per-block label dependency footprint (from BlockInfo.taintLabels).
 * @param registry    - Shared cross-chunk registry.
 * @param thisChunkSym- The Symbol of the chunk this rendering belongs to (for canonical-vs-this comparison).
 * @param clobberPrefix - The documentId-derived id prefix; included so href/id changes invalidate.
 */
export function computeBlockFingerprint(
  taintLabels: NonNullable<BlockInfo['taintLabels']>,
  registry: Registry,
  thisChunkSym: symbol,
  clobberPrefix: string
): string {
  const parts: string[] = [clobberPrefix];
  for (const label of taintLabels.footnoteRefLabels) {
    parts.push(`fn:${label}=${registry.globalNumber(label) ?? 'null'}`);
  }
  for (const label of taintLabels.linkRefLabels) {
    const def = registry.resolveLinkDef(label);
    parts.push(`lr:${label}=${def?.url ?? 'null'}|${def?.title ?? ''}`);
  }
  for (const label of taintLabels.imageRefLabels) {
    const def = registry.resolveLinkDef(label);
    parts.push(`ir:${label}=${def?.url ?? 'null'}|${def?.title ?? ''}`);
  }
  for (const label of taintLabels.footnoteDefLabels) {
    const isCanonical = registry.canonicalFootnoteFor(label) === thisChunkSym ? 1 : 0;
    parts.push(`fd:${label}=${isCanonical}/${registry.getRefsForLabel(label)}`);
  }
  return parts.join('|');
}

/**
 * Render the document plan with cache lookup + atomic Cache replacement.
 *
 * Cache identity for a `block` item is `(raw, occurrence index within bucket,
 * ctx, position triple, hastDigest)`. ctx == globalCtx for tainted blocks, ''
 * otherwise (sentinel collapses both paths into one validation). hastDigest
 * is undefined for markdown-native blocks (undefined === undefined passes)
 * and a subtree digest for raw-HTML blocks, so containers that swallowed
 * following siblings mid-stream re-render when the swallowed extent changes.
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
      // Cross-chunk coordination: in coordinated mode (registry AND this chunk's
      // Symbol registered) the per-chunk local `<section data-footnotes>` is
      // replaced by `<AggregateFootnotesIfLast>` mounted at the end of each
      // document's last chunk. Skip the local synthetic to avoid duplicate
      // footers across chunks.
      //
      // The thisChunkSymbol guard preserves SSR semantics: during
      // `renderToStaticMarkup` useEffect doesn't fire, so the chunk hasn't
      // registered with the registry yet (`thisChunkSymbol` undefined). Falling
      // back to the local footer keeps each chunk's defs visible in the static
      // output — which is what `byteEquivalence.test.tsx` exercises and what
      // users doing SSR-without-hydration expect.
      if (postOptions.registry && postOptions.thisChunkSymbol) {
        continue;
      }
      // Standalone mode (or SSR pre-registration): cache the local section by
      // globalCtx and render it.
      const cached = prev.footnoteSection;
      let node: ReactNode;
      if (cached && cached.ctx === globalCtx) {
        node = cached.node;
      } else {
        node = renderHastSubtree(item.el, postOptions);
      }
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

    if (block.hasReference) {
      const useFingerprint =
        postOptions.registry &&
        block.taintLabels &&
        postOptions.thisChunkSymbol &&
        postOptions.clobberPrefix !== undefined;
      const blockCtx = useFingerprint
        ? computeBlockFingerprint(
            block.taintLabels!,
            postOptions.registry!,
            postOptions.thisChunkSymbol!,
            postOptions.clobberPrefix!
          )
        : globalCtx; // fallback: standalone mode pre-v6 behavior

      const entry = prev.blocks.get(block.raw)?.[occ];
      const valid =
        entry !== undefined &&
        entry.ctx === blockCtx &&
        entry.startOffset === block.startOffset &&
        entry.startLine === block.startLine &&
        entry.startColumn === block.startColumn &&
        entry.hastDigest === block.hastDigest;

      let node: ReactNode;
      if (valid) {
        node = entry.node; // cache hit: skip everything
      } else {
        // Coordinated-mode hast post-transforms used to run here, but the
        // aggregate footer (AggregateFootnotesIfLast) now reconstructs the
        // footnote section from registry state, and the synthetic plan item
        // for `<section data-footnotes>` is skipped earlier in this loop.
        // Regular blocks never contain a top-level footnote section, so a
        // post-transform pass would be a no-op anyway.
        node = renderHastSubtree(item.el, postOptions);
      }

      bucket.push({
        node,
        ctx: blockCtx,
        startOffset: block.startOffset,
        startLine: block.startLine,
        startColumn: block.startColumn,
        hastDigest: block.hastDigest,
      });
      rendered.push({ node, reactKey: item.reactKey });
      continue;
    }

    // Non-TAINT block: existing cache-by-(raw, occurrence, '', position) path
    {
      const entry = prev.blocks.get(block.raw)?.[occ];
      const valid =
        entry !== undefined &&
        entry.ctx === '' &&
        entry.startOffset === block.startOffset &&
        entry.startLine === block.startLine &&
        entry.startColumn === block.startColumn &&
        entry.hastDigest === block.hastDigest;
      const node = valid ? entry.node : renderHastSubtree(item.el, postOptions);
      bucket.push({
        node,
        ctx: '',
        startOffset: block.startOffset,
        startLine: block.startLine,
        startColumn: block.startColumn,
        hastDigest: block.hastDigest,
      });
      rendered.push({ node, reactKey: item.reactKey });
    }
  }

  cacheRef.current = next;
  return rendered;
}
