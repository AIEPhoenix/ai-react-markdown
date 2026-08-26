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

// 300, not the original 120: the coverage meters below demand every one of
// the 32 generator families to be sampled at least RUNS/60 times, and at 120
// the marker with the thinnest weight missed its floor on a third of seeds
// (measured 2026-08-21 over twelve seeds — 4/12 with this corpus, 1/12 with
// the smaller pre-2.5.4 pool, so the pool growing from 38 to 49 weights made
// a pre-existing fragility routine). At 300 all twelve seeds clear it. The
// soak overrides this anyway; the default is what CI and `pnpm preflight`
// run, and a suite that fails on a quarter of seeds is worse than a slower one.
const RUNS = Number(testEnv('FUZZ_RUNS') ?? 300);
const SEED = Number(testEnv('FUZZ_SEED') ?? 20260717);
/** ~30-40ms per sample (2 schedules × ~25 frames × oracle+engine) plus slack. */
const TIMEOUT_MS = Math.max(300_000, RUNS * 300);

const FC_PARAMS = { numRuns: RUNS, seed: SEED } as const;

/** The all-defaults-on config, the shape a standalone consumer actually
 *  ships: highlight + def-list + the three display plugins. */
const DEFAULTS_ALL_ON = CATALOG.find((c) => c.label === 'defaults-all-on')!;

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

    // P1 — per-frame splice ≡ full parse. The engagement floor is an
    // AGGREGATE here (asserted per family below): an individual generated
    // document may legitimately poison to boundary 0 on every frame.
    const stats = assertStreamEquivalence(tag, snapshots, config, { minIncrementalFrames: 0 });
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
    // Anti-vacuity floor: aggregate engagement across the family. The floor
    // exists to catch the path COLLAPSING — a change that makes the splice
    // stop engaging — not to track a few points of drift.
    //
    // It was 0.3, which sat ON the mean rather than under it: measured
    // 2026-08-21 across twelve seeds at 300 samples each, the ratio lands
    // between 0.29 and 0.32, so three of twelve seeds failed at 0.292-0.295.
    // Raising the sample count does not help — that IS the converged value.
    // A floor sitting on the mean fails half the time by construction, and
    // the soak deliberately runs FRESH seeds, so it would teach everyone
    // to ignore a red leg. 0.2 keeps a collapse unmissable with real margin.
    expect(totals.frames).toBeGreaterThan(0);
    expect(totals.incrementalFrames / totals.frames).toBeGreaterThan(0.2);
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
          // The PRODUCTION-reachable cell (review M-xchunk): the sole
          // production caller runs the user's plugin selection and
          // defListEnabled ALONGSIDE the phantom suffix, while this
          // property drove the no-plugin, defList-off cell only. def-list
          // is the load-bearing axis — its `: desc` claim reaches BACKWARD
          // across a blank, which is exactly what an injected suffix
          // appends past.
          const withPlugins = runCrossChunk('fuzz-cross-chunk-defaults', frames, (f) =>
            buildCrossChunkAdvanceOptions(new Set(f.footnotes), new Set(f.links), DEFAULTS_ALL_ON)
          );
          incremental += withPlugins.incrementalFrames;
        }
      ),
      { ...FC_PARAMS, numRuns: Math.max(20, Math.floor(RUNS / 4)) }
    );
    expect(incremental).toBeGreaterThan(0);
  });
});
