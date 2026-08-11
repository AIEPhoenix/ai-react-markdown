/**
 * Pinned counterexample from the 2026-08-12 engine-split mega-fuzz (seed
 * 20260838 shard 8, reproduced verbatim on pre-split v2.2.1 — pre-existing,
 * not a split regression): `<details>` raw block followed by a blockquote
 * line and a multi-line self-closing `<embed/>` — the incremental parse
 * emits the seam text node (`"\n> a quoted line\n"`) with the right VALUE
 * but no `position`, where the full parse carries one. Position loss is a
 * real hazard: block-memo keys caches by source offsets and the
 * positionPropagation guard exists precisely for this class.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const DOC =
  '<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n<embed\n  src="x"\n/>\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n[a]: https://example.com/a\n\ninline `<div>` stays code\n\nplain prose keeps flowing here\n';
const SIZES = [4, 4, 4, 4, 4, 4, 4, 4];

describe('splice seam: raw-block seam text node drops its position (seed 20260838)', () => {
  test('forward and reversed schedules stay equivalent', () => {
    for (const sizes of [SIZES, [...SIZES].reverse()]) {
      const stats = assertStreamEquivalence('seam-position-loss', scheduleSnapshots(DOC, sizes), CATALOG[0]);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });
});
