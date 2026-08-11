/**
 * Pinned counterexample from the 2026-08-03 sharded soak (fuzz shard seed
 * 20260752, reachable in shipped v1.8.0): a raw trailing literal MERGES its
 * preceding wrap separator into itself, so the separator run after it
 * undercounts sanitize-stripped children — and a POSITION-LESS content node
 * (KaTeX output) after such a literal cannot self-validate by containment,
 * so `alignPrefixCut`'s run-length pairing mispaired it with the stripped
 * comment, inflated the trailing-gap count, and emitted a duplicate seam
 * separator (`text "\n"`) where the full parse has the tail paragraph.
 * The fix bails that shape to a full parse; this pin holds the equivalence.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const DOC =
  '<details>\n<summary>t</summary>\nbody prose\n</details>\n> a quoted line\n\n<!-- a closed comment -->\n\n$$\ne = mc^2\n\n$$\n\nprose with [a] used\n\n    <details>[a] scanned literal\n';
const SIZES = [4, 4, 4, 1, 4, 4, 4, 4];

describe('splice seam: literal-merged separator + position-less content (seed 20260752)', () => {
  test('forward and reversed schedules stay equivalent', () => {
    for (const sizes of [SIZES, [...SIZES].reverse()]) {
      const stats = assertStreamEquivalence('seam-literal-mispair', scheduleSnapshots(DOC, sizes), CATALOG[0]);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });
});
