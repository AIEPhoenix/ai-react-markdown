'use client';

/**
 * Streaming-aware render profiler — combines React commit metrics with
 * browser-level signals to capture the *full* cost of a streaming render
 * surface, not just React's JS work.
 *
 * Sources of data:
 * - `React.Profiler` → `actualDuration` (memoization-aware) and
 *   `baseDuration` (worst-case estimate without memoization). The ratio
 *   exposes how much the cache actually saves.
 * - `MutationObserver` → DOM-level cost: how many add/remove/attribute/
 *   characterData mutations the renderer caused. React.Profiler does NOT
 *   account for this — it's a major part of "block-memo saved work" that's
 *   otherwise invisible.
 * - `PerformanceObserver({ entryTypes: ['longtask'] })` → main-thread
 *   blocking events ≥ 50 ms. These are what cause user-visible jank.
 * - `requestAnimationFrame` → live FPS + slow-frame counter (<30 FPS).
 *
 * Stat hygiene:
 * - First `warmUpCommits` commits (default 3) are counted but excluded from
 *   percentile / avg / sum, so V8 JIT cold-start doesn't poison the data.
 * - A rolling window of recent commit samples (default 500) is kept for
 *   percentile (p50/p95/p99) computation. Snapshots are published on a
 *   timer (default 100 ms) to bound React re-render pressure from the
 *   panel itself.
 *
 * Devtool reminders (interpretation, not bugs):
 * - Storybook runs a dev build of React. Absolute commit numbers are
 *   inflated by dev-mode checks; **trust the ratio between two profilers,
 *   not absolute values**.
 * - `longtask` is a page-wide metric. When two profilers run in the same
 *   tab, both will report the same longtask events.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfilerOnRenderCallback, RefObject } from 'react';
import { subscribeStageTimings } from '../../src/components/devStageTimings';

export interface ChunkSample {
  index: number;
  size: number;
  delay: number;
  timestamp: number;
}

/** Per-side commit-duration statistics, computed at snapshot time. */
export interface CommitStats {
  /** Number of samples in the rolling window used for percentile computation. */
  count: number;
  /** Sum across the FULL post-warmup history. */
  total: number;
  /** Min across the FULL post-warmup history (monotonic non-increasing). */
  min: number;
  /** Max across the FULL post-warmup history (monotonic non-decreasing). */
  max: number;
  /** Mean across the FULL post-warmup history. */
  avg: number;
  /** Percentile values are computed from the rolling sample window only. */
  p50: number;
  p95: number;
  p99: number;
  /** Most recent commit's duration. */
  last: number;
}

export interface DomMutationStats {
  total: number;
  childListAdds: number;
  childListRemoves: number;
  attributes: number;
  characterData: number;
}

export interface LongTaskStats {
  count: number;
  /** Total blocked main-thread time (ms). */
  total: number;
  /** Duration of the longest single longtask (ms). */
  max: number;
}

export interface ElementRenderStats {
  /** Total spy-component invocations since reset. */
  total: number;
  /** Per-tag breakdown. Only tags that actually rendered appear here. */
  byTag: Record<string, number>;
}

/** Aggregate of one pipeline stage's `performance.measure` entries. */
export interface StageStats {
  count: number;
  total: number;
  max: number;
}

export interface RenderProfilerSnapshot {
  /** Commits intentionally excluded from stats during JIT warm-up. */
  warmUpCommits: number;
  /** Memoization-aware React commit duration. */
  actual: CommitStats;
  /** React's worst-case estimate WITHOUT memoization. */
  base: CommitStats;
  /**
   * `(base.total − actual.total) / base.total` — fraction of base render
   * work skipped via memoization. 0 if base is 0. Best read alongside
   * `actual.total` vs `base.total` to avoid drawing conclusions from
   * negligible workloads.
   */
  memoEffectiveness: number;
  dom: DomMutationStats;
  /** Latest FPS sample from the rAF loop. */
  fps: number;
  minFps: number;
  /** Frames where instantaneous FPS dipped below 30. */
  slowFrameCount: number;
  rafCount: number;
  longTasks: LongTaskStats;
  /**
   * Component-level render count. Populated externally by spy
   * `customComponents` (see `createSpyComponents`) — when block-memo holds
   * cached subtrees, React skips invoking their component functions, so the
   * spy is never called and `total` doesn't increment. The ratio between
   * the two sides is the most direct view of "what block-memo saves at the
   * component level" — react-scan-style without DevTools hook hackery.
   */
  elementRenders: ElementRenderStats;
  /**
   * Dev-only pipeline stage timings, delivered over devStageTimings'
   * direct subscription channel (NOT the User Timing buffer — React 19
   * dev floods that with per-component measures). Empty unless the hook
   * was created with `observeStages: true` AND an instrumented (dev-build,
   * block-memo) renderer is measuring on this page. Keyed by stage name
   * (parse / transform / build / render).
   */
  stages: Record<string, StageStats>;
  chunks: ChunkSample[];
  totalChars: number;
  lastResetAt: number;
  /** True once the React.Profiler has fired at least once. */
  profilerActive: boolean;
  /**
   * True only on the ONE final snapshot published after `running` flips
   * false. Interval publishes during a run and reset/empty snapshots are
   * always false. Consumers that record results (useComparisonRuns) gate
   * on this instead of guessing a settle delay: a slow cross-process final
   * simply records when it arrives, and an externally wiped snapshot can
   * never be mistaken for a finished run.
   */
  settled: boolean;
}

export interface RenderProfilerOptions {
  /** Commits to skip from stats during JIT warm-up. Default 3. */
  warmUpCommits?: number;
  /** Rolling window size for percentile computation. Default 500. */
  maxSamples?: number;
  /** Snapshot publish cadence (ms). Default 100. */
  snapshotIntervalMs?: number;
  /**
   * Whether streaming is active. When `false`, the rAF loop (fps / slow-
   * frame counters) and snapshot publish interval pause — the last
   * snapshot stays visible as the "final result" without continuing to
   * accumulate jank from idle frames. Default `true`.
   *
   * Event-driven observers (MutationObserver, longtask
   * PerformanceObserver) stay attached so a delayed paint or stray long
   * task after the stream ends is still captured.
   */
  running?: boolean;
  /**
   * Aggregate the block-memo pipeline's stage timings into
   * `snapshot.stages` via devStageTimings' subscription channel. The
   * channel is PAGE-WIDE — in a same-page comparison only ONE profiler
   * (the block-memo side's) should subscribe, or both panels would
   * display the same union. Default `false`.
   */
  observeStages?: boolean;
}

export interface RenderProfilerHandle<T extends HTMLElement = HTMLElement> {
  snapshot: RenderProfilerSnapshot;
  onRender: ProfilerOnRenderCallback;
  /**
   * Attach this ref to the wrapper element whose DOM mutations should be
   * counted. The observer connects in `useEffect` after mount. Caller can
   * narrow the element type via the hook's generic parameter
   * (`useRenderProfiler<HTMLDivElement>()`) to avoid casting at the ref
   * attachment site.
   */
  targetRef: RefObject<T | null>;
  recordChunk: (chunk: string) => void;
  /**
   * Increment the element-render counter for a tag. Wire spy components
   * (see `createSpyComponents`) so that each invocation of a tag's spy
   * calls this with the tag name.
   */
  recordElementRender: (tag: string) => void;
  reset: () => void;
}

const emptyCommitStats = (): CommitStats => ({
  count: 0,
  total: 0,
  min: 0,
  max: 0,
  avg: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  last: 0,
});

const emptyDomStats = (): DomMutationStats => ({
  total: 0,
  childListAdds: 0,
  childListRemoves: 0,
  attributes: 0,
  characterData: 0,
});

const emptyLongTasks = (): LongTaskStats => ({ count: 0, total: 0, max: 0 });

const emptyElementRenders = (): ElementRenderStats => ({ total: 0, byTag: {} });

/** Zeroed snapshot — also the host-side placeholder in the isolated
 *  (cross-iframe) comparison before a side has reported in. */
export const emptySnapshot = (): RenderProfilerSnapshot => ({
  warmUpCommits: 0,
  actual: emptyCommitStats(),
  base: emptyCommitStats(),
  memoEffectiveness: 0,
  dom: emptyDomStats(),
  fps: 0,
  minFps: Number.POSITIVE_INFINITY,
  slowFrameCount: 0,
  rafCount: 0,
  longTasks: emptyLongTasks(),
  elementRenders: emptyElementRenders(),
  stages: {},
  chunks: [],
  totalChars: 0,
  lastResetAt: 0,
  profilerActive: false,
  settled: false,
});

interface Accum {
  warmUpCommits: number;
  postWarmupCommits: number;
  // Full-history sums/min/max for accurate avg/total/min/max even when
  // sample window rolls. Min/max here are MONOTONIC over the run; the
  // rolling window is only used for percentile computation.
  actualTotal: number;
  baseTotal: number;
  actualLast: number;
  baseLast: number;
  actualMin: number;
  actualMax: number;
  baseMin: number;
  baseMax: number;
  // Rolling sample windows for percentile.
  actualSamples: number[];
  baseSamples: number[];
  // DOM stats
  domTotal: number;
  domAdds: number;
  domRemoves: number;
  domAttrs: number;
  domCharData: number;
  // FPS / rAF
  fps: number;
  minFps: number;
  slowFrames: number;
  rafCount: number;
  // Long tasks
  longTaskCount: number;
  longTaskTotal: number;
  longTaskMax: number;
  // Element render counter (driven by spy customComponents)
  elementRenderTotal: number;
  elementRenderByTag: Record<string, number>;
  // Pipeline stage measures (observeStages only)
  stages: Record<string, StageStats>;
  // Stream chunks
  chunks: ChunkSample[];
  totalChars: number;
  // Bookkeeping
  lastResetAt: number;
  profilerActive: boolean;
}

const emptyAccum = (now: number): Accum => ({
  warmUpCommits: 0,
  postWarmupCommits: 0,
  actualTotal: 0,
  baseTotal: 0,
  actualLast: 0,
  baseLast: 0,
  actualMin: Number.POSITIVE_INFINITY,
  actualMax: 0,
  baseMin: Number.POSITIVE_INFINITY,
  baseMax: 0,
  actualSamples: [],
  baseSamples: [],
  domTotal: 0,
  domAdds: 0,
  domRemoves: 0,
  domAttrs: 0,
  domCharData: 0,
  fps: 0,
  minFps: Number.POSITIVE_INFINITY,
  slowFrames: 0,
  rafCount: 0,
  longTaskCount: 0,
  longTaskTotal: 0,
  longTaskMax: 0,
  elementRenderTotal: 0,
  elementRenderByTag: {},
  stages: {},
  chunks: [],
  totalChars: 0,
  lastResetAt: now,
  profilerActive: false,
});

/** Linear-interpolated percentile (Excel-style). Expects sorted ascending input. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const f = rank - lo;
  return sortedAsc[lo] * (1 - f) + sortedAsc[hi] * f;
}

function computeStats(
  samples: number[],
  postWarmupCount: number,
  total: number,
  last: number,
  historicalMin: number,
  historicalMax: number
): CommitStats {
  if (samples.length === 0) {
    return { ...emptyCommitStats(), total, last };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    total,
    last,
    min: Number.isFinite(historicalMin) ? historicalMin : 0,
    max: historicalMax,
    avg: postWarmupCount > 0 ? total / postWarmupCount : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export function useRenderProfiler<T extends HTMLElement = HTMLElement>(
  opts?: RenderProfilerOptions
): RenderProfilerHandle<T> {
  const warmUpCount = opts?.warmUpCommits ?? 3;
  const maxSamples = opts?.maxSamples ?? 500;
  const snapshotMs = opts?.snapshotIntervalMs ?? 100;
  const running = opts?.running ?? true;
  const observeStages = opts?.observeStages ?? false;

  // Lazy initialization to avoid calling `performance.now()` during render
  // (would trip React Compiler purity checks).
  const accumRef = useRef<Accum | null>(null);
  const targetRef = useRef<T | null>(null);
  const lastChunkAtRef = useRef<number>(0);

  const getAccum = useCallback((): Accum => {
    if (!accumRef.current) {
      const now = performance.now();
      accumRef.current = emptyAccum(now);
      lastChunkAtRef.current = now;
    }
    return accumRef.current;
  }, []);

  const [snapshot, setSnapshot] = useState<RenderProfilerSnapshot>(emptySnapshot);

  const onRender = useCallback<ProfilerOnRenderCallback>(
    (_id, _phase, actualDuration, baseDuration) => {
      const acc = getAccum();
      acc.profilerActive = true;

      if (acc.warmUpCommits < warmUpCount) {
        acc.warmUpCommits += 1;
        return;
      }

      acc.postWarmupCommits += 1;
      acc.actualLast = actualDuration;
      acc.baseLast = baseDuration;
      acc.actualTotal += actualDuration;
      acc.baseTotal += baseDuration;
      if (actualDuration < acc.actualMin) acc.actualMin = actualDuration;
      if (actualDuration > acc.actualMax) acc.actualMax = actualDuration;
      if (baseDuration < acc.baseMin) acc.baseMin = baseDuration;
      if (baseDuration > acc.baseMax) acc.baseMax = baseDuration;
      // The 100 ms snapshot publish re-renders the host component; the
      // profiled subtree bails out (memoized, stable props) and the commit
      // lands here as a near-zero blip (~0.02 ms). Those blips are real
      // React work, so they stay in `total`/`avg` — but they'd dilute the
      // percentile window toward zero, so exclude them from samples. The
      // threshold is far below any commit that actually rendered markdown
      // (cheapest observed streaming commits are ≥ 0.1 ms in dev).
      const isBailoutBlip = actualDuration < 0.05 && baseDuration < 0.05;
      if (!isBailoutBlip) {
        acc.actualSamples.push(actualDuration);
        acc.baseSamples.push(baseDuration);
        if (acc.actualSamples.length > maxSamples) acc.actualSamples.shift();
        if (acc.baseSamples.length > maxSamples) acc.baseSamples.shift();
      }
    },
    [getAccum, warmUpCount, maxSamples]
  );

  const recordChunk = useCallback(
    (chunk: string) => {
      const acc = getAccum();
      const now = performance.now();
      // First chunk after a reset (or lazy-init) has no meaningful "delta
      // since previous chunk", so report 0 rather than time-since-mount.
      const isFirst = acc.chunks.length === 0;
      acc.chunks.push({
        index: acc.chunks.length,
        size: chunk.length,
        delay: isFirst ? 0 : Math.round(now - lastChunkAtRef.current),
        timestamp: now,
      });
      acc.totalChars += chunk.length;
      lastChunkAtRef.current = now;
      if (acc.chunks.length > 200) acc.chunks = acc.chunks.slice(-200);
    },
    [getAccum]
  );

  const recordElementRender = useCallback(
    (tag: string) => {
      const acc = getAccum();
      acc.elementRenderTotal += 1;
      acc.elementRenderByTag[tag] = (acc.elementRenderByTag[tag] ?? 0) + 1;
    },
    [getAccum]
  );

  const reset = useCallback(() => {
    const now = performance.now();
    accumRef.current = emptyAccum(now);
    lastChunkAtRef.current = now;
    // Bound the page's User Timing buffer between runs: React 19 dev
    // emits one measure per component render (component tracks) and
    // nothing ever clears them — millions of entries over a benchmark
    // session, which any buffer-scanning API then pays for (measured:
    // per-name clearMeasures on that buffer inverted the whole benchmark).
    // Dev-only harness → wholesale clear is safe; recorded DevTools
    // traces are unaffected (the timeline reads trace events, not the
    // live buffer).
    if (typeof performance.clearMeasures === 'function') performance.clearMeasures();
    if (typeof performance.clearMarks === 'function') performance.clearMarks();
    setSnapshot(emptySnapshot());
  }, []);

  const publishSnapshot = useCallback((settled: boolean) => {
    const acc = accumRef.current;
    if (!acc) return;
    const actual = computeStats(
      acc.actualSamples,
      acc.postWarmupCommits,
      acc.actualTotal,
      acc.actualLast,
      acc.actualMin,
      acc.actualMax
    );
    const base = computeStats(
      acc.baseSamples,
      acc.postWarmupCommits,
      acc.baseTotal,
      acc.baseLast,
      acc.baseMin,
      acc.baseMax
    );
    const memoEff = base.total > 0 ? (base.total - actual.total) / base.total : 0;
    setSnapshot({
      warmUpCommits: acc.warmUpCommits,
      actual,
      base,
      memoEffectiveness: memoEff,
      dom: {
        total: acc.domTotal,
        childListAdds: acc.domAdds,
        childListRemoves: acc.domRemoves,
        attributes: acc.domAttrs,
        characterData: acc.domCharData,
      },
      fps: acc.fps,
      minFps: acc.minFps,
      slowFrameCount: acc.slowFrames,
      rafCount: acc.rafCount,
      longTasks: {
        count: acc.longTaskCount,
        total: acc.longTaskTotal,
        max: acc.longTaskMax,
      },
      elementRenders: {
        total: acc.elementRenderTotal,
        byTag: { ...acc.elementRenderByTag },
      },
      stages: Object.fromEntries(Object.entries(acc.stages).map(([k, v]) => [k, { ...v }])),
      chunks: acc.chunks.slice(),
      totalChars: acc.totalChars,
      lastResetAt: acc.lastResetAt,
      profilerActive: acc.profilerActive,
      settled,
    });
  }, []);

  // Periodic snapshot publish — only while running. Sorts samples once per
  // tick rather than per commit, capping React re-render pressure caused by
  // the panel itself. When `running` flips to false, we publish ONE final
  // snapshot — marked `settled` — so the panel shows the final state and
  // recording consumers have a positive completion handshake; then go idle.
  useEffect(() => {
    if (!running) {
      publishSnapshot(true);
      return;
    }
    const id = window.setInterval(() => publishSnapshot(false), snapshotMs);
    return () => window.clearInterval(id);
  }, [running, snapshotMs, publishSnapshot]);

  // FPS via rAF — captures perceived smoothness, the user-facing equivalent
  // of "commits per second that actually painted." Block-memo's win on the
  // browser side (less DOM mutation → less layout/paint) shows up here even
  // though React.Profiler can't see it directly. Only runs while `running`
  // is true so idle frames don't inflate `slowFrameCount` after the stream
  // ends.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    // `last == null` signals "this is the first tick after start/resume" —
    // we record the timestamp but skip the fps computation, so the gap
    // between effect setup and the first rAF callback doesn't pollute the
    // counters as a multi-hundred-ms "frame".
    let last: number | null = null;
    const tick = (now: number) => {
      const acc = accumRef.current;
      if (acc && last !== null) {
        const delta = now - last;
        const fps = delta > 0 ? 1000 / delta : 0;
        acc.fps = fps;
        acc.rafCount += 1;
        if (fps < acc.minFps) acc.minFps = fps;
        if (fps < 30) acc.slowFrames += 1;
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Per-side DOM mutation count. Distinct from React commits — captures the
  // browser-side cost that block-memo's element-reference reuse skips.
  // Different React commit counts can produce vastly different DOM mutation
  // counts; this surfaces that gap.
  useEffect(() => {
    const target = targetRef.current;
    if (!target || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver((records) => {
      const acc = accumRef.current;
      if (!acc) return;
      for (const r of records) {
        if (r.type === 'childList') {
          acc.domAdds += r.addedNodes.length;
          acc.domRemoves += r.removedNodes.length;
          acc.domTotal += r.addedNodes.length + r.removedNodes.length;
        } else if (r.type === 'attributes') {
          acc.domAttrs += 1;
          acc.domTotal += 1;
        } else if (r.type === 'characterData') {
          acc.domCharData += 1;
          acc.domTotal += 1;
        }
      }
    });
    obs.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    return () => obs.disconnect();
  }, []);

  // Pipeline stage timings — direct subscription to the block-memo
  // renderer's dev-only channel (see src devStageTimings). Deliberately
  // NOT a PerformanceObserver on 'measure': React 19 dev emits one
  // measure per component render (component tracks), so the page-global
  // channel is a flood this consumer would have to filter per batch. The
  // subscription is still page-scoped (module-level listener set) — keep
  // the one-consumer-per-page discipline (the block-memo side only),
  // otherwise both panels would show the same union.
  useEffect(() => {
    if (!observeStages) return;
    return subscribeStageTimings((stage, duration) => {
      const acc = accumRef.current;
      if (!acc) return;
      const s = (acc.stages[stage] ??= { count: 0, total: 0, max: 0 });
      s.count += 1;
      s.total += duration;
      if (duration > s.max) s.max = duration;
    });
  }, [observeStages]);

  // PerformanceObserver longtask — main-thread blocks ≥ 50 ms, the kind
  // that produce visible jank. Page-wide (not per-side), so when two
  // profilers run in the same tab they will report identical numbers. Use
  // for "did this scenario produce jank at all?", not for cross-side
  // attribution.
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        const acc = accumRef.current;
        if (!acc) return;
        for (const entry of list.getEntries()) {
          acc.longTaskCount += 1;
          acc.longTaskTotal += entry.duration;
          if (entry.duration > acc.longTaskMax) acc.longTaskMax = entry.duration;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // Some browsers (e.g. Firefox without the flag) don't support longtask;
      // silently degrade.
    }
    return () => observer?.disconnect();
  }, []);

  return { snapshot, onRender, targetRef, recordChunk, recordElementRender, reset };
}
