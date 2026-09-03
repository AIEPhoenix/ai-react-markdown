/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 *
 * Measures how often each COVERAGE_MARKERS family appears in documents from
 * the hazard generator, across many seeds, and the fraction of seeds that
 * would fail the coverage floor in spliceFuzz.test.ts at several divisors.
 * The floor there is RUNS/200; this is the measurement that set it. Re-run
 * it when the hazard pool changes: adding families dilutes the thin ones,
 * which is how the previous floor (RUNS/60, calibrated 2026-08-21) came to
 * fail 36% of fresh seeds by 2026-09-03.
 *
 * Measured 2026-09-03, 300 seeds x 300 runs, hazard pool 34 entries with
 * total weight 81:
 *
 *   thinnest family   headRoutedCapture   mean 6.6-6.9   min 1   2.3% of docs
 *   seeds failing     /60: 36%   /100: 5%   /150: 1.7%   /200: 0   /300: 0
 *   at 1000 runs      /60: 5%    /100 and below: 0
 *   at 12500 runs     headRoutedCapture mean 279, sd 18; floor at /200 is 62
 *
 * Generation only, no parsing; the default size runs in a few seconds.
 *
 * Env: EVIDENCE_COVERAGE_SEEDS (300), EVIDENCE_COVERAGE_RUNS (300),
 * EVIDENCE_COVERAGE_SEED_BASE (2000000).
 */

import { test } from 'vitest';
import fc from 'fast-check';

import { hazardDocArb, COVERAGE_MARKERS } from './fuzzGenerators';
import { testEnv } from './spliceArbiterHarness';

const SEEDS = Number(testEnv('EVIDENCE_COVERAGE_SEEDS') ?? 300);
const RUNS = Number(testEnv('EVIDENCE_COVERAGE_RUNS') ?? 300);
const SEED_BASE = Number(testEnv('EVIDENCE_COVERAGE_SEED_BASE') ?? 2_000_000);
const DIVISORS = [60, 100, 150, 200, 300];

const names = Object.keys(COVERAGE_MARKERS);

/** Test-only stdout access; the package's ambient `process` shim types only
 *  `env.NODE_ENV`. `console.log` is not used because vitest drops it from
 *  passing tests unless a reporter is named. */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

function hitsFor(seed: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { doc } of fc.sample(hazardDocArb, { numRuns: RUNS, seed })) {
    for (const [name, pattern] of Object.entries(COVERAGE_MARKERS)) {
      if (pattern.test(doc)) counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

test('coverage floor: per-family hit distribution and false-positive rate by divisor', { timeout: 900_000 }, () => {
  const perSeed = Array.from({ length: SEEDS }, (_, i) => hitsFor(SEED_BASE + i));

  const families = names
    .map((name) => {
      const hits = perSeed.map((c) => c[name] ?? 0);
      const mean = hits.reduce((a, b) => a + b, 0) / hits.length;
      return { name, mean, min: Math.min(...hits), rate: mean / RUNS };
    })
    .sort((a, b) => a.mean - b.mean);

  let out = `\n[coverage-floor] hazard family, ${SEEDS} seeds x ${RUNS} runs, ${names.length} families\n`;
  out += `[coverage-floor] thinnest eight (mean / min / share of docs):\n`;
  for (const f of families.slice(0, 8)) {
    out += `[coverage-floor]   ${f.name.padEnd(28)} mean=${f.mean.toFixed(1).padStart(6)}  min=${String(f.min).padStart(3)}  ${(100 * f.rate).toFixed(2)}%\n`;
  }
  out += `[coverage-floor] seeds with at least one family under the floor, by divisor:\n`;
  for (const d of DIVISORS) {
    const floor = Math.max(1, Math.floor(RUNS / d));
    const failing = perSeed.filter((c) => names.some((n) => (c[n] ?? 0) < floor)).length;
    out += `[coverage-floor]   RUNS/${String(d).padEnd(4)} floor=${String(floor).padStart(3)}  ${String(failing).padStart(4)}/${SEEDS} (${((100 * failing) / SEEDS).toFixed(1)}%)\n`;
  }
  emit(out);
});
