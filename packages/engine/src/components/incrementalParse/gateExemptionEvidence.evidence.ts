/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 *
 * It reproduces the two COMPARATIVE measurements that justify the raw-mode
 * gate's exemption set (the 2026-08-28 audit, commit 54c5151). Neither can
 * be an assertion, because each compares the gate against a version of
 * itself that no longer exists in the source — and a number that cannot be
 * an assertion decays the moment the harness that produced it is deleted.
 * That is the rule this file exists to obey:
 *
 *   Numbers that GATE go in assertions.
 *   Numbers that JUSTIFY a gate go in a committed script.
 *   Nothing that matters goes in a deleted scratch file or a `console.log`.
 *
 * The filename ends in `.evidence.ts`, not `.test.ts`, so the package's
 * vitest `include` (`src/**\/*.{test,spec}.{ts,tsx}`) never picks it up: it
 * cannot enter the test count and cannot redden preflight. The leftover
 * probe rule keeps its full force over `*.test.ts`, which is where it was
 * earned.
 *
 * Output goes through `process.stdout.write`, NOT `console.log`. Vitest 4
 * discards `console.*` from PASSING tests unless a reporter is passed
 * explicitly, and no soak leg passes one — which is exactly how four
 * readouts went mute in this repo. A harness whose entire purpose is to
 * print numbers must not use the channel that gets dropped.
 *
 * WHAT IS DUPLICATED HERE, AND WHY. The guard logic below is a copy of
 * `frozenSignatures` / `stripFurniture` from `conformanceOracles.ts`,
 * deliberately: the harness has to run the PRE-audit behaviour, which the
 * source no longer contains, so it cannot call the real one for both arms.
 * Everything else is imported — in particular `runToRawLayer`, which was
 * exported (102c7fe) precisely because a copied raw layer stops being the
 * layer under test the moment production's plugin assembly moves. Only the
 * part that must differ is duplicated; nothing that must match is.
 *
 * If a future change makes the copied guard logic disagree with the real
 * `frozenSignatures`, the `POST` arm below stops modelling the shipped gate
 * and every number here is void without saying so. The cheap check when
 * that is a worry: run the raw-mode sweep on the same corpus and confirm
 * its `snapNodes` matches `POST`'s signature count.
 *
 * @module components/incrementalParse/gateExemptionEvidence.evidence
 */

import { describe, test } from 'vitest';
import fc from 'fast-check';

import { CATALOG, buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { runFull, testEnv } from './spliceArbiterHarness';
import { probeTailsFor, runToRawLayer, type NodeLike } from './conformanceOracles';
import { benignDocArb, hazardDocArb, type FuzzDoc } from './fuzzGenerators';

/** Test-only stdout access. The package's ambient `process` shim narrows to
 *  `env` alone (`"types": ["vitest/globals"]`, no `@types/node`), which is
 *  the same reason `testEnv` exists next door — so the cast is local and
 *  documented rather than repeated at each call. */
const out = (s: string): void => {
  (process as unknown as { stdout: { write(text: string): void } }).stdout.write(s);
};

interface Guards {
  /** Pre-audit: strip footer furniture by the `data-footnotes` WRAPPER. */
  wrapperStrip: boolean;
  /** The F22 fix: only a footer with NO position counts as generated. */
  wrapperNeedsNoPos: boolean;
  /** Exempt by the definition's SOURCE BYTES (the gate's only carve-out). */
  byteStrip: boolean;
  /** Pre-audit: the byte exemption skipped the whole subtree. */
  byteSkipsSubtree: boolean;
  invertedGuard: boolean;
  zeroWidthGuard: boolean;
}

const PRE: Guards = {
  wrapperStrip: true,
  wrapperNeedsNoPos: false,
  byteStrip: true,
  byteSkipsSubtree: true,
  invertedGuard: true,
  zeroWidthGuard: true,
};
const POST: Guards = { ...PRE, wrapperStrip: false, wrapperNeedsNoPos: true, byteSkipsSubtree: false };

const isFn = (n: NodeLike, g: Guards): boolean =>
  n.type === 'element' &&
  n.properties !== undefined &&
  'dataFootnotes' in n.properties &&
  (!g.wrapperNeedsNoPos || n.position === undefined);

const holds = (n: NodeLike, g: Guards): boolean => (n.children ?? []).some((c) => isFn(c, g) || holds(c, g));

function stripFurniture(children: NodeLike[], g: Guards): NodeLike[] {
  if (!g.wrapperStrip) return children;
  const kept: NodeLike[] = [];
  for (const child of children) {
    if (isFn(child, g)) {
      const prev = kept[kept.length - 1];
      if (prev?.type === 'text' && /^\s*$/.test(prev.value ?? '')) kept.pop();
      continue;
    }
    kept.push(holds(child, g) ? { ...child, children: stripFurniture(child.children ?? [], g) } : child);
  }
  return kept;
}

function fnRanges(mdast: NodeLike, acc: Array<[number, number]> = []): Array<[number, number]> {
  for (const child of mdast.children ?? []) {
    const s = child.position?.start?.offset;
    const e = child.position?.end?.offset;
    if (child.type === 'footnoteDefinition' && s !== undefined && e !== undefined) acc.push([s, e]);
    else fnRanges(child, acc);
  }
  return acc;
}

function signatures(
  nodes: NodeLike[],
  boundary: number,
  bytes: Array<[number, number]>,
  g: Guards,
  acc: string[] = []
): string[] {
  for (const node of nodes) {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    const exempt = g.byteStrip && start !== undefined && bytes.some(([s, e]) => start >= s && start < e);
    if (exempt && g.byteSkipsSubtree) continue;
    if (
      !exempt &&
      start !== undefined &&
      end !== undefined &&
      (!g.invertedGuard || start <= end) &&
      (!g.zeroWidthGuard || start < boundary) &&
      end <= boundary
    ) {
      acc.push(
        `${start}-${end}:${node.type}:${node.tagName ?? ''}:` +
          `${JSON.stringify(node.properties ?? null)}:${JSON.stringify(node.value ?? null)}`
      );
    }
    signatures(node.children ?? [], boundary, bytes, g, acc);
  }
  return acc;
}

function gate(
  doc: string,
  tail: string,
  boundary: number,
  config: CatalogConfig,
  g: Guards,
  docMdast: NodeLike
): { fired: boolean; compared: number } {
  const bytes = fnRanges(docMdast);
  const frozen = signatures(stripFurniture(runToRawLayer(doc, config).children ?? [], g), boundary, bytes, g);
  const appended = new Set(
    signatures(stripFurniture(runToRawLayer(doc + tail, config).children ?? [], g), boundary, bytes, g)
  );
  return { fired: frozen.some((s) => !appended.has(s)), compared: frozen.length };
}

/** Planted over-block: claim MORE frozen than the scanner granted, by
 *  extending the boundary to the end of the next line. Recall is measured
 *  against this, because a gate that loses recall while getting tighter has
 *  traded away the thing it is for. */
const overBlock = (doc: string, granted: number): number => {
  const nl = doc.indexOf('\n', granted);
  return nl === -1 ? doc.length : Math.min(doc.length, nl + 1);
};

interface Arm {
  label: string;
  guards: Guards;
}
const ARMS: Arm[] = [
  { label: 'PRE (v2.8.2)', guards: PRE },
  { label: 'POST (54c5151)', guards: POST },
  { label: 'no-wrapperStrip', guards: { ...PRE, wrapperStrip: false } },
  { label: 'no-byteStrip', guards: { ...PRE, byteStrip: false } },
  { label: 'no-inverted', guards: { ...PRE, invertedGuard: false } },
  { label: 'no-zeroWidth', guards: { ...PRE, zeroWidthGuard: false } },
];

function sweep(name: string, arb: fc.Arbitrary<FuzzDoc>, seed: number, runs: number, planted: boolean): void {
  const docs = fc.sample(arb, { seed, numRuns: runs });
  const fires = new Map<string, number>();
  const compared = new Map<string, number>();
  const positions = new Map<string, number>();
  for (const d of docs) {
    const config = CATALOG[d.configIndex % CATALOG.length];
    const { defListEnabled } = buildAdvanceOptions(config);
    const granted = computeFreezeBoundary(d.doc, { defListEnabled }).boundary;
    if (granted <= 0) continue;
    const boundary = planted ? overBlock(d.doc, granted) : granted;
    const mdast = runFull(d.doc, config).mdast as NodeLike;
    for (const probe of probeTailsFor(d.doc.slice(0, granted))) {
      if (probe.tail === '') continue;
      for (const arm of ARMS) {
        const r = gate(d.doc, probe.tail, boundary, config, arm.guards, mdast);
        compared.set(arm.label, (compared.get(arm.label) ?? 0) + r.compared);
        if (r.compared > 0) positions.set(arm.label, (positions.get(arm.label) ?? 0) + 1);
        if (r.fired) fires.set(arm.label, (fires.get(arm.label) ?? 0) + 1);
      }
    }
  }
  out(`\n  ${name} (${runs} docs, seed ${seed}${planted ? ', PLANTED over-block' : ', granted boundary'})\n`);
  out(`    ${'arm'.padEnd(18)} ${'fires'.padStart(7)} ${'signatures'.padStart(12)} ${'positions'.padStart(10)}\n`);
  for (const arm of ARMS) {
    out(
      `    ${arm.label.padEnd(18)} ${String(fires.get(arm.label) ?? 0).padStart(7)} ` +
        `${String(compared.get(arm.label) ?? 0).padStart(12)} ${String(positions.get(arm.label) ?? 0).padStart(10)}\n`
    );
  }
}

describe('gate exemption evidence', () => {
  test('the two comparative measurements behind 54c5151', { timeout: 3_600_000 }, () => {
    const seed = Number(testEnv('EVIDENCE_SEED') ?? 20298311);
    const suppressionRuns = Number(testEnv('EVIDENCE_SUPPRESSION_RUNS') ?? 2000);
    const recallRuns = Number(testEnv('EVIDENCE_RECALL_RUNS') ?? 800);

    out('\n=== 1. SUPPRESSION: does any exemption suppress a signature the byte one does not? ===\n');
    out('    Landed reading (seed 20298311, 2000 docs each): every arm except `no-byteStrip`\n');
    out('    reports IDENTICAL signature counts — benign 89,570, hazard 47,364. That is the\n');
    out('    measurement that removed `stripFurniture` from the gate: an exemption with no\n');
    out('    firing that needs it is not a safety margin, it is unaudited surface. Dropping\n');
    out('    the BYTE exemption instead reproduces F21 immediately (hazard fires 0 -> 1).\n');
    sweep('benign', benignDocArb, seed, suppressionRuns, false);
    sweep('hazard', hazardDocArb, seed + 1, suppressionRuns, false);

    out('\n=== 2. RECALL: did the tightening blind the gate? ===\n');
    out('    Landed reading (seed 20298311, 800 docs each, boundary extended one line):\n');
    out('    PRE and POST fire identically — benign 126, hazard 97 — comparing an identical\n');
    out('    42,687 / 24,095 signatures at an identical 3,627 / 3,080 positions. Recall is\n');
    out('    preserved exactly, which is the claim "no recall lost" rests on.\n');
    sweep('benign', benignDocArb, seed, recallRuns, true);
    sweep('hazard', hazardDocArb, seed + 1, recallRuns, true);

    out('\n  Sanity: PRE and POST must agree on RECALL and may differ only where a document\n');
    out('  forges the footer wrapper (F22). The fuzz generators emit no `data-footnotes`,\n');
    out('  so on THIS corpus the two arms are expected to be identical throughout; the\n');
    out('  forged-wrapper divergence is pinned as a self-test in oracleConformance.test.ts.\n\n');
  });
});
