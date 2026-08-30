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
  /**
   * Largest contentful paint — of the APP SHELL, not of the stream.
   *
   * Kept and renamed in the readout rather than deleted, because it is not
   * meaningless, only easy to misread: every cell lands at 104-120 ms
   * regardless of what the renderer then does, since the largest in-viewport
   * text block is painted from the first chunk. The exception proves the
   * rule — `turn-taking` reads ~1140 ms in both apps purely because its
   * content emits no `#` heading, so a bigger block is reached later. That
   * is a fact about the scenario's markdown, not about performance.
   *
   * Streamed content grows BELOW the fold, so LCP structurally cannot
   * describe the streaming path. Read it as "did the shell paint promptly",
   * and nothing else.
   */
  shellPaintMs: number | null;
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
   *  hides it, which is why both are kept.
   *
   *  `rafP95Ms` is null below 60 samples rather than computed from too few:
   *  at 38 frames the 95th percentile is index 36, i.e. the third largest
   *  value, and printing that in a column beside a p95 over 3100 frames
   *  invites a comparison that is not one. `frames` is always reported so a
   *  reader can see which cells are thin. */
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
  /** Null when the container was not found — see the note at the assignment.
   *  The runner treats null as a failed run rather than as a fast one. */
  renderedNodes: number | null;
  /** Nodes inside the container that no renderer put there. Non-zero means a
   *  browser extension is writing into the page and every count in this row
   *  is contaminated — see the README's note on visual verification. */
  foreignNodes: number | null;
  /**
   * How many times the container's DOM actually changed during the stream,
   * against how many chunks were delivered.
   *
   * These are NOT the same number and the gap decides how `streamMs` reads.
   * React yields every few milliseconds; when one chunk's render overruns a
   * slice, the next delivery can land first and the in-progress render
   * restarts against the newer string — the intermediate commit never
   * happens. `streamMs` is then a per-COMMIT cost wearing a per-chunk label,
   * and the effect grows with slowness, which would make this suite
   * systematically under-report exactly the large regressions it exists to
   * catch.
   *
   * Counted with a MutationObserver on the container rather than from
   * React internals: what matters is whether the DOM moved, and an observer
   * cannot be wrong about that in the way a framework hook could.
   *
   * MEASURED 2026-08-30, and the coalescing worry does not reproduce:
   * `throughput-code` gives 1250/1251 on all three apps, including
   * `react-mantine` at ~14 ms per chunk — well past React's ~5 ms slice,
   * which is where coalescing would have to appear if it happened at all.
   * So `streamMs` on these cells is a per-chunk cost and dividing by chunks
   * is sound. Keep the counter anyway: the property is a fact about the
   * current React scheduler and the current renderer, not a guarantee, and
   * it is cheap to keep watching.
   */
  commits: number;
  chunks: number;
  /** Post-stream scripted scroll, when the scenario asks for one. Measures a
   *  STATIC document and is ~0 by construction; `anchorDriftPx` is the
   *  version that measures the complaint. */
  scrollJankFrames: number | null;
  scrollDriftPx: number | null;
  /**
   * How far content already on screen moved IN THE VIEWPORT while the stream
   * was still arriving — "the page jumped while I was reading".
   *
   * READ THE NAME CAREFULLY: this is what the reader SAW move, not what the
   * layout moved. Chrome's scroll anchoring silently adjusts `scrollY` when
   * content grows above the viewport, precisely so the visible text stays
   * put; measured here, a document growing from 900px to 57,753px with 1,200
   * paragraphs inserted ABOVE the anchor moved it 0px, because the browser
   * compensated the entire way (`scrollY` pinned at 930 throughout).
   *
   * That makes the metric MORE useful than the layout-motion version, not
   * less — a jump the browser absorbs is a jump the user never had — but it
   * means a zero here is a statement about the browser plus the renderer
   * together. A renderer can only defeat scroll anchoring by doing something
   * it cannot follow: replacing the anchored subtree, or changing sizes
   * below the anchor in the same frame.
   *
   * Null means the anchor never armed, reported rather than folded into 0:
   * an anchor that never armed reports no movement, which is
   * indistinguishable from a well-behaved renderer. It spent its first hour
   * doing exactly that, having armed on elapsed FRAMES rather than on
   * document height — at which point the document was 900px against a 900px
   * viewport, `scrollIntoView` had nowhere to go, and the anchor sat at the
   * top with nothing above it.
   */
  anchorDriftPx: number | null;
  /** Largest single-frame jump. 40px of creep and 40px in one frame read
   *  very differently, and only the second is a visible jolt. */
  anchorMaxJumpPx: number | null;
  /**
   * The anchored element was removed from the document mid-stream, so
   * tracking stopped early and `anchorDriftPx` covers only the frames before
   * that.
   *
   * Reported because a detached run's zero means something completely
   * different from a clean run's zero, and the two are otherwise identical
   * on screen. Measured while building the control: a version that grew
   * content by prepending to the MARKDOWN detached on its first sample —
   * one sample against 1032 on a normal run — and reported 0px, which read
   * exactly like "nothing moved". A true drift of zero is a fact about the
   * renderer; a detached zero is the absence of a measurement.
   */
  anchorDetached: boolean;
  /**
   * V8 heap in use at the moment the run finished. **Allocation churn, not
   * retention, and not comparable between cells.**
   *
   * Kept because it is free and occasionally suggestive, but it must never
   * be read as memory cost, and `compare.mjs` ignores it. Three reasons,
   * each sufficient: nothing forces a GC before the read, so the number is
   * "allocated and not yet collected"; `performance.memory` covers the V8
   * heap only, while the DOM this suite is mostly about lives in Blink's
   * C++ heap and is invisible here; and Chrome quantizes the value.
   *
   * Measured 2026-08-30, three pacings converging on a byte-identical DOM
   * (11432 nodes) in one run: 40 MB, 77 MB, 123 MB. Across two runs of the
   * same cell, core-vs-mantine went 103/45 and then 77/92 — the sign of the
   * difference flipped. A "core uses twice the memory" finding was read off
   * the first of those before this note existed.
   */
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

/** Fewest frame samples that make a 95th percentile meaningful. See where it
 *  is used. */
const P95_MIN_SAMPLES = 60;

/** How far the page must already have scrolled before an anchor means
 *  anything: at `scrollY` 0 there is nothing above it to move it. */
const MIN_SCROLL_TO_ARM = 200;

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
  /**
   * Disable the browser's scroll anchoring for this run.
   *
   * ONLY the drift control sets this. Chrome compensates for content
   * inserted above the viewport by moving `scrollY`, so a stream that grows
   * upward leaves visible content perfectly still — measured on a minimal
   * repro: inserting 20 paragraphs above an anchor moved it 0px with
   * anchoring on (`scrollY` 927 -> 1607, the browser absorbing all 680px)
   * and 680px with it off (`scrollY` unchanged).
   *
   * That is why a normal run reading 0 is a real result and not a broken
   * instrument — but it is also why the control has to switch the feature
   * off, or it cannot demonstrate that the tracker responds to anything.
   * Setting it on `documentElement` alone is not enough; the property is
   * per-element, so the tracker applies it to the anchored subtree.
   */
  disableScrollAnchoring?: boolean;
  /** Grow a DOM block above the renderer's container, outside React's tree.
   *  The drift control — see the note where it is used. */
  growAboveControl?: boolean;
  /** Chunk count of this scenario, so the readout can put commits beside it. */
  chunks: number;
  /** Track mid-stream content movement. See `anchorDriftPx`. */
  trackAnchor?: boolean;
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

  const supports = (type: string): boolean =>
    (PerformanceObserver.supportedEntryTypes as readonly string[] | undefined)?.includes(type) ?? false;

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

  // Zero shifts means the callback never fires, which would leave `cls` null
  // and indistinguishable from "this engine does not report layout shift" —
  // the exact distinction this file's header promises to keep. Seed it to 0
  // only if the observer actually registered.
  let clsSum = 0;
  if (supports('layout-shift')) cls = 0;
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

  // Mutation counting. Attached lazily: the container does not exist until
  // React's first commit, and observing the document instead would count the
  // app shell's own mutations as renderer work.
  let commits = 0;
  let mutationObserver: MutationObserver | null = null;
  const attachMutationObserver = (): void => {
    if (mutationObserver !== null) return;
    const target = init.container();
    if (target === null) return;
    mutationObserver = new MutationObserver((records) => {
      // One batch of records is one delivery of work to the DOM, however
      // many nodes it touched — counting records would count node churn,
      // which is a different question and one `renderedNodes` answers.
      if (records.length > 0) commits += 1;
    });
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true });
  };

  // --- mid-stream anchor ---
  //
  // Scroll a rendered element to the middle of the viewport once the page is
  // genuinely scrollable, then never touch the scroll position again and
  // watch that element's viewport offset. Movement is content growing or
  // reflowing above it.
  //
  // MEASURED while building this, and both facts shaped the code: arming on
  // frame count armed at the top of a 900px document and reported a
  // permanent 0; and delivering the document backwards (the obvious control)
  // does not push the anchor down, it REPLACES the tree, so the anchor
  // detaches and tracking correctly stops. A control for this metric has to
  // grow content above a node that survives.
  let anchorEl: Element | null = null;
  let anchorLastTop = 0;
  let anchorDrift = 0;
  let anchorMaxJump = 0;
  let anchorArmed = false;
  let controlFiller: HTMLElement | null = null;
  /** Reported so a zero can be told from a run that stopped after one
   *  sample — see the control's note in `HarnessInit`. */
  let anchorDetached = false;

  const armAnchor = (): void => {
    if (anchorArmed || init.trackAnchor !== true) return;
    const host = init.container();
    if (host === null) return;
    // Document height, not elapsed frames: "a third of the way through the
    // stream" is not "a third of the way down the page", and the difference
    // is the whole bug this metric started with.
    if (document.documentElement.scrollHeight - window.innerHeight < window.innerHeight) return;
    const candidates: Element[] = [];
    const walk = (n: Element): void => {
      for (const c of n.children) {
        if (c.getBoundingClientRect().height > 0) candidates.push(c);
        if (candidates.length < 400) walk(c);
      }
    };
    walk(host);
    if (candidates.length < 2) return;
    const pick = candidates[Math.floor(candidates.length / 2)];
    pick.scrollIntoView({ block: 'center' });
    // The scroll must have actually happened, or the anchor is at the top
    // with nothing above it and will report zero forever.
    if (window.scrollY < MIN_SCROLL_TO_ARM) return;
    anchorEl = pick;
    anchorLastTop = pick.getBoundingClientRect().top;
    anchorArmed = true;
  };

  const sampleAnchor = (): void => {
    if (!anchorArmed || anchorEl === null) return;
    // A detached anchor is a drift event of unknown size. Stop and keep what
    // was measured rather than report a number that changed meaning.
    if (!anchorEl.isConnected) {
      anchorDetached = true;
      anchorEl = null;
      return;
    }
    const top = anchorEl.getBoundingClientRect().top;
    const jump = Math.abs(top - anchorLastTop);
    if (jump > 0.5) {
      anchorDrift += jump;
      anchorMaxJump = Math.max(anchorMaxJump, jump);
    }
    anchorLastTop = top;
  };

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
      if (drainedAt === 0) {
        frameGaps.push(gap);
        if (!anchorArmed) armAnchor();
        if (controlFiller !== null && anchorArmed) {
          // One paragraph per frame, above everything the renderer owns.
          const p = document.createElement('p');
          p.textContent = 'control filler';
          p.style.overflowAnchor = 'none';
          controlFiller.appendChild(p);
        }
        sampleAnchor();
      } else if (settledAt === null) {
        underThreshold = gap <= SETTLE_FRAME_MS ? underThreshold + 1 : 0;
        // `performance.now()`, NOT the rAF timestamp. A frame callback is
        // handed the time the FRAME began, which can precede work that ran
        // in the same task — including `onDrained()`. Subtracting the two
        // clocks produced negative settle times on the fastest scenarios
        // (measured -3 ms on `throughput-math`), i.e. exactly the cells whose
        // numbers matter most. The gap arithmetic above keeps using `now`,
        // because frame-to-frame spacing is what it means.
        if (underThreshold >= SETTLE_CONSECUTIVE) settledAt = performance.now();
        else if (performance.now() - drainedAt > SETTLE_TIMEOUT_MS) {
          outcome = 'settle-timeout';
          settledAt = performance.now();
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
    // Drain the queue before disconnecting: records delivered in the same
    // task as the final commit would otherwise be dropped and the last
    // chunk would look uncommitted.
    if (mutationObserver !== null) {
      if (mutationObserver.takeRecords().length > 0) commits += 1;
      mutationObserver.disconnect();
    }

    let scrollJankFrames: number | null = null;
    let scrollDriftPx: number | null = null;
    if (init.onScroll && outcome === 'settled') {
      const r = await init.onScroll();
      scrollJankFrames = r.jankFrames;
      scrollDriftPx = r.driftPx;
    }

    const sorted = [...frameGaps].sort((a, b) => a - b);
    // A p95 needs enough samples for the 95th percentile to be a percentile
    // rather than "the third largest value". At 38 frames — which is what a
    // 328 ms unpaced stream produces — index 36 of 38 is nearly the maximum,
    // and reporting it beside a p95 taken over 3100 frames invites a
    // comparison that is not one. Below the floor the field is null, and
    // `frames` says why. 60 is the point where the top 5% is at least three
    // samples wide.
    const p95 =
      sorted.length >= P95_MIN_SAMPLES ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
    const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
    const container = init.container();
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;

    done({
      scenario: init.scenario,
      app: init.app,
      outcome,
      shellPaintMs: lcp,
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
      // NULL, not 0, when the container is missing. A renderer that rendered
      // nothing is the best score this suite can produce on every timing
      // metric, so "0 nodes" must not be a value that compares favourably —
      // it has to be an absence the runner refuses.
      renderedNodes: container === null ? null : container.getElementsByTagName('*').length,
      foreignNodes: container === null ? null : container.querySelectorAll(FOREIGN_SELECTOR).length,
      commits,
      chunks: init.chunks,
      anchorDriftPx: anchorArmed ? Math.round(anchorDrift) : null,
      anchorDetached,
      anchorMaxJumpPx: anchorArmed ? Math.round(anchorMaxJump) : null,
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
      if (init.growAboveControl === true) {
        // THE CONTROL, and it must not touch the markdown.
        //
        // Two earlier versions prepended text to the document — first
        // backwards, then as filler paragraphs. Both changed the START of
        // the string, so the markdown re-parsed into a different tree,
        // React replaced the nodes, and the anchor detached on its FIRST
        // sample: `detached=true samples=1` against 1032 samples on a
        // normal run. The control reported 0 not because nothing moved but
        // because it measured one frame.
        //
        // This version inserts a plain DOM node ABOVE the renderer's
        // container, outside anything React owns. The rendered tree is
        // untouched, the anchor survives, and it is genuinely displaced.
        const filler = document.createElement('div');
        filler.id = 'bench-filler';
        const host = init.container();
        host?.parentElement?.insertBefore(filler, host);
        controlFiller = filler;
      }
      if (init.disableScrollAnchoring === true) {
        // A STYLESHEET, injected at stream start.
        //
        // Both earlier attempts failed for timing/scope reasons worth
        // recording. Setting `.style` inside `armAnchor` ran only once the
        // anchor armed — by which point the browser had already been
        // compensating for hundreds of frames and had the scroll position
        // pinned. Re-applying inside `sampleAnchor` never ran at all: that
        // function returns early until the anchor exists. And iterating
        // elements misses every node React inserts afterwards.
        //
        // A rule covers the whole subtree, current and future, from before
        // the first chunk. Measured on a minimal repro: with anchoring on,
        // inserting 20 paragraphs above an anchor moves it 0px while
        // `scrollY` jumps 927 -> 1607; with it off, the anchor moves the
        // full 680px.
        const style = document.createElement('style');
        style.textContent = 'html,body,#bench-container,#bench-container *{overflow-anchor:none!important}';
        document.head.appendChild(style);
      }
      startedAt = performance.now();
      attachMutationObserver();
      // The container may not exist yet on the very first frame; retry once
      // the first commit has produced it.
      requestAnimationFrame(() => attachMutationObserver());
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
 * is invisible to frame timing.
 *
 * THE CLAMP IS THE WHOLE MEASUREMENT, and getting it wrong made this metric
 * report a constant for its first day. `window.scrollTo` clamps to
 * `scrollHeight - innerHeight`; clamping the target to `scrollHeight`
 * instead compares two different maxima, so the "drift" came out as exactly
 * the viewport height on any document shorter than `steps x stepPx`
 * (measured: 884 and 900 against a 900px viewport — a binary indicator of
 * document height with no drift content at all).
 *
 * WHAT IT STILL CANNOT SEE, stated because the docstring above describes the
 * ambition rather than the code: this runs AFTER the stream has drained, so
 * the case it names — content landing above the viewport while the user
 * reads — is never exercised. It measures drift on a static document, which
 * is nearly always zero. Scrolling during the stream is the version worth
 * having and is not built.
 */
export async function scriptedScroll(steps = 30, stepPx = 400): Promise<{ jankFrames: number; driftPx: number }> {
  let jankFrames = 0;
  let last = performance.now();
  let target = 0;
  const maxScroll = (): number => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  for (let i = 0; i < steps; i++) {
    target = Math.min(maxScroll(), target + stepPx);
    window.scrollTo(0, target);
    await new Promise<void>((r) =>
      requestAnimationFrame((now) => {
        if (now - last > SETTLE_FRAME_MS) jankFrames += 1;
        last = now;
        r();
      })
    );
  }
  // Rounded: fractional device-pixel positions make an exact comparison
  // report sub-pixel "drift" that no user could see.
  return { jankFrames, driftPx: Math.round(Math.abs(window.scrollY - Math.min(target, maxScroll()))) };
}
