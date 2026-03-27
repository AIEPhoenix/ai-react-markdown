/**
 * Hook for referential stability of deep-equal values.
 *
 * @module hooks/useStableValue
 */

import { useRef, useEffect } from 'react';
import isEqual from 'lodash-es/isEqual';

/**
 * Returns a referentially stable version of `value`.
 *
 * On each render the new value is deep-compared (via `lodash/isEqual`) against
 * the previous one. If they are structurally equal the *previous* reference is
 * returned, preventing unnecessary re-renders in downstream `useMemo` / `useEffect`
 * consumers that depend on reference equality.
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

  useEffect(() => {
    ref.current = stableValue;
  }, [stableValue]);

  return stableValue;
}
