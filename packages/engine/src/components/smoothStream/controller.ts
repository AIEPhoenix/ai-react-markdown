/**
 * Smooth-stream controller — framework-free typewriter pacing.
 *
 * Reveals an accumulated source string as a gradually growing prefix
 * (`getVisible()`), stepping by grapheme cluster at a rate that adapts to
 * backlog. The revealed prefix is append-only between snaps, which is
 * exactly the incremental-parse engine's fast path — the controller sits
 * upstream of the renderer and never touches the parse pipeline.
 *
 * Pacing model — a completion-deadline law over a gap-quantile estimator
 * (v2.10 redesign; the prior water-level jitter buffer's rationale and the
 * falsified alternatives live in the archived design plan):
 * - Every inter-arrival gap enters a small sliding window — there is NO
 *   pause classifier. The target interval Î is a high quantile of that
 *   window: two slow-gap confirmations flip the controller into a slower
 *   mode, while leaving it takes the window turning over ("cautious
 *   fast, aggressive slow").
 * - Streaming: everything on hand should be on screen by the time the
 *   next lump is expected. The horizon H = clamp(bufferFactor × Î + pad,
 *   16, maxLagMs) stamps a deadline at the last arrival + H, and
 *   rate = backlog / time-to-deadline — constant within a period, so a
 *   coarse feed reads as an even typewriter, not pour-then-crawl. The
 *   floor is a tiny anti-freeze trickle. `maxLagMs` is the preset's
 *   max-lag promise AND the pause handler: a gap beyond it saturates H
 *   and cannot change any further decision.
 * - Pre-stats (first lump after construction/snap — no gap sample yet):
 *   the backlog reveals over roughly one correction window.
 * - Finished: rate = backlog / time-to-deadline, deadline stamped at
 *   `finish()` + a rate-continuity window — the tail reveals at most
 *   ~2× the stream's measured throughput, clamped to [drainMs, 3×drainMs]
 *   — so the backlog empties BY the deadline without an end-of-message
 *   pour.
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
 * - `'smooth'` — ~1.7 delivery intervals of runway (max lag 3.5s): extra
 *   slack between server flushes, the most delivery coarseness absorbed.
 * - `'balanced'` (default) — ~1 interval of runway (max lag 2.5s): even
 *   pacing for delivery intervals up to ~2.5s at minimal lag.
 * - `'responsive'` — ~0.45 of an interval (max lag 0.8s): lowest lag,
 *   accepts visible pauses on coarse or bursty delivery.
 */
export type SmoothStreamPacing = 'smooth' | 'balanced' | 'responsive';

/** The numeric parameter bundle a {@link SmoothStreamPacing} preset names. */
export interface SmoothStreamPacingParams {
  /**
   * Horizon multiple — "periods of runway": the reveal deadline sits this
   * many expected delivery intervals after the last arrival. 1.0 means
   * everything on hand is on screen just as the next chunk is expected.
   */
  bufferFactor: number;
  /**
   * Pre-stats reveal window (ms) for the FIRST lump of a stream, before
   * any inter-arrival sample exists. The streaming path no longer reads
   * it — the v2.10 deadline law replaced the old feedback term it used to
   * time-constant.
   */
  correctionTauMs: number;
  /**
   * @deprecated Read by nothing since the v2.10 deadline-law redesign (it
   * used to be the EMA horizon AND, harmfully, the pause-classifier
   * threshold — the "1.8s cliff"). Kept in the preset objects so their
   * exported shape is unchanged; setting it has no effect.
   */
  emaTauMs: number;
  /**
   * The preset's max-lag promise (ms): the reveal DEADLINE never targets
   * more than this far behind the live source (a throttled scheduler can
   * transiently exceed it; the next tick self-corrects). It is also the
   * whole pause story —
   * a gap longer than `maxLagMs / bufferFactor` saturates the horizon and
   * cannot change any further decision. Pay-per-use: a fine-grained
   * stream's horizon tracks its own (small) cadence and never approaches
   * this cap. Full smoothing of a coarse feed requires
   * delivery-interval ≤ maxLagMs (bufferFactor ≥ 1 presets); steady mean
   * lag there is about half the delivery period.
   */
  maxLagMs?: number;
  /**
   * Anti-freeze floor (grapheme clusters/s). Deliberately tiny — smaller
   * than any realistic arrival rate — a last-resort trickle so visible
   * progress never freezes entirely while anything is pending.
   */
  minCharsPerSecond: number;
  /**
   * Drain-budget FLOOR after {@link SmoothStreamController.finish}: the
   * drain deadline is stamped at `finish()` plus a rate-continuity window
   * — enough time that the tail reveals at ~2× the stream's measured
   * throughput — clamped to `[drainMs, 3 × drainMs]`. Short backlogs
   * behave exactly as the pre-v2.10 fixed window did. Consumed when the
   * deadline is stamped — changing it affects the next drain, not one in
   * progress.
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
   * switches the control law to the rate-continuity drain window (floored
   * at `drainMs`). Not terminal — a later {@link update} resumes
   * animation.
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
      maxLagMs: 3500,
    }),
    balanced: Object.freeze({
      bufferFactor: 1.0,
      correctionTauMs: 180,
      emaTauMs: 1800,
      minCharsPerSecond: 6,
      drainMs: 240,
      maxLagMs: 2500,
    }),
    responsive: Object.freeze({
      bufferFactor: 0.45,
      correctionTauMs: 110,
      emaTauMs: 1100,
      minCharsPerSecond: 10,
      drainMs: 150,
      maxLagMs: 800,
    }),
  });

/**
 * Estimator constants. Internal, not preset fields — their derivation is
 * the documentation:
 * - `k = GAP_WINDOW − floor(GAP_WINDOW × INTERVAL_QUANTILE) = 2`: the
 *   horizon follows the 2nd-largest gap in the window, so TWO slow-gap
 *   confirmations enter a slower mode ("one slow gap is a hiccup, two are
 *   a cadence"), while leaving it takes the window turning over. Below 11
 *   samples the quantile is the window max — strictly more conservative.
 * - W=8 (k=1 always) measured too twitchy (pause-resume wobble); W=24
 *   (k=3) adapts one lump slower on every regime change. 12–16 plateau.
 */
const GAP_WINDOW = 16;
const INTERVAL_QUANTILE = 0.9;

/**
 * Horizon slack (ms), ~3 frames. With the horizon exactly equal to the
 * delivery period, a reveal must finish precisely when the next lump
 * lands — frame quantization turns that into recurring misses (measured:
 * 16% low-rate windows on alternating lump sizes; 0% with the pad). Any
 * value ≥ ~2 frames clears it; 50 keeps margin for 60→30Hz throttling.
 * A constant, not a preset field, until eye calibration produces
 * per-preset values.
 */
const HORIZON_PAD_MS = 50;

/**
 * Deadline floor (ms), ~2 frames: `deadline = max(lastArrival + H, now +
 * DEADLINE_FLOOR_MS)`. Pure guard against `deadline − t ≤ 0` — mutation
 * testing (floor 0, floor deleted, frames throttled to 600ms) changed no
 * output in any measured scenario, because the law has already streamed
 * H−floor milliseconds of the backlog by the time it could engage.
 */
const DEADLINE_FLOOR_MS = 33;

/**
 * Rate-continuity drain: the post-finish tail reveals at most about
 * DRAIN_CATCHUP_FACTOR × the stream's measured throughput, with the
 * window clamped to [drainMs, DRAIN_MAX_FACTOR × drainMs]. The reader has
 * been watching the stream's real rate; the ending may be brisker, not a
 * pour.
 */
const DRAIN_CATCHUP_FACTOR = 2;
const DRAIN_MAX_FACTOR = 3;

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

/**
 * UTF-16 units re-segmented before a resume seam. Grapheme breaking is a
 * finite-state process, so a window that starts mid-cluster re-synchronises
 * within a cluster or two and every boundary after that is right — with one
 * exception, regional indicators, handled separately below. The residual
 * risk is a single cluster longer than the window (a 30-link ZWJ chain, a
 * Zalgo pile) straddling the seam, and the cost there is one frame of odd
 * reveal granularity, never wrong text.
 */
const RESUME_LOOKBACK = 64;

const isMidSurrogatePair = (text: string, at: number): boolean =>
  at > 0 &&
  at < text.length &&
  (text.charCodeAt(at - 1) & 0xfc00) === 0xd800 &&
  (text.charCodeAt(at) & 0xfc00) === 0xdc00;

const RI_FIRST = 0x1f1e6;
const RI_LAST = 0x1f1ff;
const isRegionalIndicatorAt = (text: string, at: number): boolean => {
  const cp = text.codePointAt(at);
  return cp !== undefined && cp >= RI_FIRST && cp <= RI_LAST;
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
   * From pendingHead onward: confirmed grapheme end offsets awaiting reveal,
   * ascending, all in
   * `(visibleEnd, source.length]`. The trailing grapheme of the source is
   * NOT in here until confirmed (see module doc) — its end lives in
   * `tentativeEnd` and is re-derived whenever more text arrives.
   */
  let pending: number[] = [];
  // Retire offsets through a cursor instead of copying the entire backlog
  // each animation frame. Occasional compaction bounds retained storage.
  let pendingHead = 0;
  const pendingCount = () => pending.length - pendingHead;
  let tentativeEnd = 0;
  let finished = false;
  /**
   * An offset confirmed as a source end UNCONDITIONALLY — by `finish()`, or
   * by a `snap()` that revealed everything. Correct at the time: a finished
   * stream owes the caller every byte it has. But the controller supports
   * RESUMING (a tool call or a user turn ends the round, then more text
   * arrives), and an offset that was a source end need not be a cluster
   * boundary of the longer string. `hold` protects boundaries confirmed by
   * streaming; it never saw this one. Cleared once segmentation has
   * confirmed a boundary beyond it.
   */
  let seam: number | undefined;
  /** Deadline (clock ms) by which a finished stream must be fully revealed. */
  let drainDeadlineAt: number | undefined;
  let initialized = false;

  let visibleCache = '';
  let credit = 0;
  let lastTickAt = 0;
  let cancelFrame: (() => void) | undefined;
  let disposed = false;

  // Arrival statistics for the deadline law: a sliding window of every
  // inter-arrival gap, pauses included — classification happens at READ
  // time against the window's own distribution, never at record time
  // against a constant (the old `gap > emaTauMs` epoch guard was the
  // "1.8s cliff": the samples it dropped were exactly the ones carrying a
  // coarse cadence). Reset by snap(): a content replacement is a new
  // stream whose cadence the old samples don't describe. Empty window =
  // pre-stats regime (first lump).
  let gapWindow: { gap: number; added: number }[] = [];
  let lastArrivalAt: number | undefined;

  const listeners = new Set<() => void>();

  /** Live-resolves preset + per-field overrides, sanitizing every number. */
  const resolveParams = (): SmoothStreamPacingParams & { maxLagMs: number } => {
    // Own-key lookup, not bare indexing: a prototype key as `pacing`
    // ('toString', 'constructor') would otherwise dodge the `??` fallback
    // and hand back a Function whose fields resolve to NaN — a frozen
    // reveal in a permanent frame loop.
    const preset = Object.hasOwn(SMOOTH_STREAM_PACING_PRESETS, options.pacing as string)
      ? SMOOTH_STREAM_PACING_PRESETS[options.pacing as SmoothStreamPacing]
      : SMOOTH_STREAM_PACING_PRESETS.balanced;
    return {
      bufferFactor: finiteOr(options.bufferFactor, preset.bufferFactor),
      correctionTauMs: finiteOr(options.correctionTauMs, preset.correctionTauMs),
      emaTauMs: finiteOr(options.emaTauMs, preset.emaTauMs),
      minCharsPerSecond: finiteOr(options.minCharsPerSecond, preset.minCharsPerSecond),
      drainMs: finiteOr(options.drainMs, preset.drainMs),
      maxLagMs: finiteOr(options.maxLagMs, preset.maxLagMs ?? 2500),
    };
  };

  /**
   * Records one inter-arrival sample. Every gap enters the window —
   * pauses included; the streaming law reads a high quantile (pauses are
   * right-tail entries a bounded quantile ignores) and the drain law
   * reads a throughput mean (pauses SHOULD slow the ending — the reader
   * has been watching that slower stream). Different questions, both
   * deliberate — this asymmetry is not a bug. `added` is in UTF-16 units
   * and never enters the streaming-rate math (which is grapheme ÷ ms);
   * it only sizes the drain, where UTF-16 ÷ UTF-16 is consistent.
   */
  const recordArrival = (t: number, added: number) => {
    if (added <= 0) return;
    if (lastArrivalAt === undefined) {
      lastArrivalAt = t;
      return;
    }
    const gap = Math.max(1, t - lastArrivalAt);
    lastArrivalAt = t;
    gapWindow.push({ gap, added });
    if (gapWindow.length > GAP_WINDOW) gapWindow.shift();
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
    if (disposed || cancelFrame || pendingCount() === 0) return;
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
      rate = Math.max(params.minCharsPerSecond, (pendingCount() * 1000) / Math.max(1, drainDeadlineAt - t));
    } else if (gapWindow.length > 0 && lastArrivalAt !== undefined) {
      // Deadline regime: everything on hand should be on screen by the
      // time the next lump is expected. Backlog and time-to-deadline
      // shrink together, so the rate is constant within a period — an
      // even typewriter at any delivery coarseness the horizon covers.
      const gaps = gapWindow.map((s) => s.gap).sort((a, b) => a - b);
      const intervalQ = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * INTERVAL_QUANTILE))];
      const horizon = Math.max(16, Math.min(params.bufferFactor * intervalQ + HORIZON_PAD_MS, params.maxLagMs));
      const deadline = Math.max(lastArrivalAt + horizon, t + DEADLINE_FLOOR_MS);
      rate = Math.max(params.minCharsPerSecond, (pendingCount() * 1000) / Math.max(1, deadline - t));
    } else {
      // Pre-stats regime (first burst after construction/snap): no
      // arrival estimate yet — reveal over roughly one correction window.
      rate = Math.max(params.minCharsPerSecond, (pendingCount() * 1000) / Math.max(1, params.correctionTauMs));
    }
    credit += (rate * dt) / 1000;

    const reveal = Math.min(Math.floor(credit), pendingCount());
    if (reveal > 0) {
      visibleEnd = pending[pendingHead + reveal - 1];
      pendingHead += reveal;
      if (pendingHead === pending.length) {
        pending = [];
        pendingHead = 0;
      } else if (pendingHead >= 1024 && pendingHead * 2 >= pending.length) {
        pending = pending.slice(pendingHead);
        pendingHead = 0;
      }
      // Leftover credit only carries while a backlog remains; otherwise a
      // quiet spell would bank credit and dump the next chunk instantly.
      credit = pendingCount() > 0 ? credit - reveal : 0;
      notify();
    }
    // Re-check both guards after notify: a subscriber may have called
    // dispose() (don't schedule past it) or update() (ensureScheduled
    // already booked the next frame — booking a second would orphan its
    // cancel handle and fork the tick chain).
    if (!disposed && !cancelFrame && pendingCount() > 0) cancelFrame = schedule(tick);
  };

  /** Re-segments the unrevealed tail from the last confirmed boundary.
   *
   *  Only the LAST cluster stays tentative, because appending can merge it
   *  with what follows — with one exception: when the source ends inside a
   *  surrogate pair, that lone high surrogate is a cluster of its own, and
   *  the cluster BEFORE it would be confirmed even though the completed pair
   *  merges the two (`"👩‍👧‍👦x"` cut at 5 revealed `"👩‍"` — a break inside a
   *  cluster, which the module contract says never happens; 2026-08-19
   *  review r2 P2-6). Two clusters stay tentative there.
   *
   *  A resume needs more than that — see `seam`. The seam is dropped from
   *  the schedule if it is still only scheduled, and the tail around it is
   *  re-segmented with left context instead of from the seam itself
   *  (2026-08-20 A2). */
  const resegmentTail = () => {
    if (pendingCount() > 0 && seam !== undefined && seam < source.length && pending[pending.length - 1] === seam) {
      // Confirmed but not yet shown, and no longer a boundary we trust.
      // Only the last entry can be the seam: it is a source end, so nothing
      // confirmed later is smaller, and this runs before the new ends land.
      pending.pop();
    }
    const from = pendingCount() > 0 ? pending[pending.length - 1] : visibleEnd;
    let anchor = from;
    if (seam !== undefined && from <= seam) {
      // Text already revealed cannot be taken back — one frame showing
      // U+FFFD is the documented cost — but segmenting FROM a position
      // whose cluster break depends on what precedes it corrupts every
      // boundary after it too, and that part is avoidable. `"👩‍👧‍👦x"`
      // resumed at 4 segmented as ["\uDC67‍", "👦", "x"] and revealed the
      // family in visibly broken pieces.
      anchor = Math.max(0, from - RESUME_LOOKBACK);
      if (isMidSurrogatePair(source, anchor)) anchor -= 1;
      // GB12/GB13 pair regional indicators off from the START of their run,
      // so parity is the one thing a bounded window cannot recover. Walk the
      // whole run instead: `"🇺🇸🇬🇧🇫🇷"` resumed at 2 read 🇸 and 🇬 as one flag.
      while (anchor >= 2 && isRegionalIndicatorAt(source, anchor - 2)) anchor -= 2;
    } else {
      seam = undefined;
    }
    const ends = graphemeEnds(source.slice(anchor), anchor);
    if (ends.length === 0) {
      tentativeEnd = from;
      return;
    }
    tentativeEnd = ends[ends.length - 1];
    let hold = 1;
    if (!finished && ends.length > 1) {
      const last = source.charCodeAt(source.length - 1);
      // The completed character may merge with the cluster before the lone
      // surrogate, so that cluster's end is not settled either. Screening the
      // predecessor for "could it absorb this" is a trap: an earlier version
      // required a non-ASCII predecessor, but GB9 lets ANY character take a
      // following Extend, and the supplementary plane is full of them —
      // `a` + U+1D165 (musical symbol) and `a` + U+E0101 (variation selector
      // supplement) both revealed a bare `a` that the next frame merged away.
      // Two clusters stay tentative whenever the source ends mid-pair; the
      // cost is one cluster of extra latency for one frame.
      if (last >= 0xd800 && last <= 0xdbff) hold = 2;
    }
    const confirmedEnds = finished ? ends : ends.slice(0, -hold);
    // A backed-up anchor re-derives boundaries at or before `from`; those
    // are settled already (revealed, or still-trusted entries in `pending`).
    for (const end of confirmedEnds) if (end > from) pending.push(end);
  };

  const snap = (next: string) => {
    disposed = false;
    initialized = true;
    finished = false;
    drainDeadlineAt = undefined;
    // A replacement is a new stream: the old cadence samples are noise.
    gapWindow = [];
    lastArrivalAt = undefined;
    source = next;
    visibleEnd = next.length;
    tentativeEnd = next.length;
    pending = [];
    pendingHead = 0;
    seam = next.length;
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
      // re-seeds it. The gap WINDOW persists — same stream, likely same
      // cadence (measured: retention keeps a same-cadence resume seamless;
      // clearing it here was ablated and rejected — it degraded that
      // common case far more than it helped the rare cross-cadence one).
      lastArrivalAt = undefined;
      if (tentativeEnd > (pendingCount() > 0 ? pending[pending.length - 1] : visibleEnd)) {
        pending.push(tentativeEnd);
      }
      // Rate-continuity drain window. R̂ EXCLUDES the newest sample: the
      // closing flush this drain is being sized FOR would otherwise
      // inflate its own budget and disable the protection (measured
      // 15.2× source with it in, 5.3× with it out). Fewer than two
      // samples → no throughput estimate → today's fixed drainMs.
      const params = resolveParams();
      let drainWin = params.drainMs;
      let chars = 0;
      let ms = 0;
      for (let i = 0; i < gapWindow.length - 1; i += 1) {
        chars += gapWindow[i].added;
        ms += gapWindow[i].gap;
      }
      const backlog = source.length - visibleEnd;
      if (chars > 0 && ms > 0 && backlog > 0) {
        const throughput = (chars * 1000) / ms;
        drainWin = Math.min(
          Math.max((backlog * 1000) / (DRAIN_CATCHUP_FACTOR * throughput), params.drainMs),
          DRAIN_MAX_FACTOR * params.drainMs
        );
      }
      drainDeadlineAt = now() + drainWin;
      seam = source.length;
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
      const target = finished ? source.length : pendingCount() > 0 ? pending[pending.length - 1] : visibleEnd;
      if (target <= visibleEnd) return;
      visibleEnd = target;
      pending = [];
      pendingHead = 0;
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
