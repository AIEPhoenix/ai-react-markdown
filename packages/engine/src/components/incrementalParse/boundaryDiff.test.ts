/**
 * §2.3 boundary-diff harness: per-sample scanner boundaries over the pinned
 * corpus (17 realistic documents + 2000 pinned fuzz samples), compared
 * against the committed baseline on every test run.
 *
 * Red line encoded here: the boundary may move DOWN freely (each decrease
 * is reported in a histogram, never failed on); it may move UP only where a
 * stage fixes a confirmed under-block — so every increase fails the test
 * until the baseline is deliberately regenerated alongside that stage's
 * ledger entry.
 *
 * Baseline lifecycle:
 *   BOUNDARY_BASELINE_WRITE=1 vitest --run boundaryDiff  → rewrite the file
 * The stored fingerprint covers the full corpus (ids, bytes, configs); a
 * mismatch means the fuzz slice drifted (fast-check upgrade) and the
 * baseline must be REGENERATED, never interpreted.
 *
 * This tool is a REGRESSION net: a clean diff is never a safety argument
 * (only fresh-seed soak is), and it was not trusted until it had failed on
 * purpose — the §2.3 mutation check (blankRun off-by-one, dropped blocker,
 * flipped poison, dropped defs registration) is recorded in
 * GRAMMAR-COVERAGE.md's P1 section.
 *
 * Boundaries are recorded per production lineage, because the three
 * consumers run the scanner under different grammar profiles and a
 * regression can hide in the one your diff did not compute:
 *   e  engine   (advanceIncrementalParse) — defList per config
 *   s  scanner  (collectDefLabels)        — defList off, math off, taint off
 *   p  phantom  (remarkInjectPhantomDefs) — defList off, taint off
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary, type FreezeBoundaryOptions } from './computeFreezeBoundary';
import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';
import { REALISTIC_DOCS, pinnedFuzzDocs, corpusFingerprint, type PinnedDoc } from './pinnedCorpus';
import { testEnv } from './spliceArbiterHarness';

// The package deliberately ships no node types (browser-shippable code must
// not grow env deps — see the ambient `process` shim note in
// spliceArbiterHarness), so this node-only test file loads fs through a
// COMPUTED dynamic import (not type-checked) against a minimal local
// interface, and derives the baseline path as a URL to avoid node:path.
interface NodeFsLike {
  readFileSync(p: URL, encoding: 'utf8'): string;
  writeFileSync(p: URL, data: string): void;
  existsSync(p: URL): boolean;
}
const fs = (await import('node' + ':fs')) as unknown as NodeFsLike;

const BASELINE_URL = new URL('./boundaryBaseline.json', import.meta.url);

interface Baseline {
  fingerprint: string;
  boundaries: Record<string, number>;
}

function lineages(doc: PinnedDoc): Array<[string, FreezeBoundaryOptions]> {
  const config = CATALOG[doc.configIndex % CATALOG.length];
  const { defListEnabled } = buildAdvanceOptions(config);
  return [
    ['e', { defListEnabled }],
    ['s', { defListEnabled: false, mathFlow: false, referenceTaint: false }],
    ['p', { defListEnabled: false, referenceTaint: false }],
  ];
}

function computeAll(): { fingerprint: string; boundaries: Record<string, number> } {
  const corpus = [...REALISTIC_DOCS, ...pinnedFuzzDocs()];
  const boundaries: Record<string, number> = {};
  for (const doc of corpus) {
    for (const [lineage, options] of lineages(doc)) {
      boundaries[`${doc.id}:${lineage}`] = computeFreezeBoundary(doc.doc, options).boundary;
    }
  }
  return { fingerprint: corpusFingerprint(corpus), boundaries };
}

describe('boundary diff against the committed baseline', () => {
  test('every boundary is at or below its baseline', () => {
    const current = computeAll();

    if (testEnv('BOUNDARY_BASELINE_WRITE') === '1') {
      fs.writeFileSync(BASELINE_URL, `${JSON.stringify(current, null, 1)}\n`);
      console.log(`[boundaryDiff] baseline rewritten: ${Object.keys(current.boundaries).length} entries`);
      return;
    }

    expect(fs.existsSync(BASELINE_URL), 'no committed baseline — run with BOUNDARY_BASELINE_WRITE=1').toBe(true);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_URL, 'utf8')) as Baseline;

    expect(
      current.fingerprint,
      'corpus fingerprint drifted (fast-check upgrade?) — regenerate the baseline, do not interpret this diff'
    ).toBe(baseline.fingerprint);

    const increases: string[] = [];
    const decreaseHistogram = new Map<string, number>();
    let decreases = 0;
    for (const [key, base] of Object.entries(baseline.boundaries)) {
      const now = current.boundaries[key];
      expect(now, `sample ${key} vanished from the corpus`).toBeDefined();
      if (now > base) increases.push(`${key}: ${base} → ${now} (+${now - base})`);
      if (now < base) {
        decreases += 1;
        const bucket = String(Math.min(9, Math.floor(Math.log2(base - now + 1))));
        decreaseHistogram.set(bucket, (decreaseHistogram.get(bucket) ?? 0) + 1);
      }
    }

    if (decreases > 0) {
      const rows = [...decreaseHistogram.entries()].sort().map(([b, n]) => `2^${b}≈${n}`);
      console.log(`[boundaryDiff] ${decreases} decreases (allowed): ${rows.join(' ')}`);
    }
    expect(
      increases,
      `boundary INCREASES need a ledger entry naming the fixed under-block, then a deliberate baseline regen:\n${increases
        .slice(0, 40)
        .join('\n')}`
    ).toEqual([]);
  });
});
