/**
 * FUZZ ARBITER — property-based generalization of spliceEquivalence.test.ts.
 *
 * Every generated document × append schedule × plugin config must satisfy,
 * on every frame:
 *   P1  splice ≡ fresh full parse (hast+mdast deep-equal, positions
 *       included) — via the shared arbiter harness;
 *   P2  checkpoint-resumed boundary scan ≡ fresh scan (boundary values
 *       only; checkpoints legitimately differ internally). The differential
 *       runs its OWN scan lineage — checkpoints are single-consumer mutable
 *       state, and sharing the engine's would corrupt both.
 * Cross-chunk samples additionally splice under churning phantom suffixes
 * (oracle: full parse of content+suffix, same options).
 *
 * Two document families with separate engagement floors: benign-biased docs
 * must keep the incremental path HOT (aggregate floor asserted — a fuzz
 * suite that only exercises the full-parse fallback proves nothing), while
 * hazard-dense docs legitimately splice less and only owe equivalence.
 * Generator coverage meters (COVERAGE_MARKERS) assert the adversarial
 * constructs actually occur, so a generator edit can't hollow the corpus.
 *
 * Determinism: fixed default seed; override scale/seed via env for soak —
 *   FUZZ_RUNS=50000 FUZZ_SEED=42 pnpm --filter @ai-react-markdown/core fuzz:splice
 * On failure fast-check prints the SHRUNK minimal counterexample + seed;
 * copy the shrunk doc/schedule into spliceEquivalence.test.ts as a fixed
 * regression fixture (that suite is the permanent record, this one hunts).
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { computeFreezeBoundary, type FreezeScanCheckpoint } from './computeFreezeBoundary';
import { buildAdvanceOptions, buildCrossChunkAdvanceOptions, CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence, runCrossChunk, testEnv, type FramePair } from './spliceArbiterHarness';
import { benignDocArb, hazardDocArb, scheduleSnapshots, COVERAGE_MARKERS, type FuzzDoc } from './fuzzGenerators';

const RUNS = Number(testEnv('FUZZ_RUNS') ?? 120);
const SEED = Number(testEnv('FUZZ_SEED') ?? 20260717);
/** ~30-40ms per sample (2 schedules × ~25 frames × oracle+engine) plus slack. */
const TIMEOUT_MS = Math.max(300_000, RUNS * 300);

const FC_PARAMS = { numRuns: RUNS, seed: SEED } as const;

interface Totals {
  frames: number;
  incrementalFrames: number;
  markerHits: Record<string, number>;
}

const newTotals = (): Totals => ({ frames: 0, incrementalFrames: 0, markerHits: {} });

function meterMarkers(doc: string, totals: Totals): void {
  for (const [name, pattern] of Object.entries(COVERAGE_MARKERS)) {
    if (pattern.test(doc)) totals.markerHits[name] = (totals.markerHits[name] ?? 0) + 1;
  }
}

/** Drive one sample through P1+P2 on two schedules (forward + reversed
 *  chunk sizes — extra splice-path coverage, same oracle). */
function driveSample(fuzz: FuzzDoc, tag: string, totals: Totals): void {
  const config = CATALOG[fuzz.configIndex % CATALOG.length];
  const defListEnabled = buildAdvanceOptions(config).defListEnabled;
  meterMarkers(fuzz.doc, totals);

  for (const sizes of [fuzz.sizes, [...fuzz.sizes].reverse()]) {
    const snapshots = scheduleSnapshots(fuzz.doc, sizes);

    // P1 — per-frame splice ≡ full parse.
    const stats = assertStreamEquivalence(tag, snapshots, config);
    totals.frames += stats.frames;
    totals.incrementalFrames += stats.incrementalFrames;

    // P2 — resumed scan ≡ fresh scan, own lineage, boundary values only.
    let checkpoint: FreezeScanCheckpoint | null = null;
    for (const snapshot of snapshots) {
      const fresh = computeFreezeBoundary(snapshot, { defListEnabled });
      const resumed = computeFreezeBoundary(snapshot, { defListEnabled }, checkpoint);
      if (resumed.boundary !== fresh.boundary) {
        expect.fail(
          `${tag} resume/fresh boundary divergence at len=${snapshot.length}: resumed=${resumed.boundary} fresh=${fresh.boundary} doc=${JSON.stringify(snapshot)}`
        );
      }
      checkpoint = resumed.checkpoint;
    }
  }
}

describe(`splice fuzz arbiter (runs=${RUNS} seed=${SEED})`, () => {
  test('benign-biased family: equivalence + hot splice path', { timeout: TIMEOUT_MS }, () => {
    const totals = newTotals();
    fc.assert(
      fc.property(benignDocArb, (fuzz) => {
        driveSample(fuzz, 'fuzz-benign', totals);
      }),
      FC_PARAMS
    );
    // Anti-vacuity floor: aggregate engagement across the family. Asserted
    // on aggregates (law of large numbers), so custom seeds stay stable.
    expect(totals.frames).toBeGreaterThan(0);
    expect(totals.incrementalFrames / totals.frames).toBeGreaterThan(0.3);
  });

  test('hazard-dense family: equivalence + generator coverage meters', { timeout: TIMEOUT_MS }, () => {
    const totals = newTotals();
    fc.assert(
      fc.property(hazardDocArb, (fuzz) => {
        driveSample(fuzz, 'fuzz-hazard', totals);
      }),
      FC_PARAMS
    );
    // Hazard docs legitimately splice less — only demand the path is alive.
    expect(totals.incrementalFrames).toBeGreaterThan(0);
    // Phase 4c — every adversarial construct family must actually occur.
    const floor = Math.max(1, Math.floor(RUNS / 60));
    for (const name of Object.keys(COVERAGE_MARKERS)) {
      expect(totals.markerHits[name] ?? 0, `generator coverage: ${name}`).toBeGreaterThanOrEqual(floor);
    }
  });

  test('cross-chunk family: phantom-suffix churn under fuzzed docs', { timeout: TIMEOUT_MS }, () => {
    let incremental = 0;
    fc.assert(
      fc.property(
        benignDocArb,
        fc.integer({ min: 1, max: 8 }),
        fc.subarray(['A1', 'A2', 'B7'] as string[], { minLength: 1 }),
        fc.subarray(['SPEC', 'GFM'] as string[]),
        (fuzz, churnDenom, footPool, linkPool) => {
          // Refs to phantom labels make the suffix load-bearing, not inert.
          const doc = `${fuzz.doc}\ncross refs [^${footPool[0]}] and [${linkPool[0] ?? 'SPEC'}] appear.\n`;
          const snapshots = scheduleSnapshots(doc, fuzz.sizes);
          const churnAt = Math.max(1, Math.floor(snapshots.length / churnDenom));
          const frames: FramePair[] = snapshots.map((content, i) => ({
            content,
            footnotes: i < churnAt ? footPool.slice(0, 1) : footPool,
            links: i < churnAt ? [] : linkPool,
          }));
          const stats = runCrossChunk('fuzz-cross-chunk', frames, (f) =>
            buildCrossChunkAdvanceOptions(new Set(f.footnotes), new Set(f.links))
          );
          incremental += stats.incrementalFrames;
        }
      ),
      { ...FC_PARAMS, numRuns: Math.max(20, Math.floor(RUNS / 4)) }
    );
    expect(incremental).toBeGreaterThan(0);
  });
});
