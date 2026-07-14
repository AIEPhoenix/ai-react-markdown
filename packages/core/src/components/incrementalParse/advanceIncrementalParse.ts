/**
 * React-free state machine for incremental (prefix-freeze) parsing.
 *
 * Given the previous frame's state and the current content, either splice
 * a frozen prefix with a tail-only parse or run the full pipeline. Every
 * gate failure degrades to the full path — the caller cannot observe a
 * difference except through `usedIncremental` and the dev-only stage
 * timings. The splice output is deep-equal to a full parse (the
 * splice-equivalence arbiter test enforces this; see spliceParse.ts).
 *
 * Gate order (first failure wins):
 *  - G0 depsKey identity — the parse inputs beyond `content` (plugin
 *    arrays, remark-rehype options, handlers, documentId, …) must be
 *    identical to the previous frame's. This intentionally covers MORE
 *    than the component's G3 12-dep flush (e.g. `preserveOrphanReferences`
 *    flips reach the handlers without touching any G3 field).
 *  - G1 append — `content.startsWith(prev.content)`; equal content returns
 *    the previous trees unchanged. Non-append rewrites (including Stage-A
 *    preprocessor rewrites near the stream end) land here.
 *  - G3 boundary — `b = min(computeFreezeBoundary(content), prev.stableBoundary)`
 *    must be > 0. The `min` with the PREVIOUS frame's boundary is
 *    load-bearing, not defensive: the freshly computed boundary proves
 *    stability of the CURRENT parse's prefix, but the splice reuses the
 *    PREVIOUS parse's nodes — e.g. a shortcut ref rendered literal last
 *    frame must not be frozen the moment its definition arrives and the
 *    fresh boundary jumps past it. `prev.stableBoundary` is exactly the
 *    "stable under all future appends" property for prev's nodes.
 *  - G4 straddle (defensive) — no prev top-level mdast child may cross the
 *    boundary; the detector's blockers should already prevent this.
 *
 * (v1's G2 footnote bypass is GONE. Footnotes splice via INJECTION REPLAY:
 * the prefix's footnote event sequence — defs and refs ×count, in document
 * order, collected from prev.mdast — is prepended to the tail source, so
 * the tail run's mdast-util-to-hast state (footnoteOrder / footnoteCounts /
 * footnoteById) is seeded exactly and its footer regenerates the WHOLE
 * document's section; the injected nodes are stripped from both trees and
 * the footer's positions are rewritten by the dual rule in spliceParse.
 * Prefix inline hast is naturally stable — numbering is first-reference
 * order, which appends cannot change for the prefix. The detector's
 * reference taint (footnote namespace) keeps unresolved `[^x]` out of the
 * frozen prefix, C0-probe + arbiter verified.)
 *
 * `nextState.stableBoundary` is written on BOTH paths from the same single
 * boundary computation.
 */

import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';

import { parseStage, transformStage, type Options as MarkdownOptions } from '../markdown';
import { computeFreezeBoundary, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { buildInjectionPrefix, collectPrefixInjection, spliceTrees } from './spliceParse';

export interface IncrementalParseState {
  content: string;
  /** Post-transform trees (transformStage mutates mdast in place; these are the settled shapes). */
  mdast: MdastRoot;
  hast: HastRoot;
  /** Scan boundary at the frame that produced these trees. */
  stableBoundary: number;
  /** Detector resume state: append frames re-lex only past the confirmed
   *  prefix instead of the whole document (E2). Single-consumer mutable —
   *  owned by this state lineage. */
  scanCheckpoint: FreezeScanCheckpoint | null;
  /** Identity tuple of every parse input beyond `content` (G0). */
  depsKey: readonly unknown[];
}

export type IncrementalStage = 'scan' | 'parse' | 'transform';

export interface AdvanceOptions {
  remarkPlugins: MarkdownOptions['remarkPlugins'];
  rehypePlugins: MarkdownOptions['rehypePlugins'];
  /** The FULLY-MERGED remark-rehype options (handlers, clobberPrefix, …) —
   *  exactly what the full path would pass to parseStage. */
  remarkRehypeOptions: MarkdownOptions['remarkRehypeOptions'];
  depsKey: readonly unknown[];
  /** Whether remark-definition-list is active (config extraSyntaxSupported). */
  defListEnabled: boolean;
  /** Optional stage-timing wrapper (the component passes measureStage). */
  measure?: <T>(stage: IncrementalStage, fn: () => T) => T;
}

export interface AdvanceResult {
  mdast: MdastRoot;
  hast: HastRoot;
  usedIncremental: boolean;
  /** The boundary the splice used (0 on the full path). */
  boundary: number;
  nextState: IncrementalParseState;
}

const identityMeasure = <T>(_stage: IncrementalStage, fn: () => T): T => fn();

function depsKeyEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function runPipeline(source: string, options: AdvanceOptions): { mdast: MdastRoot; hast: HastRoot } {
  const measure = options.measure ?? identityMeasure;
  const parsed = measure('parse', () =>
    parseStage({
      children: source,
      remarkPlugins: options.remarkPlugins,
      rehypePlugins: options.rehypePlugins,
      remarkRehypeOptions: options.remarkRehypeOptions,
    })
  );
  const hast = measure('transform', () => transformStage(parsed));
  return { mdast: parsed.mdast, hast };
}

export function advanceIncrementalParse(
  prev: IncrementalParseState | null,
  content: string,
  options: AdvanceOptions
): AdvanceResult {
  const measure = options.measure ?? identityMeasure;
  const sameDeps = prev !== null && depsKeyEqual(prev.depsKey, options.depsKey);

  // Zero-scan short-circuit — identical content reuses the whole previous
  // state verbatim (registry version bumps, unrelated re-renders).
  if (sameDeps && content === prev!.content) {
    return {
      mdast: prev!.mdast,
      hast: prev!.hast,
      usedIncremental: true,
      boundary: prev!.stableBoundary,
      nextState: prev!,
    };
  }
  const appendOnly = sameDeps && content.startsWith(prev!.content);

  // Every remaining frame scans ONCE (fence-aware). Full-path frames
  // consume the scan on the NEXT frame via `prev.stableBoundary`.
  // Append frames resume the detector from its confirmed-prefix checkpoint
  // instead of re-lexing the whole document (E2); everything else scans
  // fresh. The checkpoint is mutable and single-consumer — this state
  // lineage owns it.
  const scan = measure('scan', () =>
    computeFreezeBoundary(content, { defListEnabled: options.defListEnabled }, appendOnly ? prev!.scanCheckpoint : null)
  );
  const freshBoundary = scan.boundary;

  const finish = (mdast: MdastRoot, hast: HastRoot, usedIncremental: boolean, boundary: number): AdvanceResult => ({
    mdast,
    hast,
    usedIncremental,
    boundary,
    nextState: {
      content,
      mdast,
      hast,
      stableBoundary: freshBoundary,
      scanCheckpoint: scan.checkpoint,
      depsKey: options.depsKey,
    },
  });

  const fullPath = (): AdvanceResult => {
    const { mdast, hast } = runPipeline(content, options);
    return finish(mdast, hast, false, 0);
  };

  // G0 + G1 (scan already ran — its result seeds nextState either way)
  if (!appendOnly) return fullPath();
  // G3
  const boundary = Math.min(freshBoundary, prev!.stableBoundary);
  if (boundary <= 0) return fullPath();
  // G4 (defensive)
  for (const child of prev!.mdast.children) {
    const start = child.position?.start?.offset;
    const end = child.position?.end?.offset;
    if (start !== undefined && end !== undefined && start < boundary && end > boundary) {
      return fullPath();
    }
  }

  const plan = collectPrefixInjection(prev!.mdast, prev!.content, boundary);
  // A nested definition/footnote-def that cannot be re-injected verbatim —
  // take the full path this frame rather than splice without it (A3).
  if (plan.uninjectable) return fullPath();
  const injection = buildInjectionPrefix(plan.events);
  const tailSource = injection.text + content.slice(boundary);
  const tail = runPipeline(tailSource, options);
  const spliced = spliceTrees({
    prevMdast: prev!.mdast,
    prevHast: prev!.hast,
    tailMdast: tail.mdast,
    tailHast: tail.hast,
    content,
    boundary,
    injectionPrefix: injection.text,
    injectedSegments: injection.segments,
  });
  // null = the prefix/tail hast layout fell outside the alignment model —
  // full parse this frame (safe, one-frame cost).
  if (spliced === null) return fullPath();
  return finish(spliced.mdast, spliced.hast, true, boundary);
}
