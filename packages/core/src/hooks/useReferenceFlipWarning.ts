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
const __DEV__ =
  typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';

/** How many identity flips before the first warning fires. */
const FLIP_THRESHOLD = 3;

/** Minimum delay between successive warnings, milliseconds. */
const WARN_COOLDOWN_MS = 5000;

/** Internal state mutated by {@link trackFlip} across renders. */
export interface FlipState {
  prev: unknown;
  flips: number;
  lastWarnAt: number;
}

/**
 * Pure flip-counting + rate-limiting logic, exported for unit testing.
 *
 * Mutates `state` in place and emits at most one `console.warn` per call.
 * Caller supplies `now` so tests can control the clock without mocking
 * `Date.now()`.
 */
export function trackFlip(
  state: FlipState,
  value: unknown,
  propName: string,
  now: number
): void {
  if (state.prev === value) return;
  state.flips++;
  state.prev = value;
  if (state.flips < FLIP_THRESHOLD) return;
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
  const stateRef = useRef<FlipState>({ prev: value, flips: 0, lastWarnAt: -Infinity });
  if (!__DEV__) return;
  // Intentional render-time `Date.now()`: this hook's whole purpose is to
  // observe wall-clock cooldowns between flip events. Routing the timestamp
  // through useMemo/useEffect would either pin it to a value-change snapshot
  // (wrong semantics for a wall-clock cooldown) or delay it by a commit
  // (loses the very render where the flip happened).
  // eslint-disable-next-line react-hooks/purity
  trackFlip(stateRef.current, value, propName, Date.now());
}
