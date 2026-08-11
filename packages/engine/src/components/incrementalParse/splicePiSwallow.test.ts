/**
 * Pinned counterexamples from the 2026-08-12 engine-split mega-fuzz
 * (seeds 20260821 shard 10 / 20260893 shard 3, both reproduced verbatim on
 * pre-split v2.2.1 — pre-existing, not a split regression): when a
 * processing instruction (`<?instr … ?>`) sits at the head of a raw-HTML
 * flow block and the freeze boundary lands inside it, the incremental
 * parse swallows the text after the PI's closer (`" ?> after the pi\n"`
 * degrades to `"\n"`). Same failure under CATALOG[0] (hazard run) and the
 * defaults-all-on config (benign run) — one root cause, two entry points.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const DOC_HAZARD =
  '<i>y</i> <?php\n\n<?instr <b> ?> after the pi\n\n[^a]: body text\n\n    indented continuation\n\n[a]: https://example.com/a\n\n- tight one\n- tight two\n\n$$\ne = mc^2\n\n$$\n\n<![CDATA[<div>data</div>]]> trailing prose\n\n<b>x</b> <!-- trailing opener\n';
const SIZES_HAZARD = [4, 4, 4, 1, 4, 4, 4, 1];

const DOC_BENIGN =
  '<i>y</i> <?php\n\n<?instr <b> ?> after the pi\n\n[^a]: body text\n\n    indented continuation\n\n<!-- a closed comment -->\n\n[^a]: body text\n\ninline `<div>` stays code\n';
const SIZES_BENIGN = [4, 1, 4, 4, 4, 4, 4, 4];
const CONFIG_BENIGN = CATALOG[52601443 % CATALOG.length];

describe('splice seam: PI-headed raw block swallows post-closer text', () => {
  test('seed 20260821 shape (hazard, CATALOG[0])', () => {
    for (const sizes of [SIZES_HAZARD, [...SIZES_HAZARD].reverse()]) {
      const stats = assertStreamEquivalence('pi-swallow-hazard', scheduleSnapshots(DOC_HAZARD, sizes), CATALOG[0]);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });

  test('seed 20260893 shape (benign, defaults-all-on)', () => {
    for (const sizes of [SIZES_BENIGN, [...SIZES_BENIGN].reverse()]) {
      const stats = assertStreamEquivalence('pi-swallow-benign', scheduleSnapshots(DOC_BENIGN, sizes), CONFIG_BENIGN);
      expect(stats.frames).toBeGreaterThan(0);
    }
  });
});
