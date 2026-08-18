/**
 * Smooth-stream controller — framework-free typewriter pacing.
 *
 * Reveals an accumulated source string as a gradually growing prefix
 * (`getVisible()`), stepping by grapheme cluster at a rate that adapts to
 * backlog. The revealed prefix is append-only between snaps, which is
 * exactly the incremental-parse engine's fast path — the controller sits
 * upstream of the renderer and never touches the parse pipeline.
 *
 * Pacing model — an adaptive jitter buffer (audio-playout style):
 * - The controller estimates the source's arrival rate and burst interval
 *   with irregular-sampling EMAs (recorded on every append), and derives a
 *   target buffer B* ≈ bufferFactor × one burst's worth of text — the
 *   causality floor for smoothing bursts of that period.
 * - Streaming: rate = max(floor, rateEma + (backlog − B*) / correctionTau).
 *   Feedforward tracks the source speed (bounded lag at any model speed);
 *   the feedback term pins the backlog near B*, dipping BELOW the source
 *   rate on purpose when the buffer runs low so it can refill instead of
 *   running dry between bursts. The floor is a tiny anti-freeze trickle,
 *   deliberately smaller than any realistic arrival rate.
 * - Pre-stats (first burst after construction/snap): no estimate exists
 *   yet, so the backlog reveals over roughly one correction window.
 * - Finished: rate = backlog / time-to-deadline, deadline stamped at
 *   `finish() + drainMs` — the backlog empties BY the deadline instead of
 *   decaying toward it forever.
 * - A deadline credit accumulator converts elapsed time (injectable
 *   `now()`) into whole-grapheme reveals per scheduled frame — timers
 *   carry no state between frames, so throttled/paused schedulers
 *   self-correct on the next tick instead of drifting.
 * - The public tuning surface is three named presets ({@link SmoothStreamPacing});
 *   the numeric parameters stay controller-level for advanced hosts.
 *
 * Grapheme discipline: stepping uses `Intl.Segmenter` (code-point fallback)
 * and the trailing grapheme of the source is held back until it is
 * confirmed — by more text arriving or by `finish()` — so a surrogate
 * half or a still-growing emoji ZWJ sequence is never revealed to the
 * parser mid-cluster. `snap()` (a replacement, or the very first `update`)
 * is outside this promise by design: it shows the whole replacement text
 * at once, trailing half-cluster included — a hold-back there would leave
 * a controller that never drains when nothing follows (v2.4.2 review
 * P3-1). Hosts that seed a stream mid-cluster get one frame of U+FFFD.
 *
 * @module components/smoothStream/controller
 */

/**
 * The public pacing surface: three named trade-off points on the
 * latency-vs-smoothness axis (the audio-plugin buffer-preset convention —
 * perceptual parameters resist meaningful numeric tuning).
 *
 * - `'smooth'` — target ~1.7 bursts of buffer: almost never runs dry
 *   between server flushes, at the cost of a little extra lag.
 * - `'balanced'` (default) — ~1 burst of buffer, the causality floor for
 *   smoothing: minimal lag that can still bridge a typical gap.
 * - `'responsive'` — sub-burst buffer: lowest lag, accepts an occasional
 *   visible pause between bursts.
 */
export type SmoothStreamPacing = 'smooth' | 'balanced' | 'responsive';

/** The numeric parameter bundle a {@link SmoothStreamPacing} preset names. */
export interface SmoothStreamPacingParams {
  /** Target buffer as a multiple of one estimated burst's worth of text. */
  bufferFactor: number;
  /**
   * Feedback time constant (ms): how fast the backlog is steered toward
   * the target buffer. Also the pre-stats reveal window for the first
   * burst, before any arrival estimate exists.
   */
  correctionTauMs: number;
  /** Smoothing horizon (ms) for the arrival-rate / burst-interval EMAs. */
  emaTauMs: number;
  /**
   * Anti-freeze floor (grapheme clusters/s). Deliberately tiny — smaller
   * than any realistic arrival rate — so the feedback term can slow the
   * reveal below the source rate to refill the buffer, without ever
   * freezing visible progress entirely.
   */
  minCharsPerSecond: number;
  /**
   * Hard drain budget after {@link SmoothStreamController.finish}: a
   * deadline is stamped at `finish() + drainMs` and the rate scales with
   * remaining-backlog / remaining-time, so the backlog empties BY the
   * deadline (not asymptotically). Consumed when the deadline is stamped —
   * changing it affects the next drain, not one in progress.
   */
  drainMs: number;
}

export interface SmoothStreamOptions extends Partial<SmoothStreamPacingParams> {
  /**
   * Named pacing preset, the intended tuning surface. Individual
   * {@link SmoothStreamPacingParams} fields act as advanced per-field
   * overrides on top of the chosen preset. Default `'balanced'`.
   */
  pacing?: SmoothStreamPacing;
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
  /** Jumps to `source` instantly, no animation, and clears any backlog.
   *  No trailing-grapheme hold-back (see the module docs). */
  snap(source: string): void;
  /**
   * Reveals everything pending right now (skip-animation affordance). Keeps
   * the grapheme discipline: while the stream is not finished, the trailing
   * grapheme of the source stays held back exactly as the animation would
   * hold it (a surrogate half or a growing ZWJ sequence must never reach
   * the parser); {@link finish} or the next {@link update} confirms it.
   */
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

/**
 * The three preset bundles. Calibrated against the burst patterns in the
 * SmoothStream stories (server-buffer-like flushes at slow and fast model
 * speeds); frozen so a shared reference can't be mutated by a consumer.
 */
export const SMOOTH_STREAM_PACING_PRESETS: Readonly<Record<SmoothStreamPacing, Readonly<SmoothStreamPacingParams>>> =
  Object.freeze({
    smooth: Object.freeze({
      bufferFactor: 1.7,
      correctionTauMs: 280,
      emaTauMs: 2600,
      minCharsPerSecond: 4,
      drainMs: 320,
    }),
    balanced: Object.freeze({
      bufferFactor: 1.0,
      correctionTauMs: 180,
      emaTauMs: 1800,
      minCharsPerSecond: 6,
      drainMs: 240,
    }),
    responsive: Object.freeze({
      bufferFactor: 0.45,
      correctionTauMs: 110,
      emaTauMs: 1100,
      minCharsPerSecond: 10,
      drainMs: 150,
    }),
  });

/**
 * Absolute ceiling on the target buffer, expressed as milliseconds of lag
 * at the estimated rate. Guards against a skewed interval estimate (one
 * pathological gap) demanding seconds of buffered text. Internal — not a
 * preset field because no preset should ever want to move it.
 */
const MAX_TARGET_BUFFER_MS = 1200;

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
 * (`{ minCharsPerSecond: parseInt(missing) }` type-checks), and `Math.max`
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

  // Arrival statistics for the adaptive law. Reset by snap(): a content
  // replacement is a new stream whose cadence the old estimates don't
  // describe. `undefined` = pre-stats regime (first burst).
  let rateEma: number | undefined;
  let intervalEma: number | undefined;
  let lastArrivalAt: number | undefined;

  const listeners = new Set<() => void>();

  /** Live-resolves preset + per-field overrides, sanitizing every number. */
  const resolveParams = (): SmoothStreamPacingParams => {
    const preset =
      SMOOTH_STREAM_PACING_PRESETS[options.pacing as SmoothStreamPacing] ?? SMOOTH_STREAM_PACING_PRESETS.balanced;
    return {
      bufferFactor: finiteOr(options.bufferFactor, preset.bufferFactor),
      correctionTauMs: finiteOr(options.correctionTauMs, preset.correctionTauMs),
      emaTauMs: finiteOr(options.emaTauMs, preset.emaTauMs),
      minCharsPerSecond: finiteOr(options.minCharsPerSecond, preset.minCharsPerSecond),
      drainMs: finiteOr(options.drainMs, preset.drainMs),
    };
  };

  /**
   * Irregular-sampling EMA update: α = 1 − e^(−gap/τ) weighs each sample
   * by the time it spans, so bursty arrival timing doesn't bias the
   * estimates the way a fixed-α EMA would. `added` is in UTF-16 units —
   * close enough to the grapheme-denominated backlog for control purposes
   * (emoji-heavy text mildly over-estimates the rate, which only pads the
   * buffer).
   */
  const recordArrival = (t: number, added: number) => {
    if (added <= 0) return;
    if (lastArrivalAt === undefined) {
      lastArrivalAt = t;
      return;
    }
    const gap = Math.max(1, t - lastArrivalAt);
    lastArrivalAt = t;
    const tau = Math.max(1, resolveParams().emaTauMs);
    // A gap longer than the smoothing horizon is a PAUSE, not cadence: at
    // that length α → 1 and this one sample would rewrite both estimates
    // (R̂ → ~0, Î → the pause), making the resume crawl at the floor while
    // B* pegs at its cap, then whoosh when Î decays. Start a new epoch
    // instead — keep the pre-pause estimates and let normal samples adapt.
    if (gap > tau) return;
    const alpha = 1 - Math.exp(-gap / tau);
    const instantRate = (added * 1000) / gap;
    // Zero-prior blend, no assignment special case: the FIRST sample also
    // enters at weight α, so a connect-flush pair ~1ms apart seeds a
    // bounded estimate instead of `added × 1000` chars/s (which would
    // track a phantom rate and disable smoothing for seconds). Early
    // under-estimation is harmless — with small R̂ the adaptive law
    // algebraically coincides with the pre-stats reveal.
    rateEma = (rateEma ?? 0) + alpha * (instantRate - (rateEma ?? 0));
    intervalEma = (intervalEma ?? 0) + alpha * (gap - (intervalEma ?? 0));
  };

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

    const params = resolveParams();
    let rate: number;
    if (finished && drainDeadlineAt !== undefined) {
      // Drain regime: remaining backlog over remaining time-to-deadline —
      // reaches zero BY the deadline instead of decaying asymptotically.
      rate = Math.max(params.minCharsPerSecond, (pending.length * 1000) / Math.max(1, drainDeadlineAt - t));
    } else if (rateEma !== undefined && intervalEma !== undefined) {
      // Adaptive regime: feedforward on the estimated source rate,
      // feedback steering the backlog toward the target buffer. The
      // feedback dips below the source rate on purpose when the buffer
      // runs low — that is how it refills instead of running dry.
      // Clamp order matters: the "at least one grapheme" floor applies
      // AFTER the lag cap, so a tiny-R̂ stream cannot end up with a
      // sub-1 target.
      const targetBuffer = Math.max(
        1,
        Math.min(params.bufferFactor * rateEma * (intervalEma / 1000), (rateEma * MAX_TARGET_BUFFER_MS) / 1000)
      );
      rate = Math.max(
        params.minCharsPerSecond,
        rateEma + ((pending.length - targetBuffer) * 1000) / Math.max(1, params.correctionTauMs)
      );
    } else {
      // Pre-stats regime (first burst after construction/snap): no
      // arrival estimate yet — reveal over roughly one correction window.
      rate = Math.max(params.minCharsPerSecond, (pending.length * 1000) / Math.max(1, params.correctionTauMs));
    }
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
    // A replacement is a new stream: the old cadence estimates are noise.
    rateEma = undefined;
    intervalEma = undefined;
    lastArrivalAt = undefined;
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
      const previousLength = source.length;
      source = next;
      resegmentTail();
      recordArrival(now(), next.length - previousLength);
      ensureScheduled();
    },
    finish() {
      revive();
      if (finished) return;
      finished = true;
      // The pause between rounds (tool call, user turn) must never become
      // a gap sample: drop the arrival clock so the resume's first update
      // re-seeds it. The EMAs persist — same stream, likely same cadence.
      lastArrivalAt = undefined;
      drainDeadlineAt = now() + resolveParams().drainMs;
      if (tentativeEnd > (pending.length > 0 ? pending[pending.length - 1] : visibleEnd)) {
        pending.push(tentativeEnd);
      }
      ensureScheduled();
    },
    snap,
    flush() {
      disposed = false;
      // Unfinished stream: the unconfirmed trailing grapheme (`tentativeEnd`,
      // never in `pending`) stays held — revealing it here would expose a
      // possibly-broken cluster to the parser, the one thing the module's
      // grapheme discipline promises never happens (2026-08 project review,
      // eng-stream-04). Finished streams have confirmed it into `pending`.
      const target = finished ? source.length : pending.length > 0 ? pending[pending.length - 1] : visibleEnd;
      if (target <= visibleEnd) return;
      visibleEnd = target;
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
