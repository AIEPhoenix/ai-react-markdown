/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 *
 * Does the fast-check stream depend on the node version? `ci.yml` pins node
 * to an exact patch, and until 2026-09-03 the pin's comment justified itself
 * with "node 24 does drift the fast-check stream". That claim is false, and
 * it had already been copied into a second file before anyone checked it.
 *
 * Measured 2026-09-03, seed 20260903, 500 samples per arbitrary, node
 * 22.23.2 (the CI pin) against node 24.20.0 — the generated documents are
 * BYTE-IDENTICAL on both:
 *
 *   hazardDocArb   6c6ea382c964656c   500 docs, 121 062 bytes
 *   benignDocArb   072827efd97f822d   500 docs, 122 185 bytes
 *   soupDocArb     bc581767060d90e5   500 docs, 355 034 bytes
 *   seamDocArb     45cdd4020aa76348   500 docs, 609 211 bytes
 *
 * `boundaryDiff.test.ts` — the instrument the pin actually protects, and the
 * one whose stored corpus fingerprint the pin comment is about — passes
 * against its committed baseline under both versions too.
 *
 * WHAT THIS DOES NOT SAY. It compares two installed versions, not every node
 * 24, and it covers the document arbitraries rather than every fast-check
 * call in the repo. The pin is worth keeping on ordinary determinism grounds
 * — one runtime everywhere is one less variable when a gate reddens. What it
 * is not worth keeping is a REASON nobody measured: a false justification
 * survives longer than a false gate, because nothing re-runs it.
 *
 * Re-run when the pin moves.
 */
import { test } from 'vitest';
import fc from 'fast-check';

import { hazardDocArb, benignDocArb } from '../components/incrementalParse/fuzzGenerators';
import { soupDocArb, seamDocArb } from './latexEntryFuzz';
import { testEnv } from '../components/incrementalParse/spliceArbiterHarness';

const RUNS = Number(testEnv('EVIDENCE_DRIFT_RUNS') ?? 500);
const SEED = Number(testEnv('EVIDENCE_DRIFT_SEED') ?? 20260903);

/** Test-only stdout access; the package's ambient `process` shim types only
 *  `env.NODE_ENV`. `console.log` is not used because vitest drops it from
 *  passing tests unless a reporter is named. */
const emit = (line: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(line);
};

/** FNV-1a, two offsets, concatenated. Hand-rolled rather than `node:crypto`
 *  because this package ships no `@types/node` — the same reason `emit`
 *  reaches for `process` through a cast. Fingerprinting only: the two runs
 *  either produce the same 16 hex digits or they do not. */
function hash(parts: string[]): string {
  const text = parts.join(' ');
  const lane = (offset: number): string => {
    let h = offset;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  return lane(0x811c9dc5) + lane(0x2fe1c73b);
}

test('fast-check stream fingerprint, per node version', () => {
  const version = (process as unknown as { version?: string }).version ?? 'unknown';
  emit(`\nfast-check stream fingerprint — node ${version}, seed ${SEED}, ${RUNS} samples\n`);
  const entries: [string, fc.Arbitrary<{ doc: string }>][] = [
    ['hazardDocArb', hazardDocArb],
    ['benignDocArb', benignDocArb],
    ['soupDocArb', soupDocArb],
    ['seamDocArb', seamDocArb],
  ];
  for (const [name, arb] of entries) {
    const docs = fc.sample(arb, { numRuns: RUNS, seed: SEED }).map((s) => s.doc);
    emit(`  ${name.padEnd(14)} ${hash(docs)}  n=${docs.length} bytes=${docs.join('').length}\n`);
  }
  emit(`  (compare against the table in this file's header; a difference means the pin's reason is back)\n`);
});
