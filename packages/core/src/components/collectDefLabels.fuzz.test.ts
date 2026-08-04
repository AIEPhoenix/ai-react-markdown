/**
 * Scanner-profile fuzz: the def-label scanner (frozen-prefix caching over
 * `computeFreezeBoundary` with `mathFlow`/`referenceTaint` off) must equal
 * a full `collectDefLabels` parse at EVERY snapshot of EVERY append
 * schedule. The engine's soak battery has zero coverage of this switch
 * combination — this suite is its safety net (Phase B design review).
 *
 * Reuses the engine's fuzz corpora: `hazardDocArb` biases toward the
 * constructs the boundary blockers exist for (fences, raw HTML, math,
 * defs/refs, containers), which under the scanner's PINNED grammar are
 * exactly the ghost-def hazards. Tune with FUZZ_RUNS / FUZZ_SEED; on a
 * failure, shrink and copy the doc/schedule into collectDefLabels.test.ts
 * as a fixed regression (that suite is the permanent record, this hunts).
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { collectDefLabels, createDefLabelScanner, type DefLabels } from './collectDefLabels';
import { testEnv } from './incrementalParse/spliceArbiterHarness';
import { benignDocArb, hazardDocArb, scheduleSnapshots, type FuzzDoc } from './incrementalParse/fuzzGenerators';

const RUNS = Number(testEnv('FUZZ_RUNS') ?? 100);
const SEED = Number(testEnv('FUZZ_SEED') ?? 20260805);
const TIMEOUT_MS = Math.max(120_000, RUNS * 150);

const FC_PARAMS = { numRuns: RUNS, seed: SEED } as const;

const asPlain = (l: DefLabels) => ({ fn: [...l.footnoteLabels].sort(), link: [...l.linkLabels].sort() });

/** One sample: replay the doc on two schedules (forward + reversed chunk
 *  sizes), asserting scanner == full parse at every snapshot. */
function driveSample(fuzz: FuzzDoc): void {
  for (const sizes of [fuzz.sizes, [...fuzz.sizes].reverse()]) {
    const scanner = createDefLabelScanner();
    for (const snapshot of scheduleSnapshots(fuzz.doc, sizes)) {
      expect(asPlain(scanner.scan(snapshot))).toEqual(asPlain(collectDefLabels(snapshot)));
    }
  }
}

describe('def-label scanner — fuzz equivalence under the scanner boundary profile', () => {
  test(
    'hazard corpus: scanner equals full parse at every snapshot',
    () => {
      fc.assert(
        fc.property(hazardDocArb, (fuzz) => {
          driveSample(fuzz);
        }),
        FC_PARAMS
      );
    },
    TIMEOUT_MS
  );

  test(
    'benign corpus: scanner equals full parse at every snapshot',
    () => {
      fc.assert(
        fc.property(benignDocArb, (fuzz) => {
          driveSample(fuzz);
        }),
        { ...FC_PARAMS, numRuns: Math.max(20, Math.floor(RUNS / 2)) }
      );
    },
    TIMEOUT_MS
  );
});
