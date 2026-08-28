/**
 * EVIDENCE HARNESS — not a test. Run it from `scripts/soak/gate-evidence.sh`.
 *
 * It reproduces the two COMPARATIVE measurements that justify the raw-mode
 * gate's exemption set (the 2026-08-28 audit, "the gate trusted a footer
 * key any document can write"). Neither can
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
 * exported ("a copied runToRawLayer stops observing the layer it names")
 * precisely because a copied raw layer stops being the
 * layer under test the moment production's plugin assembly moves. Only the
 * part that must differ is duplicated; nothing that must match is.
 *
 * If a future change makes the copied guard logic disagree with the real
 * `frozenSignatures`, the `POST` arm below stops modelling the shipped gate
 * and every number here is void without saying so. So the harness checks
 * that itself, every run: at EVERY probe position it also calls the real
 * `snapshotRawDisagreement` and compares both the node count and the
 * verdict, reporting `POST vs the shipped gate: N disagreements over M
 * positions`. Anything but 0 voids the tables above and says so on the line.
 *
 * An earlier draft told the maintainer to compare `POST`'s signature count
 * against the sweep's `snapNodes` instead. That is not executable: the
 * sweep's totals also include the zero-distance recursion, which this
 * harness does not run, so the two legitimately differ (measured: 689 vs
 * 1177 benign) and the check cries wolf every time it is followed. A
 * defence that false-alarms on a healthy system is followed once and then
 * ignored — which is worse than no defence, because it looks like one.
 *
 * @module components/incrementalParse/gateExemptionEvidence.evidence
 */

import { describe, test } from 'vitest';
import fc from 'fast-check';

import { CATALOG, buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { runFull, testEnv } from './spliceArbiterHarness';
import { probeTailsFor, runToRawLayer, snapshotRawDisagreement, type NodeLike } from './conformanceOracles';
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
  { label: 'POST (2026-08-28)', guards: POST },
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
  // Faithfulness of the POST arm to the SHIPPED gate, per probe position.
  let checked = 0;
  let drifted = 0;
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
        if (arm.guards === POST) {
          // The copied guard logic must agree with the real thing at EVERY
          // position, on both the count and the verdict. Aggregates cannot
          // do this job: `oracleCheckDoc` also runs the zero-distance
          // recursion, so its totals are legitimately larger and comparing
          // them cries wolf on a healthy harness.
          const real = snapshotRawDisagreement(d.doc, probe.tail, boundary, config, mdast);
          checked += 1;
          if (real.nodesCompared !== r.compared || (real.detail !== null) !== r.fired) drifted += 1;
        }
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
  out(
    `    POST vs the shipped gate: ${drifted} disagreements over ${checked} positions` +
      `${drifted === 0 ? '' : '  <-- THE NUMBERS ABOVE ARE VOID'}\n`
  );
}

/**
 * The two exemptions the fuzz sweeps never exercise, and an honest account
 * of how far their justification reproduces.
 *
 * `no-inverted` and `no-zeroWidth` report counts identical to PRE/POST on
 * every corpus measured, so by the rule that deleted `stripFurniture` — an
 * exemption with no firing that needs it is unaudited surface — they look
 * like the same case. Each was kept on a single measured node, recorded in
 * prose, which is precisely the justification shape that decays.
 *
 * WHAT THIS REPRODUCES: that each guard removes exactly one node from the
 * comparison, deterministically, on all six configs. Documents below.
 *
 * WHAT IT DOES NOT: the reason each was added was a FALSE POSITIVE — a
 * firing the guard prevents. That half does not reproduce. Searching 2,400
 * documents across both corpora and four seeds for any (document, probe)
 * where the gate is quiet with the guard and FIRES without it returned
 * **zero** for both guards (2026-08-28). So on everything reachable today,
 * these two guards change what is compared and never change a verdict.
 *
 * That is deliberately not resolved in either direction here. It is not
 * evidence the guards are needed, and not evidence they are safe to delete:
 * the inverted-range case was recorded as this instrument's only false
 * positive across ~346k probe positions, and a corpus that cannot reach a
 * once-per-346k event is not a corpus that has refuted it. Deleting them on
 * this evidence would be the same over-reading as keeping them on it.
 */
function singleNodeExemptions(): void {
  const cases = [
    {
      label: 'inverted range',
      // A `<div>` opened inside a blockquote: rehype-raw reserialisation
      // hands the element the range 7-0. Nothing owns bytes [7,0) — the
      // range is malformed, not a frozen-region fact.
      doc: '> text <div>\n> more\n\nfollowing para\n\n',
      tail: 'probe tail text\n',
      boundary: (d: string) => d.length,
      guard: 'invertedGuard' as const,
    },
    {
      label: 'zero-width at boundary',
      // The 281d artifact: the tail line collapses its own paragraph to a
      // zero-width raw node sitting exactly AT the boundary. It owns no
      // frozen byte, so it is not the scanner's claim.
      doc: 'x\n\np<iframe> x </iframe a> y\nmore\n',
      tail: 'probe tail text\n',
      boundary: () => 3,
      guard: 'zeroWidthGuard' as const,
    },
  ];
  out('\n=== 3. THE TWO SINGLE-NODE EXEMPTIONS (invisible to the sweeps above) ===\n');
  for (const c of cases) {
    out(`\n  ${c.label}: ${JSON.stringify(c.doc)}\n`);
    for (const config of CATALOG) {
      const b = c.boundary(c.doc);
      const mdast = runFull(c.doc, config).mdast as NodeLike;
      const withGuard = gate(c.doc, c.tail, b, config, PRE, mdast);
      const without = gate(c.doc, c.tail, b, config, { ...PRE, [c.guard]: false }, mdast);
      const verdict =
        withGuard.compared === without.compared
          ? 'NO EFFECT — this document no longer reaches the exemption'
          : `exempts ${without.compared - withGuard.compared} node(s): ` +
            `${withGuard.compared} -> ${without.compared} signatures; ` +
            `verdict ${withGuard.fired ? 'fires' : 'quiet'} -> ${without.fired ? 'fires' : 'quiet'}` +
            `${withGuard.fired === without.fired ? ' (UNCHANGED — the node is removed, no false positive is prevented)' : ' (the guard prevents a firing)'}`;
      out(`    [${config.label.padEnd(18)}] ${verdict}\n`);
    }
  }
  out(
    '\n  NO EFFECT means the document stopped reaching the exemption and its\n' +
      '  justification is prose again: find one that reaches it, or retire the\n' +
      '  guard. UNCHANGED means the guard removes the node but prevents no\n' +
      '  false positive HERE — the state of both guards as of 2026-08-28, and\n' +
      '  the open question recorded above rather than decided.\n'
  );
}

describe('gate exemption evidence', () => {
  test('the two comparative measurements behind the 2026-08-28 audit', { timeout: 3_600_000 }, () => {
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

    singleNodeExemptions();

    out('\n  Sanity: PRE and POST must agree on RECALL and may differ only where a document\n');
    out('  forges the footer wrapper (F22). The fuzz generators emit no `data-footnotes`,\n');
    out('  so on THIS corpus the two arms are expected to be identical throughout; the\n');
    out('  forged-wrapper divergence is pinned as a self-test in oracleConformance.test.ts.\n\n');
  });
});
