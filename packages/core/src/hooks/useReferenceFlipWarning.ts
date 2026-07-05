/**
 * Dev-only React hook that warns when a prop's reference identity changes
 * suspiciously often across renders — symptomatic of a caller that defined
 * the value inline instead of at module scope or behind `useMemo` /
 * `useCallback`. The wrapper of `<AIMarkdown>` uses this to flag
 * `urlTransform` and `sanitizeSchema` props that would otherwise silently
 * discard the per-block memo cache on every render.
 *
 * In production builds the entire warning logic is dead-code-eliminated:
 * the gate `typeof process !== 'undefined' && process.env.NODE_ENV !==
 * 'production'` folds to a constant `false` after bundler substitution,
 * so the body's `if (!__DEV__) return;` becomes `return undefined;` and
 * the rest is dropped. The single `useRef` allocation remains
 * (unconditional, by rules of hooks) but is harmless.
 *
 * @module hooks/useReferenceFlipWarning
 */

import { useRef } from 'react';

/** Module-scope dev flag. Bundlers fold this to a constant in production. */
const __DEV__ = typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

/** How many identity flips within {@link FLIP_WINDOW_MS} before a warning fires. */
const FLIP_THRESHOLD = 3;

/** Minimum delay between successive warnings, milliseconds. */
const WARN_COOLDOWN_MS = 5000;

/** Recency window for counting flips towards {@link FLIP_THRESHOLD},
 *  milliseconds. Occasional legitimate identity changes (feature flags,
 *  route transitions) spread across a long session must not accumulate
 *  into a false "changing on every render" warning — only a burst of
 *  FLIP_THRESHOLD flips inside this window trips it. */
const FLIP_WINDOW_MS = 2 * WARN_COOLDOWN_MS;

/** How many CONSECUTIVE flipping renders — with no stable-identity render in
 *  between — before warning regardless of wall-clock spacing. The recency
 *  window alone is blind to every-render churn in slow-cadence apps (a 6s
 *  polling dashboard passing an inline prop busts the block-memo cache on
 *  100% of renders yet never fits 3 flips into the window). Deliberately
 *  higher than {@link FLIP_THRESHOLD}: a handful of legitimate changes that
 *  each happen to arrive on consecutive renders (every render caused BY the
 *  change) must not false-positive, while sustained churn crosses this
 *  quickly. */
const SUSTAINED_FLIP_THRESHOLD = 6;

/** Internal state mutated by {@link trackFlip} across renders. */
export interface FlipState {
  prev: unknown;
  /** Timestamps of the most recent flips, oldest first. Trimmed to the last
   *  FLIP_THRESHOLD entries — enough to decide the windowed threshold. */
  flipTimes: number[];
  /** Length of the current run of consecutive renders that each flipped.
   *  Reset by any render with a stable identity. */
  consecutiveFlips: number;
  /** Timestamp of the most recent flip. Used to recognize StrictMode's
   *  double-invoke: the second call of its (flip, same-value) pair arrives
   *  within the same millisecond and must not count as a stable render. */
  lastFlipAt: number;
  lastWarnAt: number;
}

/**
 * Pure flip-counting + rate-limiting logic, exported for unit testing.
 *
 * Warns when either trigger fires: the last {@link FLIP_THRESHOLD} flips all
 * happened within {@link FLIP_WINDOW_MS} (fast burst — streaming), or
 * {@link SUSTAINED_FLIP_THRESHOLD} consecutive renders each flipped (slow
 * every-render churn the window can't see). Mutates `state` in place and
 * emits at most one `console.warn` per call. Caller supplies `now` so tests
 * can control the clock without mocking `Date.now()`.
 */
export function trackFlip(state: FlipState, value: unknown, propName: string, now: number): void {
  if (state.prev === value) {
    // A render with a stable identity ends any "flips on every render" run —
    // EXCEPT StrictMode's double-invoke: it re-runs the render function
    // immediately with the same value, so every committed flip arrives as a
    // (flip, same-value) pair within the same millisecond. Treating that
    // mirror call as a stable render would reset the run on every frame and
    // permanently disarm the sustained trigger in dev's most common setup.
    if (now > state.lastFlipAt) state.consecutiveFlips = 0;
    return;
  }
  state.prev = value;
  state.lastFlipAt = now;
  state.consecutiveFlips++;
  state.flipTimes.push(now);
  if (state.flipTimes.length > FLIP_THRESHOLD) state.flipTimes.shift();
  const burst = state.flipTimes.length >= FLIP_THRESHOLD && now - state.flipTimes[0] <= FLIP_WINDOW_MS;
  const sustained = state.consecutiveFlips >= SUSTAINED_FLIP_THRESHOLD;
  if (!burst && !sustained) return;
  if (now - state.lastWarnAt < WARN_COOLDOWN_MS) return;
  state.lastWarnAt = now;
  console.warn(
    `[AIMarkdown] \`${propName}\` reference is changing on every render. ` +
      `Define it at module scope or wrap with useMemo/useCallback to avoid ` +
      `discarding the per-block memo cache on every parent re-render.`
  );
}

/**
 * Track a value across renders and emit a dev-only warning when its
 * reference identity flips frequently.
 *
 * @param value - The prop value to monitor (function, object, or any
 *   reference type whose identity should be stable).
 * @param propName - Human-readable name used in the warning text.
 */
export default function useReferenceFlipWarning<T>(value: T, propName: string): void {
  // useRef must be called unconditionally — rules of hooks. The seed value
  // matches `value` so the first render does not count as a flip. Sentinel
  // `-Infinity` for `lastWarnAt` ensures the first warn-eligible event is
  // never blocked by the cooldown comparison.
  const stateRef = useRef<FlipState>({
    prev: value,
    flipTimes: [],
    consecutiveFlips: 0,
    lastFlipAt: -Infinity,
    lastWarnAt: -Infinity,
  });
  if (!__DEV__) return;
  // Intentional render-time `Date.now()`: this hook's whole purpose is to
  // observe wall-clock cooldowns between flip events. Routing the timestamp
  // through useMemo/useEffect would either pin it to a value-change snapshot
  // (wrong semantics for a wall-clock cooldown) or delay it by a commit
  // (loses the very render where the flip happened).
  // eslint-disable-next-line react-hooks/purity
  trackFlip(stateRef.current, value, propName, Date.now());
}
