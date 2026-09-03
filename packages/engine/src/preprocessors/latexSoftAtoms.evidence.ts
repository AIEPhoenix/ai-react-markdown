/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 * Asserts nothing (the repository's three-way rule: numbers that gate are
 * assertions in `latexSoftAtoms.differential.test.ts`; numbers that justify
 * the gate live here; everything else is a deleted scratch file).
 *
 * Compares the legacy arm of `processSlice` (today's per-segment behaviour)
 * against the soft-atom arm over the fixture module, the corpus documents
 * and 60 seeds × 400 runs × 2 generator families, and prints: total and
 * changed samples, count per approved change class, unclassified changes,
 * changes inside the narrowed no-tag/no-hard-boundary class, and the
 * non-idempotence rate of each arm (`f(f(x)) !== f(x)`; not a contract,
 * recorded because the model raises it).
 *
 * Env: EVIDENCE_SOFT_SEEDS (60), EVIDENCE_SOFT_RUNS (400).
 * Runtime: measured on landing — see the release notes; the seeds×runs
 * product is the knob.
 */
import { test } from 'vitest';
import fc from 'fast-check';
import { testEnv } from '../components/incrementalParse/spliceArbiterHarness';
import { softAtomFixtures } from './latexSoftAtomFixtures';
import { seamDocArb, soupDocArb } from './latexEntryFuzz';
import { CHANGE_CLASSES, nonIdempotenceRate, tally } from './latexSoftAtomClassifier';

// The package ships no node types (browser-shippable code must not grow env
// deps — see `boundaryDiff.test.ts`), so this node-only file loads fs through
// a COMPUTED dynamic import against a minimal local interface, and addresses
// the corpus directory as a URL to avoid node:path.
interface NodeFsLike {
  readdirSync(p: URL): string[];
  readFileSync(p: URL, encoding: 'utf8'): string;
}
const fs = (await import('node' + ':fs')) as unknown as NodeFsLike;

const SEEDS = Number(testEnv('EVIDENCE_SOFT_SEEDS') ?? 60);
const RUNS = Number(testEnv('EVIDENCE_SOFT_RUNS') ?? 400);
const CORPUS_DIR = new URL('../../../../corpus/documents/', import.meta.url);

/** Test-only stdout access; the ambient `process` shim types only `env`. */
const emit = (s: string): void => {
  (process as unknown as { stdout?: { write(text: string): void } }).stdout?.write(s);
};

test(`soft-atom differential evidence (${SEEDS} seeds × ${RUNS} runs)`, { timeout: 3_600_000 }, () => {
  const started = Date.now();
  const fixtures = softAtomFixtures();
  const corpus = fs
    .readdirSync(CORPUS_DIR)
    .filter((f: string) => f.endsWith('.md'))
    .sort()
    .map((f: string) => fs.readFileSync(new URL(f, CORPUS_DIR), 'utf8'));
  const fuzz: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const s of fc.sample(soupDocArb, { numRuns: RUNS, seed })) fuzz.push(s.doc);
    for (const s of fc.sample(seamDocArb, { numRuns: RUNS, seed })) fuzz.push(s.doc);
  }

  emit(`\nsoft-atom differential — legacy arm vs default arm\n`);
  for (const [name, inputs] of [
    ['fixtures', fixtures],
    ['corpus', corpus],
    ['fuzz', fuzz],
  ] as const) {
    const t = tally(inputs);
    emit(`\n${name}: ${t.total} samples, ${t.changed} changed\n`);
    for (const cls of CHANGE_CLASSES) {
      if (t.byClass[cls] > 0) emit(`  ${cls.padEnd(28)} ${String(t.byClass[cls]).padStart(7)}\n`);
    }
    emit(`  ${'unclassified changes'.padEnd(28)} ${String(t.unclassified.length).padStart(7)}\n`);
    emit(`  ${'narrowed-class changes'.padEnd(28)} ${String(t.narrowedChanges.length).padStart(7)}\n`);
    for (const c of t.unclassified.slice(0, 10)) {
      emit(
        `    ! ${JSON.stringify(c.input)}\n      legacy ${JSON.stringify(c.legacy)}\n      soft   ${JSON.stringify(c.soft)}\n`
      );
    }
    const legacyRate = nonIdempotenceRate(inputs, 'legacy');
    const softRate = nonIdempotenceRate(inputs, 'soft');
    emit(`  ${'non-idempotence legacy'.padEnd(28)} ${(legacyRate * 100).toFixed(2).padStart(6)}%\n`);
    emit(`  ${'non-idempotence soft'.padEnd(28)} ${(softRate * 100).toFixed(2).padStart(6)}%\n`);
  }
  emit(`\nruntime ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);
});
