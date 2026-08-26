/**
 * P1 conformance sweep: the engine probe (authoritative), the (M) span
 * oracle and the (P) identity instruments against the scanner's own
 * boundary, over the pinned corpus and an env-scaled fuzz slice.
 *
 * Env knobs (same pattern as spliceFuzz):
 *   ORACLE_RUNS  fuzz docs per family (default 40; soak runs use thousands)
 *   ORACLE_SEED  fast-check seed for the fuzz slice (default 20260824)
 *
 * The self-test group is the harness-validation half of §2.3: an oracle
 * that has only ever reported zero has not been tested, so the known
 * diverging shapes (formElement, doctype erasure, def-list back-claim,
 * lazy continuation, orphan-footnote retarget) are asserted to FIRE, on
 * hand-built (prefix, tail) pairs that bypass the scanner — the scanner
 * (correctly) never offers those boundaries, which is exactly why the
 * instruments must be validated without it.
 *
 * Sweeps assert zero DEFECT findings. `info` findings (instrument fired,
 * engine still correct — refused tail, seam-absorbed, sanitize-masked) are
 * collected and printed for T1.5 classification, never failed on: turning
 * them into failures would either bury defects in noise or pressure the
 * instruments into leniency.
 */

import { describe, expect, test } from 'vitest';
import fc from 'fast-check';

import { CATALOG } from './testPluginCatalog';
import {
  mSpanDisagreement,
  pipelineIdentityDisagreement,
  rawLayerIdentityDisagreement,
  probeTailsFor,
  oracleCheckDoc,
  engineProbe,
  type OracleSweepStats,
} from './conformanceOracles';
import { REALISTIC_DOCS, pinnedFuzzDocs } from './pinnedCorpus';
import { testEnv } from './spliceArbiterHarness';
import { benignDocArb, hazardDocArb, type FuzzDoc } from './fuzzGenerators';

describe('oracle self-tests (must fire / must stay quiet)', () => {
  test('the formElement counterexample fires at both identity layers', () => {
    // Design §2.1's fifth condition: the prefix leaves parse5's
    // formElement pointer non-null (implicitly closed form), so a tail
    // <form> is ignored in the full parse but real in the split parse.
    // Every enumerated (P) condition is clean here — only the identity
    // sees it. Sanitize masks the ELEMENT difference (form is lifted),
    // but the lifted text lands as its own node while the full parse's
    // text merged into the seam — the grouping echo keeps the final layer
    // firing too.
    const prefix = '<div><form></div>\n\n';
    const tail = '<form>b</form>\n';
    expect(rawLayerIdentityDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
    expect(pipelineIdentityDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('the def-list back-claim fires on the M oracle', () => {
    // `: description` reaches BACKWARD across one blank to claim the
    // paragraph as a <dt> — the paragraph's covering spans change.
    const prefix = 'term paragraph\n\n';
    const tail = ': claimed description\n';
    const defListConfig = CATALOG.find((c) => c.defList)!;
    expect(mSpanDisagreement(prefix, tail, defListConfig)).not.toBeNull();
    // Under a config without the extension the same tail is inert.
    const plainConfig = CATALOG.find((c) => !c.defList)!;
    expect(mSpanDisagreement(prefix, tail, plainConfig)).toBeNull();
  });

  test('list continuation across the blank fires on the M oracle', () => {
    const prefix = '- item one\n\n';
    const tail = '  continuation of the item\n';
    expect(mSpanDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('a footnote definition tail retargets an orphan ref (R dimension)', () => {
    const prefix = 'uses [^x] here\n\n';
    const tail = '[^x]: now defined\n';
    expect(mSpanDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('a raw-text element open across the blank fires (F10 shape)', () => {
    // <iframe> block + blank: micromark ended the type-6 block, parse5's
    // raw-text state runs on — later bytes are elements to one grammar
    // and text to the other.
    const prefix = '<iframe>\n\n';
    const tail = '<div>probe</div>\n\n</iframe>\n';
    expect(rawLayerIdentityDisagreement(prefix, tail, CATALOG[0])).not.toBeNull();
  });

  test('the M oracle stays quiet on paragraph prefixes for every probe', () => {
    const prefix = 'para one with *emphasis*\n\npara two\n\n';
    for (const config of CATALOG) {
      for (const probe of probeTailsFor(prefix)) {
        if (probe.id === 'defListClaim' && config.defList) continue; // fires by design, asserted above
        expect(mSpanDisagreement(prefix, probe.tail, config), `M [${config.label}] probe=${probe.id}`).toBeNull();
      }
    }
  });

  test('the engine probe stays quiet on paragraph prefixes for every probe', () => {
    const doc = 'para one with *emphasis*\n\npara two\n\n';
    for (const config of CATALOG) {
      for (const probe of probeTailsFor(doc)) {
        const { disagreement } = engineProbe(doc, probe.tail, config);
        expect(disagreement, `engine [${config.label}] probe=${probe.id}`).toBeNull();
      }
    }
  });
});

// ORACLE_RAW=1 adds the prefix-anchored ideal-identity instruments to the
// sweeps (exploratory; they overclaim at evidence-dependent boundaries).
const RAW_MODE = testEnv('ORACLE_RAW') === '1';
const ORACLE_OPTS = { idealIdentity: RAW_MODE };

/**
 * The exemption allowlist (GRAMMAR-COVERAGE's classification ledger). Under
 * ORACLE_RAW=1 a raw-layer firing that matches NO family is a FAILURE, not
 * an info line: until 2026-08-26 the raw mode could not fail at all, so it
 * gated nothing and a new divergence family would have arrived as one more
 * line in a log nobody diffs.
 */
const unclassifiedRawFirings = (findings: Array<{ probeId: string; detail: string; rawFamily?: unknown }>): string[] =>
  findings
    .filter((f) => f.detail.startsWith('P-raw') && (f.rawFamily ?? null) === null)
    .map((f) => `probe=${f.probeId} ${f.detail.slice(0, 400)}`);

const formatFindings = (findings: unknown): string => JSON.stringify(findings, null, 1)?.slice(0, 4000) ?? '';

describe('oracle sweep — pinned realistic corpus', () => {
  const infoLog: string[] = [];

  for (const doc of REALISTIC_DOCS) {
    test(`${doc.id}`, () => {
      const config = CATALOG[doc.configIndex % CATALOG.length];
      const stats: OracleSweepStats = { probesRun: 0, spliceableProbes: 0, incrementalProbes: 0 };
      const findings = oracleCheckDoc(doc.doc, config, stats, 0, ORACLE_OPTS);
      const defects = findings.filter((f) => f.severity === 'defect');
      for (const f of findings.filter((f) => f.severity === 'info')) {
        infoLog.push(`${doc.id} [${config.label}] probe=${f.probeId} ${f.detail.slice(0, 160)}`);
      }
      const unclassified = unclassifiedRawFirings(findings);
      expect(
        unclassified,
        `${doc.id} [${config.label}] raw-layer firing outside the E1-E7 allowlist — classify it in ` +
          `GRAMMAR-COVERAGE's ledger and name it in classifyRawFamily before allowing it back:\n${unclassified.join('\n')}`
      ).toEqual([]);
      expect(defects, `${doc.id} [${config.label}] ${formatFindings(defects)}`).toEqual([]);
      // The sweep must exercise the incremental path, not just prove the
      // fallback correct — and the counter must be the NON-EMPTY-tail one,
      // for the reason recorded on `OracleSweepStats.spliceableProbes`.
      expect(stats.spliceableProbes).toBeGreaterThan(0);
      expect(
        stats.incrementalProbes,
        `${doc.id} spliced ${stats.incrementalProbes}/${stats.spliceableProbes} non-empty-tail probes`
      ).toBeGreaterThanOrEqual(Math.ceil(stats.spliceableProbes / 2));
    });
  }

  test('classification log (informational)', () => {
    if (infoLog.length > 0) console.log(`[oracle info] ${infoLog.length} instrument firings:\n${infoLog.join('\n')}`);
    expect(true).toBe(true);
  });
});

describe('oracle sweep — fuzz corpus (env-scaled)', () => {
  const runs = Number(testEnv('ORACLE_RUNS') ?? 40);
  const seed = Number(testEnv('ORACLE_SEED') ?? 20260824);

  const sweep = (name: string, arb: fc.Arbitrary<FuzzDoc>, seedOffset: number) => {
    // ~25 docs/s (each doc runs ~9 probes × two engine frames + the layer
    // instruments); the default 5 s timeout marks a COMPLETED zero-defect
    // sweep as failed at soak scale.
    test(`${name} × ${runs}`, { timeout: Math.max(30_000, runs * 100) }, () => {
      const docs = fc.sample(arb, { seed: seed + seedOffset, numRuns: runs });
      const stats: OracleSweepStats = { probesRun: 0, spliceableProbes: 0, incrementalProbes: 0 };
      const failures: string[] = [];
      const unclassifiedRaw: string[] = [];
      const infoBuckets = new Map<string, number>();
      const infoExamples = new Map<string, string[]>();
      docs.forEach((d, i) => {
        const config = CATALOG[d.configIndex % CATALOG.length];
        const findings = oracleCheckDoc(d.doc, config, stats, 0, ORACLE_OPTS);
        for (const f of findings.filter((f) => f.severity === 'info')) {
          // Aggregate by layer + probe: at soak scale the classification
          // question is "which exemption family", not "which sample" — but
          // keep two samples per bucket so a NEW family is classifiable
          // from the log without a re-run.
          const bucket = `${f.detail.split(':')[0]}/${f.probeId}${f.rawFamily ? `/${f.rawFamily}` : ''}`;
          infoBuckets.set(bucket, (infoBuckets.get(bucket) ?? 0) + 1);
          const ex = infoExamples.get(bucket) ?? [];
          if (ex.length < 2) {
            ex.push(`doc#${i}=${JSON.stringify(d.doc).slice(0, 120)} ${f.detail.slice(0, 260)}`);
            infoExamples.set(bucket, ex);
          }
        }
        const defects = findings.filter((f) => f.severity === 'defect');
        if (defects.length > 0) {
          failures.push(
            `#${i} [${config.label}] doc=${JSON.stringify(d.doc).slice(0, 200)} ${formatFindings(defects).slice(0, 600)}`
          );
        }
        for (const u of unclassifiedRawFirings(findings)) {
          unclassifiedRaw.push(`#${i} [${config.label}] doc=${JSON.stringify(d.doc).slice(0, 200)} ${u}`);
        }
      });
      const buckets = [...infoBuckets.entries()].sort((a, b) => b[1] - a[1]);
      console.log(
        `[oracle ${name}] probes=${stats.probesRun} spliceable=${stats.spliceableProbes} incremental=${stats.incrementalProbes} info=${buckets.reduce((a, [, n]) => a + n, 0)}\n` +
          buckets
            .map(([k, n]) => `  ${k} ×${n}\n${(infoExamples.get(k) ?? []).map((e) => `    ${e}`).join('\n')}`)
            .join('\n')
      );
      expect(failures, failures.join('\n---\n').slice(0, 6000)).toEqual([]);
      // Under ORACLE_RAW=1 the allowlist is a GATE: an unclassified family
      // fails the sweep instead of adding a line to the info log.
      expect(
        unclassifiedRaw,
        `raw-layer firings outside the E1-E7 allowlist (${unclassifiedRaw.length}) — classify each in ` +
          `GRAMMAR-COVERAGE's ledger and name it in classifyRawFamily:\n${unclassifiedRaw.slice(0, 12).join('\n')}`
      ).toEqual([]);
      // Anti-vacuity floor, over NON-EMPTY tails only. The old form counted
      // every probe and so could not fall below 4/doc even with the splice
      // torn out — an identical-content frame is a memo hit that reports
      // `usedIncremental` without splicing anything. Measured engagement on
      // this counter sits near 90% for both families; half is a collapse
      // detector with room for hazard drift.
      expect(stats.spliceableProbes).toBeGreaterThan(0);
      expect(
        stats.incrementalProbes / stats.spliceableProbes,
        `the sweep spliced ${stats.incrementalProbes}/${stats.spliceableProbes} non-empty-tail probes — it proved little`
      ).toBeGreaterThan(0.5);
    });
  };

  sweep('benign', benignDocArb, 0);
  sweep('hazard', hazardDocArb, 1);
});

describe('pinned corpus integrity', () => {
  test('the fuzz slice is deterministic for this fast-check build', () => {
    const a = pinnedFuzzDocs();
    const b = pinnedFuzzDocs();
    expect(a.length).toBe(2000);
    expect(a[0].doc).toBe(b[0].doc);
    expect(a[1999].doc).toBe(b[1999].doc);
  });
});
