/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 *
 * Sets and re-checks the anti-vacuity floors in
 * `latexEntryEquivalence.fuzz.test.ts`. Those floors assert that each option
 * cell reached the frozen path and that both sides of `opensMathFlow` were
 * reached BY A SAMPLE THAT HAD ALREADY FROZEN — the conjunction the
 * `1e0af4e` divergence needed. A floor on a conjunction is worth measuring
 * rather than guessing, because it moves whenever either conjunct's rate
 * moves, and neither is visible in the corpus text.
 *
 * Re-run it after touching `INDENTS`, `BODIES`, `CATALOG`, the chunk-size
 * distribution, or the freeze threshold. The precedent is
 * `coverageFloor.evidence.ts`: a floor calibrated once, against a corpus
 * that then grew, drifted onto the mean and failed 36% of fresh seeds while
 * still reading as a gate.
 *
 * The two rate columns are counted PER SAMPLE, not per frame. A frame count
 * measures the chunk schedule as much as the corpus — halve the chunk sizes
 * and every frame meter doubles while proving the same thing — so a floor
 * built on frames drifts whenever the schedule distribution is touched.
 *
 * Measured 2026-09-03, 60 seeds x 400 runs, per sample:
 *
 *                            soup mean/min      seam mean/min      floor
 *   froze defaults              45.5 / 31          77.2 / 59         8
 *   froze threshold-0/off       97.6 / 77         130.6 / 107        8
 *   froze threshold-0/on       115.0 / 95         144.9 / 122        8
 *   seam disqualified           14.8 / 8           36.8 / 20         8   (seam family only)
 *   seam mathFlow                8.2 / 3           19.1 / 9          4   (seam family only)
 *
 * Re-measured 2026-09-04 after the soft-atom alphabet landed (eight bodies
 * added to BODIES — same-line paired tags, a tag inside a formula, the
 * `<span>$</span>100` idiom, a private-use code unit, a CRLF line), 60
 * seeds x 400 runs, node 24: soup froze defaults 45.5 / 31, threshold-0/off
 * 103.3 / 85, threshold-0/on 119.7 / 102; seam froze defaults 77.4 / 60,
 * seam disqualified 42.4 / 24, seam mathFlow 22.5 / 13. Every floor keeps
 * its margin (0% of seeds failing at RUNS/50 on the gated rows).
 *
 * Re-measured under node 22.23.2, the version CI pins, 30 seeds: seam
 * disqualified mean 43.8 min 22, seam mathFlow mean 22.6 min 12, froze
 * defaults min 31 — same floors, 0% failing on both versions.
 *
 * The reason for checking was wrong. `ci.yml`'s pin claimed node 24 drifts
 * the fast-check stream, so the CI seed would draw a different sample set
 * than a local run; measured, it does not — see `streamdrift.evidence.ts`,
 * where the generated documents hash identically on both. The floors held
 * either way, and the run was worth doing to learn that the premise was
 * not.
 *
 * The two seam floors differ because the two rates differ by construction:
 * `INDENTS` holds four indents that open a math flow and seven that do not.
 * A single shared divisor was tried first at RUNS/20 and 52% of fresh seeds
 * failed on the mathFlow side — the floor sat above its own minimum. The
 * seam meters are asserted only on the `composed seam` family; the soup
 * family reaches them incidentally and is not gated on them.
 *
 * Env: EVIDENCE_ENTRY_SEEDS (60), EVIDENCE_ENTRY_RUNS (400),
 * EVIDENCE_ENTRY_SEED_BASE (3000000).
 */

import { test } from 'vitest';
import fc from 'fast-check';

import { testEnv } from '../components/incrementalParse/spliceArbiterHarness';
import { CATALOG, drive, newMeters, seamDocArb, soupDocArb, type Meters, type Sample } from './latexEntryFuzz';

const SEEDS = Number(testEnv('EVIDENCE_ENTRY_SEEDS') ?? 60);
const RUNS = Number(testEnv('EVIDENCE_ENTRY_RUNS') ?? 400);
const SEED_BASE = Number(testEnv('EVIDENCE_ENTRY_SEED_BASE') ?? 3_000_000);
/** Divisors of RUNS to report a seed failure rate for, as the test file
 *  expresses its floors that way (`RUNS / n`). */
const DIVISORS = [10, 20, 50, 100, 200];

/** Test-only stdout access; the package's ambient `process` shim types only
 *  `env.NODE_ENV`. `console.log` is not used because vitest drops it from
 *  passing tests unless a reporter is named. */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

function metersFor(arb: fc.Arbitrary<Sample>, tag: string, seed: number): Meters {
  const meters = newMeters();
  for (const sample of fc.sample(arb, { numRuns: RUNS, seed })) drive(sample, tag, meters);
  return meters;
}

interface Column {
  name: string;
  of: (m: Meters) => number;
}

const COLUMNS: Column[] = [
  ...CATALOG.map(({ label }) => ({ name: `froze:${label}`, of: (m: Meters) => m.frozeSamples[label] ?? 0 })),
  { name: 'seam:disqualified', of: (m: Meters) => m.seamSamples.disqualified },
  { name: 'seam:mathFlow', of: (m: Meters) => m.seamSamples.mathFlow },
  { name: 'rewinds', of: (m: Meters) => m.rewinds },
];

function report(family: string, perSeed: Meters[]): void {
  emit(`\n${family} — ${SEEDS} seeds x ${RUNS} runs\n`);
  emit(
    `${'metric'.padEnd(30)} ${'mean'.padStart(9)} ${'min'.padStart(6)} ${'max'.padStart(6)}   seeds failing at RUNS/n\n`
  );
  for (const column of COLUMNS) {
    const values = perSeed.map(column.of);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const rates = DIVISORS.map((d) => {
      const floor = Math.max(1, Math.floor(RUNS / d));
      const failing = values.filter((v) => v < floor).length;
      return `/${d}:${((failing / values.length) * 100).toFixed(0)}%`;
    }).join(' ');
    emit(
      `${column.name.padEnd(30)} ${mean.toFixed(1).padStart(9)} ${String(min).padStart(6)} ${String(max).padStart(6)}   ${rates}\n`
    );
  }
}

test('entry-point fuzz: per-cell freeze and seam-conjunction rates by seed', { timeout: 3_600_000 }, () => {
  const seeds = Array.from({ length: SEEDS }, (_, i) => SEED_BASE + i);
  report(
    'line soup',
    seeds.map((seed) => metersFor(soupDocArb, 'soup', seed))
  );
  report(
    'composed seam',
    seeds.map((seed) => metersFor(seamDocArb, 'seam', seed))
  );
  emit(
    `\nA floor is chosen so its "seeds failing" column reads 0% with room to\n` +
      `spare — the soak runs FRESH seeds, and a floor that fails occasionally\n` +
      `teaches everyone to ignore a red leg.\n`
  );
});
