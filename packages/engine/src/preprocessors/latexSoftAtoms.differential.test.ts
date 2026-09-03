/**
 * Differential GATE for the soft-atom model: every difference between the
 * legacy arm (today's per-segment behaviour, kept inside `processSlice`) and
 * the default arm must fall into an owner-approved change class, and inputs
 * with neither a soft tag nor a hard boundary must not change at all.
 *
 * Three executable input sources, each with its count asserted non-zero so
 * a refactor cannot silently empty one:
 *   (a) the shared fixture module (also driven by the unit tests);
 *   (b) the six checked-in corpus documents, read from disk — the corpus
 *       package devDepends on the engine, so importing it would be a cycle;
 *   (c) seeded fuzz samples from the entry-point generators.
 *
 * The report-only twin with 60 × 400 samples lives in
 * `latexSoftAtoms.evidence.ts` (asserts nothing, per the repository's rule
 * that numbers which justify a gate live outside the test count).
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { softAtomFixtures } from './latexSoftAtomFixtures';
import { seamDocArb, soupDocArb } from './latexEntryFuzz';
import { tally, type ChangeClass } from './latexSoftAtomClassifier';

// The package ships no node types (browser-shippable code must not grow env
// deps — see `boundaryDiff.test.ts`), so this node-only file loads fs through
// a COMPUTED dynamic import against a minimal local interface, and addresses
// the corpus directory as a URL to avoid node:path.
interface NodeFsLike {
  readdirSync(p: URL): string[];
  readFileSync(p: URL, encoding: 'utf8'): string;
}
const fs = (await import('node' + ':fs')) as unknown as NodeFsLike;

const CORPUS_DIR = new URL('../../../../corpus/documents/', import.meta.url);
const CORPUS_FILES = [
  'code-unclosed-fence.md',
  'code.md',
  'markdown.md',
  'math-seam-unclosed-tail.md',
  'math.md',
  'mermaid.md',
];

const SEEDS = 5;
const RUNS = 400;

function corpusDocuments(): string[] {
  const listed = fs
    .readdirSync(CORPUS_DIR)
    .filter((f: string) => f.endsWith('.md'))
    .sort();
  expect(listed).toEqual(CORPUS_FILES);
  return listed.map((f: string) => fs.readFileSync(new URL(f, CORPUS_DIR), 'utf8'));
}

function fuzzDocuments(): string[] {
  const docs: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const s of fc.sample(soupDocArb, { numRuns: RUNS, seed })) docs.push(s.doc);
    for (const s of fc.sample(seamDocArb, { numRuns: RUNS, seed })) docs.push(s.doc);
  }
  return docs;
}

function describeUnclassified(list: ReturnType<typeof tally>['unclassified']): string {
  return list
    .slice(0, 5)
    .map(
      (c) =>
        `  input:  ${JSON.stringify(c.input)}\n  legacy: ${JSON.stringify(c.legacy)}\n  soft:   ${JSON.stringify(c.soft)}`
    )
    .join('\n');
}

describe('soft atoms — differential gate against the legacy arm', () => {
  const fixtures = softAtomFixtures();
  const corpus = corpusDocuments();
  const fuzz = fuzzDocuments();

  test('every source is non-empty (anti-vacuity)', () => {
    expect(fixtures.length).toBeGreaterThan(30);
    expect(corpus.length).toBe(CORPUS_FILES.length);
    expect(fuzz.length).toBe(SEEDS * RUNS * 2);
  });

  test('fixtures: every change is an approved class and nothing narrowed moves', () => {
    const t = tally(fixtures);
    expect(t.total).toBe(fixtures.length);
    expect(t.unclassified, describeUnclassified(t.unclassified)).toHaveLength(0);
    expect(t.narrowedChanges, describeUnclassified(t.narrowedChanges)).toHaveLength(0);
    // The fixtures exist to exercise the model: most of them change.
    expect(t.changed).toBeGreaterThan(fixtures.length / 3);
    const reached = (c: ChangeClass) => expect(t.byClass[c], c).toBeGreaterThan(0);
    reached('pair-across-tag');
    reached('truncation-covers-atoms');
    reached('mid-line-dd-after-atom');
    reached('hard-boundary-line-origin');
    reached('parity-across-tag');
    reached('bracket-across-tag');
    reached('mhchem-split');
    reached('unclosed-tail-across-tag');
  });

  test('corpus documents: every change is an approved class and nothing narrowed moves', () => {
    const t = tally(corpus);
    expect(t.total).toBe(corpus.length);
    expect(t.unclassified, describeUnclassified(t.unclassified)).toHaveLength(0);
    expect(t.narrowedChanges, describeUnclassified(t.narrowedChanges)).toHaveLength(0);
  });

  test(
    `seeded fuzz (${SEEDS} × ${RUNS} × 2 families): every change is an approved class and nothing narrowed moves`,
    { timeout: 120_000 },
    () => {
      const t = tally(fuzz);
      expect(t.total).toBe(fuzz.length);
      expect(t.unclassified, describeUnclassified(t.unclassified)).toHaveLength(0);
      expect(t.narrowedChanges, describeUnclassified(t.narrowedChanges)).toHaveLength(0);
      // The generators carry tag bodies, so the model must be exercised here
      // too — a zero would mean the alphabet lost its soft-atom shapes.
      expect(t.changed).toBeGreaterThan(0);
    }
  );
});
