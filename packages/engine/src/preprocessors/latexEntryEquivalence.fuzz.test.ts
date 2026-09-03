/**
 * ENTRY-POINT EQUIVALENCE FUZZ — the soak's sixth leg.
 *
 * The contract: `createIncrementalLatexPreprocessor()` returns exactly
 * `preprocessLaTeX(full)` on every call of every append stream, under every
 * option combination. One property, and no oracle to build — the stateless
 * entry point IS the oracle.
 *
 * WHY THIS LEG EXISTS. The five-leg gate had no coverage of this pair. The
 * `fuzz` leg fuzzes incremental *parsing* (`spliceParse` against a fresh
 * parse); these two entry points sit a layer below it, and were fuzzed only
 * by the hand-rolled generator in `latex.incremental.test.ts`. On 2026-09-02
 * commit `1e0af4e` changed `truncateUnclosedLatexBlock`'s condition without
 * changing `truncatedAtSeamStart`, the incremental path ate a newline the
 * stateless path keeps, and the five-leg soak ran ALL CLEAN over it. It
 * surfaced while someone was designing an unrelated fix.
 *
 * WHY THE OLD GENERATOR COULD NOT FIND IT — stated precisely, because "add
 * more random strings" is the wrong lesson. Two independent reasons:
 *
 *  1. GRAMMAR, not probability. The divergence needs a `$$` behind an indent
 *     that disqualifies it as a math-flow opener: four or more spaces, or a
 *     tab. That generator's alphabet has no whitespace-only piece, and its
 *     one indented piece (`'   indented\n'`) puts letters after the spaces,
 *     so no concatenation of its pieces can produce the shape. Measured
 *     2026-09-03: zero hits in 200 000 documents, and zero across ALL one-,
 *     two- and three-piece concatenations. Not rare — unreachable.
 *
 *  2. CONJUNCTION DEPTH. Even with the shape available, the divergence is
 *     observable only when three things hold at once: a freeze has happened,
 *     the frozen OUTPUT ends in whitespace (otherwise the seam correction's
 *     `replace(/\s+$/, '')` is a no-op and the defect is invisible), and the
 *     active region begins with the disqualified opener. Independent piece
 *     draws meet a three-way conjunction at the product of three small
 *     probabilities.
 *
 * So the generators here do two things that one does not: indentation is an
 * ORTHOGONAL axis carried by every line rather than a property of a few
 * pieces, and a second family COMPOSES the conjunction directly. The
 * `seamSamples` meter then asserts the conjunction ITSELF was reached, not
 * its conjuncts separately — a suite that produced the shape and the freeze
 * in disjoint samples would be as blind as the gate this leg replaces, and
 * would say so in neither meter.
 *
 * Failures print the document, the option cell and the frame. Copy the
 * shrunk counterexample into `latex.incremental.test.ts` as a fixed pin:
 * that suite is the permanent record, this one hunts.
 *
 * Scale for the soak with FUZZ_RUNS / FUZZ_SEED.
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { testEnv } from '../components/incrementalParse/spliceArbiterHarness';
import { soakBeat } from '../components/incrementalParse/soakHeartbeat';
import { CATALOG, drive, newMeters, seamDocArb, soupDocArb, type Meters } from './latexEntryFuzz';

/** The default is what CI and `pnpm preflight` run; the soak overrides it. A
 *  sample here is string transforms only — no parse, no plugins — so it is
 *  far cheaper than a `spliceFuzz` sample and the CI default can be larger. */
const RUNS = Number(testEnv('FUZZ_RUNS') ?? 400);
const SEED = Number(testEnv('FUZZ_SEED') ?? 20260903);
const TIMEOUT_MS = Math.max(300_000, RUNS * 200);

const FC_PARAMS = { numRuns: RUNS, seed: SEED } as const;

/**
 * Every option cell must actually reach the frozen path, or its samples
 * proved only that the fallback works.
 *
 * A floor here catches a cell going STRUCTURALLY dead — an option renamed, a
 * threshold no generated document reaches — and is deliberately not a target
 * to track drift against. The thinnest cell is `defaults`, which needs 512
 * active bytes before it attempts anything and so only fires on padded
 * documents: measured 2026-09-03 over 60 seeds x 400 runs, mean 45.5 and min
 * 31 in the soup family, against this floor of 8. Full table in
 * `latexEntryFloor.evidence.ts`.
 */
const frozeFloor = (): number => Math.max(1, Math.floor(RUNS / 50));

function assertEveryConfigFroze(m: Meters): void {
  for (const { label } of CATALOG) {
    expect(m.frozeSamples[label] ?? 0, `config cell never froze: ${label}`).toBeGreaterThanOrEqual(frozeFloor());
  }
}

describe(`latex entry-point equivalence fuzz (runs=${RUNS} seed=${SEED})`, () => {
  test('line soup: incremental equals stateless at every append', { timeout: TIMEOUT_MS }, () => {
    const m = newMeters();
    const beat = soakBeat('soup', RUNS);
    fc.assert(
      fc.property(soupDocArb, (sample) => {
        beat.tick();
        drive(sample, 'soup', m);
      }),
      FC_PARAMS
    );
    beat.finish();
    expect(m.frames).toBeGreaterThan(0);
    assertEveryConfigFroze(m);
    // The rewind path is a small share of calls but a whole state machine —
    // assert it ran rather than assuming the weight kept it alive.
    expect(m.rewinds, 'non-append rewinds').toBeGreaterThan(0);
  });

  test('composed seam: freeze, whitespace seam, whole-string tail', { timeout: TIMEOUT_MS }, () => {
    const m = newMeters();
    const beat = soakBeat('seam', RUNS);
    fc.assert(
      fc.property(seamDocArb, (sample) => {
        beat.tick();
        drive(sample, 'seam', m);
      }),
      FC_PARAMS
    );
    beat.finish();
    assertEveryConfigFroze(m);
    // THE anti-vacuity assertion of this file. Both sides of `opensMathFlow`
    // must be reached BY A SAMPLE THAT HAS ALREADY FROZEN. That pairing is
    // the observable the `1e0af4e` divergence needed, and a generator edit
    // that quietly stopped producing it would leave this suite green and
    // blind — which is the state the five-leg gate was in.
    //
    // The two floors differ because the two rates differ BY CONSTRUCTION:
    // `INDENTS` holds four indents that open a math flow and seven that do
    // not, and the hazard side is the one worth over-sampling. Measured
    // 2026-09-03 over 60 seeds x 400 runs: disqualified mean 36.8 min 20
    // against a floor of 8; mathFlow mean 19.1 min 9 against a floor of 4.
    // A single shared divisor was tried first and set at RUNS/20 — which
    // 52% of fresh seeds fail on the mathFlow side, the exact defect
    // `coverageFloor.evidence.ts` exists to record.
    expect(m.seamSamples.disqualified, 'frozen samples whose seam $$ cannot open').toBeGreaterThanOrEqual(
      Math.max(1, Math.floor(RUNS / 50))
    );
    expect(m.seamSamples.mathFlow, 'frozen samples whose seam $$ opens').toBeGreaterThanOrEqual(
      Math.max(1, Math.floor(RUNS / 100))
    );
  });
});
