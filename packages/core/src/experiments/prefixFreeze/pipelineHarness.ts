/**
 * EXPERIMENT — streaming simulator + prefix-stability falsification checker
 * for the freeze-boundary detector. See detectFreezeBoundaries.ts for the
 * tier definitions and README.md for how to read the results.
 *
 * The safety argument is empirical, not analytical: for every simulated
 * streaming frame we run the REAL production plugin stack (the same
 * always-on chain `MarkdownContent.tsx` assembles — mirrored here the same
 * way `positionPropagation.test.ts` pins it) and then assert that every
 * top-level hast node that STARTS before the claimed boundary is
 * deep-equal to the node at the same start offset in the final frame.
 *
 * "Starts before the boundary" (not "fits entirely before") is the correct
 * projection: freezing a boundary means every block that begins in the
 * prefix is final. A node that starts before the boundary but keeps
 * growing (a loose list absorbing later items, an unclosed `<details>`
 * swallowing later siblings à la the v1.5.1 bug) is exactly the failure
 * class the harness must catch — filtering by subtree end would silently
 * exclude the mutated node and mask the violation.
 *
 * Alignment is mdast-ANCHORED because hast positions alone are not enough:
 * rehype-katex replaces a math block with a position-less span (and other
 * plugins can do the same), so a position-filtered projection is blind to
 * exactly the node that mutates while `$$` is unclosed. Each top-level hast
 * child is attributed a source offset — its own `position.start` when
 * present, otherwise the start of the first top-level MDAST child at or
 * after the running cursor (mdast top-level children always carry
 * positions; this mirrors blockMemo's source-offset lookup). The synthetic
 * footnote section is never freeze-eligible (production handles it via a
 * dedicated FootnoteSectionEntry, not the block cache) and is attributed
 * Infinity. The first `m` children attributed before the boundary are then
 * compared INDEX-WISE against the final frame's first `m` children.
 *
 * Scope: single-instance streaming (docs/streaming-and-performance.md
 * "Approach A"), Stage-A preprocessors bypassed (raw markdown in), no
 * cross-chunk registry. Appending never shifts earlier offsets, so start
 * offsets are directly comparable across frames.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkSqueezeParagraphs from 'remark-squeeze-paragraphs';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeUnwrapImages from 'rehype-unwrap-images';
import isEqual from 'lodash-es/isEqual';
import type { Root } from 'hast';
import type { Root as MdastRoot } from 'mdast';

import rehypeRebaseHashLinks from '../../components/rehypeRebaseHashLinks';
import rehypeFooterAdorn from '../../components/rehypeFooterAdorn';
import { attributeHastChildren } from '../../components/incrementalParse';
import { sanitizeSchema } from '../../components/sanitizeSchema';
import { detectFreezeBoundaries, FREEZE_TIERS, type FreezeTier } from './detectFreezeBoundaries';

export interface PipelineResult {
  mdast: MdastRoot;
  hast: Root;
}

/** The EXACT default-on plugin stack from `MarkdownContent.tsx` (kept in
 *  sync the same way `positionPropagation.test.ts` does). */
export function runProductionPipeline(content: string): PipelineResult {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkBreaks)
    .use(remarkEmoji)
    .use(remarkSqueezeParagraphs)
    .use(remarkCjkFriendly)
    .use(remarkCjkFriendlyGfmStrikethrough)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      clobberPrefix: '',
    })
    .use(rehypeRaw, { passThrough: [] })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeFooterAdorn)
    .use(rehypeRebaseHashLinks)
    .use(rehypeKatex)
    .use(rehypeUnwrapImages);

  const mdast = processor.parse(content);
  // runSync mutates the mdast in place via remark transformers — same
  // sequencing as parseStage/transformStage in the vendored wrapper.
  const hast = processor.runSync(mdast, content);
  return { mdast, hast };
}

/**
 * Source-offset attribution for every top-level hast child. Now a thin
 * wrapper over the PRODUCTION implementation
 * (`components/incrementalParse/attributeHastChildren`) — the production
 * splice and this falsification harness must cut prefixes identically or
 * the experiment stops being evidence.
 */
export function attributeChildren(result: PipelineResult): number[] {
  return attributeHastChildren(result.mdast, result.hast);
}

export interface Violation {
  frameIndex: number;
  snapshotLength: number;
  boundary: number;
  childIndex: number;
  attributedStart: number;
  /** 'mutated' = child at same index differs from final; 'missing' = final has fewer children. */
  kind: 'mutated' | 'missing';
}

export interface TierReport {
  tier: FreezeTier;
  finalBoundary: number;
  /** Mean of boundary/length across frames (freeze coverage over time). */
  meanFreezeRatio: number;
  /** Frames where at least one frozen-prefix node fails the stability check. */
  violationFrames: number;
  firstViolation: Violation | null;
  monotonic: boolean;
}

export interface SimulationReport {
  name: string;
  frames: number;
  finalLength: number;
  tiers: Record<FreezeTier, TierReport>;
  /** Total ms spent running the production pipeline on every full snapshot. */
  fullPipelineMs: number;
  /** Total ms spent running the pipeline on the L4 tail only (cost proxy for an incremental design). */
  l4TailPipelineMs: number;
}

/**
 * Simulate append-only streaming of `payload` in `chunkSize` code points per
 * frame, running the production pipeline + detector at every frame, then
 * check every tier's frozen prefixes against the final frame.
 */
export function simulateStream(name: string, payload: string, chunkSize: number): SimulationReport {
  // Chunk by code points so a frame boundary never splits a surrogate pair.
  const codePoints = Array.from(payload);
  const snapshots: string[] = [];
  for (let i = chunkSize; i < codePoints.length; i += chunkSize) {
    snapshots.push(codePoints.slice(0, i).join(''));
  }
  snapshots.push(payload);

  interface FrameRec {
    length: number;
    boundaries: Record<FreezeTier, number>;
    hast: Root;
    /** Source-offset attribution per top-level hast child (see attributeChildren). */
    attrs: number[];
  }

  let fullPipelineMs = 0;
  let l4TailPipelineMs = 0;
  const frameRecs: FrameRec[] = snapshots.map((snapshot) => {
    const t0 = performance.now();
    const result = runProductionPipeline(snapshot);
    fullPipelineMs += performance.now() - t0;
    const boundaries = detectFreezeBoundaries(snapshot);
    const t1 = performance.now();
    runProductionPipeline(snapshot.slice(boundaries.L4));
    l4TailPipelineMs += performance.now() - t1;
    return { length: snapshot.length, boundaries, hast: result.hast, attrs: attributeChildren(result) };
  });

  const finalChildren = frameRecs[frameRecs.length - 1].hast.children;

  const tiers = {} as Record<FreezeTier, TierReport>;
  for (const tier of FREEZE_TIERS) {
    let ratioSum = 0;
    let violationFrames = 0;
    let firstViolation: Violation | null = null;
    let monotonic = true;
    let prevBoundary = 0;

    frameRecs.forEach((frame, frameIndex) => {
      const boundary = frame.boundaries[tier];
      if (boundary < prevBoundary) monotonic = false;
      prevBoundary = boundary;
      ratioSum += frame.length === 0 ? 0 : boundary / frame.length;
      if (boundary === 0) return;

      let frameViolated = false;
      for (let i = 0; i < frame.attrs.length && frame.attrs[i] < boundary; i++) {
        const finalChild = finalChildren[i];
        const kind: Violation['kind'] | null =
          finalChild === undefined ? 'missing' : isEqual(frame.hast.children[i], finalChild) ? null : 'mutated';
        if (kind !== null) {
          frameViolated = true;
          if (firstViolation === null) {
            firstViolation = {
              frameIndex,
              snapshotLength: frame.length,
              boundary,
              childIndex: i,
              attributedStart: frame.attrs[i],
              kind,
            };
          }
        }
      }
      if (frameViolated) violationFrames += 1;
    });

    tiers[tier] = {
      tier,
      finalBoundary: frameRecs[frameRecs.length - 1].boundaries[tier],
      meanFreezeRatio: ratioSum / frameRecs.length,
      violationFrames,
      firstViolation,
      monotonic,
    };
  }

  return {
    name,
    frames: frameRecs.length,
    finalLength: payload.length,
    tiers,
    fullPipelineMs,
    l4TailPipelineMs,
  };
}
