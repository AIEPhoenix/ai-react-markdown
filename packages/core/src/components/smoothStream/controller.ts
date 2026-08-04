/**
 * Smooth-stream controller — framework-free typewriter pacing.
 *
 * Reveals an accumulated source string as a gradually growing prefix
 * (`getVisible()`), stepping by grapheme cluster at a rate that adapts to
 * backlog. The revealed prefix is append-only between snaps, which is
 * exactly the incremental-parse engine's fast path — the controller sits
 * upstream of the renderer and never touches the parse pipeline.
 *
 * Pacing model (one control law, two regimes):
 * - Streaming: rate = max(charsPerSecond, backlog / catchUpWindowMs).
 *   The base rate is the floor that prevents asymptotic stall; the
 *   proportional term bounds steady-state lag to ~one window of tokens.
 * - Finished: rate = max(charsPerSecond, backlog / time-to-deadline),
 *   where the deadline is stamped at `finish() + drainMs` — the backlog
 *   empties BY the deadline instead of decaying toward it forever.
 * - A deadline credit accumulator converts elapsed time (injectable
 *   `now()`) into whole-grapheme reveals per scheduled frame — timers
 *   carry no state between frames, so throttled/paused schedulers
 *   self-correct on the next tick instead of drifting.
 *
 * Grapheme discipline: stepping uses `Intl.Segmenter` (code-point fallback)
 * and the trailing grapheme of the source is held back until it is
 * confirmed — by more text arriving or by `finish()` — so a surrogate
 * half or a still-growing emoji ZWJ sequence is never revealed to the
 * parser mid-cluster.
 *
 * @module components/smoothStream/controller
 */

export interface SmoothStreamOptions {
  /**
   * Floor reveal rate in grapheme clusters per second. Keeps the reveal
   * trickling through source pauses so the proportional term can never
   * stall asymptotically. Default `40`.
   */
  charsPerSecond?: number;
  /**
   * Catch-up window while streaming: when the backlog exceeds
   * `charsPerSecond × window`, the rate rises to drain the backlog in
   * roughly this many milliseconds, bounding steady-state lag to ~one
   * window of incoming text. Default `600`.
   */
  catchUpWindowMs?: number;
  /**
   * Hard drain budget after {@link SmoothStreamController.finish}: a
   * deadline is stamped at `finish() + drainMs` and the rate scales with
   * remaining-backlog / remaining-time, so the backlog empties BY the
   * deadline (not asymptotically) — the visible stream ends at most this
   * many milliseconds after the source does. Default `250`.
   */
  drainMs?: number;
  /**
   * Injectable clock (milliseconds, monotonic preferred). Defaults to
   * `performance.now`, falling back to `Date.now`. Tests inject a manual
   * clock — pacing must never race the wall clock.
   */
  now?: () => number;
  /**
   * Injectable frame scheduler: schedules `cb` once, ASYNCHRONOUSLY, and
   * returns a cancel function. A scheduler that invokes `cb` synchronously
   * violates the contract (the returned cancel handle would be recorded
   * after the tick already cleared it, stranding the controller). Defaults
   * to `requestAnimationFrame` with a `setTimeout` fallback so the
   * controller also runs under node.
   */
  schedule?: (cb: () => void) => () => void;
}

export interface SmoothStreamController {
  /**
   * Sets the full accumulated source. An append-extension of the current
   * source animates; anything else — the FIRST update after construction
   * included — snaps (content replacement is not a stream). An identical
   * string is a no-op, so replayed effects (StrictMode) are safe.
   * Calling `update` after {@link finish} re-enters streaming: multi-round
   * LLM flows (stream → tool call → stream) keep one controller.
   */
  update(source: string): void;
  /**
   * Signals end of stream: confirms the held-back trailing grapheme and
   * switches the control law to the `drainMs` window. Not terminal —
   * a later {@link update} resumes animation.
   */
  finish(): void;
  /** Jumps to `source` instantly, no animation, and clears any backlog. */
  snap(source: string): void;
  /** Reveals everything pending right now (skip-animation affordance). */
  flush(): void;
  /** Subscribes to visible-prefix changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * The currently revealed prefix. Reference-stable between changes —
   * safe as a `useSyncExternalStore` snapshot.
   */
  getVisible(): string;
  /** True when the visible prefix has caught up with the full source. */
  isDrained(): boolean;
  /**
   * Cancels any scheduled frame and drops all subscribers. NOT terminal:
   * any subsequent call ({@link update}, {@link subscribe}, …) revives the
   * controller. React StrictMode's dev-only effect replay (mount → cleanup
   * → re-run) disposes and then reuses the same state-held instance — a
   * permanently-latching dispose would kill the reveal in dev forever.
   * After a REAL unmount nothing calls back in, so disposal sticks.
   */
  dispose(): void;
}

const DEFAULT_CHARS_PER_SECOND = 40;
const DEFAULT_CATCH_UP_WINDOW_MS = 600;
const DEFAULT_DRAIN_MS = 250;

const defaultNow: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

const defaultSchedule = (cb: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => cb());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 16);
  return () => clearTimeout(id);
};

/**
 * Pacing knobs must be FINITE numbers. NaN is a `number` to TypeScript
 * (`charsPerSecond={parseInt(missing)}` type-checks), and `Math.max`
 * propagates NaN instead of guarding it — one poisoned knob would freeze
 * the reveal in a permanent no-op frame loop. Infinity is rejected too:
 * `Infinity × 0` on a zero-dt tick is NaN by another road.
 */
const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

/**
 * Absolute end offsets (UTF-16 units) of each grapheme cluster in
 * `text`, offset by `base`. Fallback iterates code points, which still
 * never splits a surrogate pair (ZWJ sequences may step in parts).
 */
const graphemeEnds = (text: string, base: number): number[] => {
  const ends: number[] = [];
  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      ends.push(base + part.index + part.segment.length);
    }
  } else {
    let offset = base;
    for (const cp of text) {
      offset += cp.length;
      ends.push(offset);
    }
  }
  return ends;
};

export const createSmoothStreamController = (options: SmoothStreamOptions = {}): SmoothStreamController => {
  // Option fields are read each tick, so a caller that keeps the object
  // and replaces field values retunes pacing live (the hook relies on
  // this to reflect prop changes without controller churn).
  const now = options.now ?? defaultNow;
  const schedule = options.schedule ?? defaultSchedule;

  let source = '';
  /** UTF-16 offset of the revealed prefix's end. */
  let visibleEnd = 0;
  /**
   * Confirmed grapheme end offsets awaiting reveal, ascending, all in
   * `(visibleEnd, source.length]`. The trailing grapheme of the source is
   * NOT in here until confirmed (see module doc) — its end lives in
   * `tentativeEnd` and is re-derived whenever more text arrives.
   */
  let pending: number[] = [];
  let tentativeEnd = 0;
  let finished = false;
  /** Deadline (clock ms) by which a finished stream must be fully revealed. */
  let drainDeadlineAt: number | undefined;
  let initialized = false;

  let visibleCache = '';
  let credit = 0;
  let lastTickAt = 0;
  let cancelFrame: (() => void) | undefined;
  let disposed = false;

  const listeners = new Set<() => void>();

  const notify = () => {
    visibleCache = source.slice(0, visibleEnd);
    for (const listener of [...listeners]) listener();
  };

  const cancelScheduled = () => {
    cancelFrame?.();
    cancelFrame = undefined;
  };

  const ensureScheduled = () => {
    if (disposed || cancelFrame || pending.length === 0) return;
    lastTickAt = now();
    credit = 0;
    cancelFrame = schedule(tick);
  };

  const tick = () => {
    cancelFrame = undefined;
    if (disposed) return;
    const t = now();
    const dt = Math.max(0, t - lastTickAt);
    lastTickAt = t;

    const base = finiteOr(options.charsPerSecond, DEFAULT_CHARS_PER_SECOND);
    // While streaming: proportional catch-up over a fixed window (steady-
    // state lag ≈ one window of tokens). After finish(): remaining-backlog
    // over remaining-time-to-deadline, which reaches zero BY the deadline
    // instead of decaying asymptotically toward it.
    const windowMs =
      finished && drainDeadlineAt !== undefined
        ? Math.max(1, drainDeadlineAt - t)
        : finiteOr(options.catchUpWindowMs, DEFAULT_CATCH_UP_WINDOW_MS);
    const rate = Math.max(base, (pending.length * 1000) / Math.max(1, windowMs));
    credit += (rate * dt) / 1000;

    const reveal = Math.min(Math.floor(credit), pending.length);
    if (reveal > 0) {
      visibleEnd = pending[reveal - 1];
      pending = pending.slice(reveal);
      // Leftover credit only carries while a backlog remains; otherwise a
      // quiet spell would bank credit and dump the next chunk instantly.
      credit = pending.length > 0 ? credit - reveal : 0;
      notify();
    }
    // Re-check both guards after notify: a subscriber may have called
    // dispose() (don't schedule past it) or update() (ensureScheduled
    // already booked the next frame — booking a second would orphan its
    // cancel handle and fork the tick chain).
    if (!disposed && !cancelFrame && pending.length > 0) cancelFrame = schedule(tick);
  };

  /** Re-segments the unrevealed tail from the last confirmed boundary. */
  const resegmentTail = () => {
    const from = pending.length > 0 ? pending[pending.length - 1] : visibleEnd;
    const ends = graphemeEnds(source.slice(from), from);
    if (ends.length === 0) {
      tentativeEnd = from;
      return;
    }
    tentativeEnd = ends[ends.length - 1];
    const confirmedEnds = finished ? ends : ends.slice(0, -1);
    for (const end of confirmedEnds) pending.push(end);
  };

  const snap = (next: string) => {
    disposed = false;
    initialized = true;
    finished = false;
    drainDeadlineAt = undefined;
    source = next;
    visibleEnd = next.length;
    tentativeEnd = next.length;
    pending = [];
    credit = 0;
    cancelScheduled();
    if (visibleCache !== next) notify();
  };

  /**
   * Un-latches a disposed controller AND reschedules any surviving
   * backlog. Rescheduling here is load-bearing: the StrictMode replay
   * re-runs effects with UNCHANGED props, so `update` takes its
   * identical-string early-return and `finish` its already-finished one —
   * neither would reach ensureScheduled on its own, and a mid-animation
   * backlog would freeze forever.
   */
  const revive = () => {
    if (!disposed) return;
    disposed = false;
    ensureScheduled();
  };

  return {
    update(next: string) {
      revive();
      if (initialized && next === source) return;
      if (!initialized || !next.startsWith(source)) {
        snap(next);
        return;
      }
      finished = false;
      drainDeadlineAt = undefined;
      source = next;
      resegmentTail();
      ensureScheduled();
    },
    finish() {
      revive();
      if (finished) return;
      finished = true;
      drainDeadlineAt = now() + finiteOr(options.drainMs, DEFAULT_DRAIN_MS);
      if (tentativeEnd > (pending.length > 0 ? pending[pending.length - 1] : visibleEnd)) {
        pending.push(tentativeEnd);
      }
      ensureScheduled();
    },
    snap,
    flush() {
      disposed = false;
      if (visibleEnd === source.length) return;
      visibleEnd = source.length;
      tentativeEnd = source.length;
      pending = [];
      credit = 0;
      cancelScheduled();
      notify();
    },
    subscribe(listener: () => void) {
      revive();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVisible: () => visibleCache,
    isDrained: () => visibleEnd === source.length,
    dispose() {
      disposed = true;
      cancelScheduled();
      listeners.clear();
    },
  };
};
