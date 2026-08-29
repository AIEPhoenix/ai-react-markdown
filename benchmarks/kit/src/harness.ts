/**
 * The measurement harness — framework-agnostic, and the only thing in this
 * directory allowed to touch browser APIs.
 *
 * It is driven from OUTSIDE (Playwright) through `window.__bench`, not from a
 * timer inside the app, for one reason: the runner has to know exactly when a
 * scenario started and when it drained, and an app that decides that for
 * itself makes the two numbers unfalsifiable from the driver's side.
 *
 * WHAT IS DELIBERATELY NOT MEASURED HERE. No wall-clock "render time" around
 * a React commit: that number is a lie under concurrent rendering and it is
 * exactly the kind of engine-layer figure this whole benchmark exists to stop
 * relying on. Everything below is either a browser-reported vital or a count
 * the DOM can be asked for directly.
 *
 * EVERY FIELD CAN BE NULL AND MEANS IT. A metric the browser never produced
 * is reported as null, never as zero — the difference between "this page had
 * no layout shift" and "this engine does not report layout shift" is the
 * difference between a result and a fiction, and a zero blurs them.
 */

export type Outcome = 'settled' | 'settle-timeout' | 'stream-timeout';

export interface BenchMetrics {
  scenario: string;
  app: string;
  /** How the run ended. A row that is not `settled` describes a page that
   *  never went quiet, and its settle-derived numbers must be read as
   *  lower bounds rather than measurements. The runner prints it. */
  outcome: Outcome;
  lcp: number | null;
  cls: number | null;
  /** Longest event-handler duration seen. Not INP — there is no real user
   *  input here — but it catches a scenario whose scroll handler blocks. */
  longestEventMs: number | null;
  /** ms from the first chunk to the last chunk being handed to the renderer. */
  streamMs: number;
  /** ms from the last chunk until the page goes quiet. Null when it never
   *  did, which is what `outcome` is for. */
  settleMs: number | null;
  /** Frame pacing DURING the stream. p95 is the one that shows jank; mean
   *  hides it, which is why both are kept. `frames` is the sample size —
   *  a p95 over four frames is not a p95, and only the count says so. */
  rafMeanMs: number | null;
  rafP95Ms: number | null;
  frames: number;
  /** Long tasks (>50 ms) observed BETWEEN start and settle, not since page
   *  load. Counting from load folded the bundle's own parse and the app's
   *  first paint into every scenario equally, which is real work but not the
   *  work under test. */
  longTasks: number;
  longestTaskMs: number;
  totalBlockingMs: number;
  /** DOM size once settled. `renderedNodes` counts inside the renderer's own
   *  container so the app shell is not credited to the library. */
  domNodes: number;
  renderedNodes: number;
  /** Nodes inside the container that no renderer put there. Non-zero means a
   *  browser extension is writing into the page and every count in this row
   *  is contaminated — see the README's note on visual verification. */
  foreignNodes: number;
  /** Post-stream scripted scroll, when the scenario asks for one. */
  scrollJankFrames: number | null;
  scrollDriftPx: number | null;
  /** Best-effort, Chrome only, and reported as null elsewhere rather than 0. */
  heapBytes: number | null;
}

interface Bench {
  ready: boolean;
  start(): void;
  onDrained(): void;
  result(): Promise<BenchMetrics>;
}

declare global {
  interface Window {
    __bench?: Bench;
  }
}

const SETTLE_FRAME_MS = 20;
const LONG_TASK_MS = 50;

/** Two frames under the threshold, not one: a single fast frame happens in
 *  the middle of heavy work all the time, and calling that "settled" was the
 *  first version's bug — every scenario reported a settle time of one frame. */
const SETTLE_CONSECUTIVE = 2;

/** Hard caps, because a harness that can hang has no failure mode — it has a
 *  timeout somewhere else, reported as something else. A page that never
 *  settles is a RESULT (`outcome: 'settle-timeout'`), and one that never
 *  drains is a different result; both are more useful than a runner error
 *  that says only "the page did not answer". */
const SETTLE_TIMEOUT_MS = 30_000;
const STREAM_TIMEOUT_MS = 180_000;

/** Attributes an extension is known to stamp on nodes it injects. Not a
 *  security check — just enough to notice that the numbers are dirty. */
const FOREIGN_SELECTOR = '[data-omni-id],[data-omni-walked],aie-omt-inline,[data-translated],grammarly-extension';

export interface HarnessInit {
  app: string;
  scenario: string;
  container: () => Element | null;
  onScroll?: () => Promise<{ jankFrames: number; driftPx: number }>;
}

export function installHarness(init: HarnessInit): void {
  let startedAt = 0;
  let drainedAt = 0;
  let settledAt: number | null = null;
  let outcome: Outcome = 'settled';
  const frameGaps: number[] = [];
  let longTasks = 0;
  let longestTaskMs = 0;
  let totalBlockingMs = 0;
  let lcp: number | null = null;
  let cls: number | null = null;
  let longestEventMs: number | null = null;
  let resolveResult: ((m: BenchMetrics) => void) | null = null;
  const observers: PerformanceObserver[] = [];

  const observe = (init2: PerformanceObserverInit, fn: (list: PerformanceObserverEntryList) => void): void => {
    try {
      const po = new PerformanceObserver(fn);
      po.observe(init2);
      observers.push(po);
    } catch {
      // Not every engine ships every entry type. The field stays null and the
      // runner prints the browser, so a null can be read as "not reported
      // here" rather than "measured as nothing".
    }
  };

  // Long tasks are attributed to the WINDOW under test, not to the document.
  // `buffered` is off and each entry is filtered by its own start time: the
  // bundle parse and first paint are real work, but they are the same work in
  // every scenario and folding them in flattens the differences being looked
  // for.
  observe({ type: 'longtask' }, (list) => {
    for (const entry of list.getEntries()) {
      if (startedAt === 0 || entry.startTime < startedAt) continue;
      if (settledAt !== null && entry.startTime > settledAt) continue;
      if (entry.duration < LONG_TASK_MS) continue;
      longTasks += 1;
      longestTaskMs = Math.max(longestTaskMs, entry.duration);
      totalBlockingMs += entry.duration - LONG_TASK_MS;
    }
  });

  // LCP and CLS ARE buffered: both are page-lifetime vitals by definition,
  // and the largest paint routinely lands before the harness installs. The
  // asymmetry with longtask above is deliberate, not an oversight.
  observe({ type: 'largest-contentful-paint', buffered: true }, (list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1] as { startTime?: number } | undefined;
    if (last?.startTime !== undefined) lcp = last.startTime;
  });

  let clsSum = 0;
  observe({ type: 'layout-shift', buffered: true }, (list) => {
    for (const e of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
      if (e.hadRecentInput) continue;
      clsSum += e.value ?? 0;
    }
    cls = clsSum;
  });

  observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit, (list) => {
    for (const e of list.getEntries()) longestEventMs = Math.max(longestEventMs ?? 0, e.duration);
  });

  let rafHandle = 0;
  let lastFrame = 0;
  let underThreshold = 0;
  let streamTimer: ReturnType<typeof setTimeout> | undefined;

  const frame = (now: number): void => {
    if (lastFrame !== 0) {
      const gap = now - lastFrame;
      // Only frames during the stream describe streaming cost; frames after
      // the drain belong to settle, and mixing them flattened p95 to
      // uselessness in the first version.
      if (drainedAt === 0) frameGaps.push(gap);
      else if (settledAt === null) {
        underThreshold = gap <= SETTLE_FRAME_MS ? underThreshold + 1 : 0;
        if (underThreshold >= SETTLE_CONSECUTIVE) settledAt = now;
        else if (now - drainedAt > SETTLE_TIMEOUT_MS) {
          outcome = 'settle-timeout';
          settledAt = now;
        }
      }
    }
    lastFrame = now;
    if (settledAt === null) rafHandle = requestAnimationFrame(frame);
    else void finish();
  };

  async function finish(): Promise<void> {
    if (resolveResult === null) return;
    const done = resolveResult;
    resolveResult = null;
    cancelAnimationFrame(rafHandle);
    if (streamTimer !== undefined) clearTimeout(streamTimer);
    for (const po of observers) po.disconnect();

    let scrollJankFrames: number | null = null;
    let scrollDriftPx: number | null = null;
    if (init.onScroll && outcome === 'settled') {
      const r = await init.onScroll();
      scrollJankFrames = r.jankFrames;
      scrollDriftPx = r.driftPx;
    }

    const sorted = [...frameGaps].sort((a, b) => a - b);
    const p95 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
    const container = init.container();
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;

    done({
      scenario: init.scenario,
      app: init.app,
      outcome,
      lcp,
      cls,
      longestEventMs,
      streamMs: (drainedAt === 0 ? performance.now() : drainedAt) - startedAt,
      settleMs: settledAt === null || outcome !== 'settled' ? null : settledAt - drainedAt,
      rafMeanMs: mean,
      rafP95Ms: p95,
      frames: sorted.length,
      longTasks,
      longestTaskMs,
      totalBlockingMs,
      domNodes: document.getElementsByTagName('*').length,
      renderedNodes: container === null ? 0 : container.getElementsByTagName('*').length,
      foreignNodes: container === null ? 0 : container.querySelectorAll(FOREIGN_SELECTOR).length,
      scrollJankFrames,
      scrollDriftPx,
      heapBytes: heap === undefined ? null : heap.usedJSHeapSize,
    });
  }

  const resultPromise = new Promise<BenchMetrics>((resolve) => {
    resolveResult = resolve;
  });

  window.__bench = {
    ready: true,
    start(): void {
      startedAt = performance.now();
      rafHandle = requestAnimationFrame(frame);
      // A scenario that never drains would otherwise sit in the raf loop
      // until the runner's own deadline and be reported as a dead page.
      streamTimer = setTimeout(() => {
        if (drainedAt !== 0) return;
        outcome = 'stream-timeout';
        drainedAt = performance.now();
      }, STREAM_TIMEOUT_MS);
    },
    onDrained(): void {
      if (drainedAt === 0) drainedAt = performance.now();
    },
    result: () => resultPromise,
  };
}

/**
 * Scripted scroll, shared so both apps drift the same way.
 *
 * DRIFT is the interesting number, not smoothness: a renderer that grows a
 * node above the viewport moves the content under the user's eyes, and that
 * is invisible to frame timing. Measured as where we asked to be minus where
 * we ended up.
 */
export async function scriptedScroll(steps = 30, stepPx = 400): Promise<{ jankFrames: number; driftPx: number }> {
  let jankFrames = 0;
  let last = performance.now();
  let target = 0;
  for (let i = 0; i < steps; i++) {
    target = Math.min(document.body.scrollHeight, target + stepPx);
    window.scrollTo(0, target);
    await new Promise<void>((r) =>
      requestAnimationFrame((now) => {
        if (now - last > SETTLE_FRAME_MS) jankFrames += 1;
        last = now;
        r();
      })
    );
  }
  return { jankFrames, driftPx: Math.abs(window.scrollY - Math.min(target, document.body.scrollHeight)) };
}
