/**
 * CDATA analog of the PI-swallow pins (post-2.3.0 hardening): parse5 ends
 * `<![CDATA[` in HTML content as a bogus comment at the FIRST `>` while
 * micromark's kind-5 construct runs to `]]>` — a CDATA with an interior
 * `>` (`<![CDATA[<b>inner]]>`) leaves a position-less text remnant after
 * sanitize strips the bogus comment — the same stranded-remnant CLASS the
 * cut's look-ahead bail guards (the bail is construct-agnostic; the PI
 * pins are what kill its deletion).
 *
 * Scope honesty: these schedules never reach the bail itself (verified —
 * they stay green under a deleted-bail mutant; the detector's seam-pending
 * rejection intercepts the CDATA stranding earlier than the PI variant,
 * which is also why 1.7M discovery samples never produced a CDATA
 * counterexample). They are EQUIVALENCE guards over the CDATA remnant
 * shapes: a future detector or splice change that mishandles this class
 * turns them red first.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

// Mirrors the seed-20260821 PI counterexample skeleton with CDATA swapped in.
const DOC_HEADED =
  '<i>y</i> <![CDATA[x\n\n<![CDATA[<b>inner]]> after the cdata\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n- tight one\n- tight two\n\nplain prose keeps flowing here\n';

// Single-line CDATA with interior `>` followed by reference machinery.
const DOC_INLINE =
  '<![CDATA[<div>data</div>]]> trailing prose\n\n[^a]: body text\n\nref [^a] appears\n\n[a]: https://example.com/a\n';

const SCHEDULES: number[][] = [
  [4, 4, 4, 1, 4, 4, 4, 1],
  [4, 4, 4, 4, 4, 4, 4, 4],
  [7, 3, 5, 2, 6, 4, 8, 1],
];

describe('splice seam: CDATA bogus-comment remnant stays equivalent', () => {
  test.each(SCHEDULES.map((s, i) => [i, s] as const))('headed doc, schedule %#', (_i, sizes) => {
    for (const s of [sizes, [...sizes].reverse()]) {
      const stats = assertStreamEquivalence('cdata-remnant-headed', scheduleSnapshots(DOC_HEADED, s), CATALOG[0]);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });

  test.each(SCHEDULES.map((s, i) => [i, s] as const))('inline doc, schedule %#', (_i, sizes) => {
    for (const s of [sizes, [...sizes].reverse()]) {
      const stats = assertStreamEquivalence('cdata-remnant-inline', scheduleSnapshots(DOC_INLINE, s), CATALOG[0]);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });
});
