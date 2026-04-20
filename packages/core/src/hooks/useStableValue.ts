/**
 * Hook for referential stability of deep-equal values.
 *
 * @module hooks/useStableValue
 */

import { useRef, useLayoutEffect, useEffect } from 'react';
import isEqual from 'lodash-es/isEqual';

// Use layout effect on the client (synchronous after commit) and fall back to
// useEffect during SSR to avoid the "useLayoutEffect does nothing on the server"
// warning. Synchronous commit is what we want — it closes the window between
// commit and ref advancement where an intermediate synchronous re-render would
// otherwise see a stale cached reference.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Returns a referentially stable version of `value`.
 *
 * On each render the new value is deep-compared (via `lodash/isEqual`) against
 * the previous one. If they are structurally equal the *previous* reference is
 * returned, preventing unnecessary re-renders in downstream `useMemo` / `useEffect`
 * consumers that depend on reference equality.
 *
 * The ref is updated in a layout effect (not during render) so that the cached
 * reference only advances on COMMITTED renders. In concurrent mode a render
 * may be discarded (e.g. by Suspense); writing to the ref during render would
 * let values from discarded renders pollute the cache and leak into subsequent
 * committed renders. Layout effects run synchronously right after commit, which
 * closes the window where a same-tick re-render could otherwise observe a stale
 * `ref.current` and hand back an outdated reference.
 *
 * @typeParam T - The value type.
 * @param value - The potentially new value to stabilize.
 * @returns The previous reference when deep-equal, otherwise the new value.
 *
 * @example
 * ```tsx
 * const stableConfig = useStableValue(config);
 * // stableConfig keeps the same reference as long as config is deep-equal.
 * ```
 */
export default function useStableValue<T>(value: T): T {
  const ref = useRef(value);

  // eslint-disable-next-line react-hooks/refs
  const prev = ref.current;
  const stableValue = isEqual(prev, value) ? prev : value;

  useIsomorphicLayoutEffect(() => {
    ref.current = stableValue;
  }, [stableValue]);

  return stableValue;
}
