/**
 * The stability firewall: single-boundary, table-driven reference
 * stabilization of object-valued props (EXECUTION-PLAN §3.9).
 *
 * Replaces scattered per-prop `useStableValue` calls with ONE hook whose
 * behavior per key is declared in a module-scope policy table. Layering
 * rule: below the firewall, internal code never stabilizes again —
 * reference equality is trusted outright.
 *
 * The table is the complete roster of object-valued props:
 * {@link AIMarkdownStabilityTable} is `Required<Record<keyof T, …>>`, so
 * adding an object prop without registering it is a compile error.
 * Exemption ({@link AIMarkdownStabilityPolicy.PASS_THROUGH}) and omission
 * (missing row) are thereby distinguishable — exemption is a decision,
 * a missing row is an omission.
 *
 * @module hooks/useStableRecord
 */

import { useRef, useLayoutEffect, useEffect } from 'react';
import isEqual from 'lodash-es/isEqual';

/** Module-scope dev flag — resolved at build time (see `useReferenceFlipWarning`'s docblock). */
const __DEV__ = process.env.NODE_ENV !== 'production';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Stabilization policy tiers. Publicly exported; wrappers reuse it for
 * their own tables (a wrapper builds a table only for object props it
 * *terminates* — forwarded props ride core's firewall untouched).
 */
export enum AIMarkdownStabilityPolicy {
  /**
   * Deep-equal backstop: when the reference changed, deep-compare; if the
   * contents are deep-equal, reuse the previous reference. For
   * structurally comparable data values. In dev, high-frequency
   * "deep-equal restores" warn — the caller is inlining objects; caches
   * stay warm, but every render pays one deep comparison.
   */
  DEEP_EQUAL = 'DEEP_EQUAL',
  /**
   * No comparison; dev-mode flip-rate probe only. For function and
   * component values — deep-comparing closures is meaningless; the
   * contract requires the caller to hold a stable reference.
   */
  WARN_ONLY = 'WARN_ONLY',
  /**
   * Explicit pass-through: no comparison, no probe. For deliberately
   * exempted props (e.g. `metadata`: opaque shape, potentially huge,
   * unbounded comparison cost — stabilization is the consumer's
   * responsibility).
   */
  PASS_THROUGH = 'PASS_THROUGH',
}

/**
 * Policy table for a record of object-valued props. `Required` makes the
 * table the complete roster: every key of `T` must carry a policy row.
 */
export type AIMarkdownStabilityTable<T extends object> = Required<Record<keyof T, AIMarkdownStabilityPolicy>>;

/**
 * Pure per-render stabilization step, exported for unit testing (the hook
 * wraps it with the committed-render ref discipline).
 *
 * Iterates the TABLE's keys (the roster is authoritative; keys of `record`
 * outside the table do not exist type-wise and are dropped). When no key's
 * output differs from `prev`, returns `prev` itself so the record keeps
 * its object identity — directly usable as a context value.
 */
export function stabilizeRecord<T extends object>(prev: T, record: T, table: AIMarkdownStabilityTable<T>): T {
  let changed = false;
  const out = {} as Record<PropertyKey, unknown>;
  for (const key of Object.keys(table) as (keyof T)[]) {
    const next = record[key];
    const before = prev[key];
    let value = next;
    if (table[key] === AIMarkdownStabilityPolicy.DEEP_EQUAL && next !== before && isEqual(before, next)) {
      value = before;
    }
    out[key] = value;
    if (value !== before) {
      changed = true;
    }
  }
  return changed ? (out as T) : prev;
}

/** How many probe hits before the first warning fires. */
const HIT_THRESHOLD = 3;

/** Minimum delay between successive warnings per key, milliseconds. */
const WARN_COOLDOWN_MS = 5000;

interface ProbeState {
  prev: unknown;
  hits: number;
  lastWarnAt: number;
}

/**
 * Rate-limited dev probe shared by the two warning tiers. Mirrors the
 * threshold/cooldown semantics of `useReferenceFlipWarning`'s `trackFlip`.
 */
function probeHit(state: ProbeState, message: string, now: number): void {
  state.hits++;
  if (state.hits < HIT_THRESHOLD) return;
  if (now - state.lastWarnAt < WARN_COOLDOWN_MS) return;
  state.lastWarnAt = now;
  console.warn(message);
}

/**
 * Returns a stabilized version of `record` according to `table`.
 *
 * - The loop lives inside the hook (static hook count — rules-compliant
 *   regardless of table size).
 * - The previous-value ref advances in a post-commit layout effect,
 *   identical to `useStableValue`'s concurrent-safety discipline:
 *   discarded renders never pollute the cache.
 * - When no key changed, the output object keeps its identity.
 *
 * `table` must be a module-scope constant: the roster (and each key's
 * policy) is fixed for the lifetime of the call site.
 */
export default function useStableRecord<T extends object>(record: T, table: AIMarkdownStabilityTable<T>): T {
  const ref = useRef(record);
  const probesRef = useRef<Record<string, ProbeState> | null>(null);

  const prev = ref.current;
  const stable = stabilizeRecord(prev, record, table);

  if (__DEV__) {
    const probes = (probesRef.current ??= {});
    // Intentional render-time `Date.now()`: wall-clock cooldown between
    // probe events, same rationale as `useReferenceFlipWarning`.
    const now = Date.now();
    for (const key of Object.keys(table) as (keyof T)[]) {
      const policy = table[key];
      if (policy === AIMarkdownStabilityPolicy.PASS_THROUGH) continue;
      const next = record[key];
      const state = (probes[String(key)] ??= { prev: next, hits: 0, lastWarnAt: -Infinity });
      if (state.prev !== next) {
        if (policy === AIMarkdownStabilityPolicy.WARN_ONLY) {
          probeHit(
            state,
            `[AIMarkdown] \`${String(key)}\` reference is changing on every render. ` +
              `This prop's contract requires a stable reference — define it at module ` +
              `scope or wrap it with useMemo/useCallback.`,
            now
          );
        } else if ((stable as Record<keyof T, unknown>)[key] !== next) {
          // DEEP_EQUAL tier: the stabilizer restored the previous reference,
          // i.e. the caller re-built a deep-equal object this render.
          probeHit(
            state,
            `[AIMarkdown] \`${String(key)}\` is re-created on every render with deep-equal ` +
              `contents — the caller is likely inlining the value. Caches stay warm, but ` +
              `every render pays one deep comparison; define it at module scope or memoize it.`,
            now
          );
        }
        state.prev = next;
      }
    }
  }

  useIsomorphicLayoutEffect(() => {
    ref.current = stable;
  }, [stable]);

  return stable;
}
