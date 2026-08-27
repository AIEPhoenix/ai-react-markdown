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

import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import {
  mSpanDisagreement,
  pipelineIdentityDisagreement,
  rawLayerIdentityDisagreement,
  probeTailsFor,
  oracleCheckDoc,
  engineProbe,
  snapshotRawDisagreement,
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

  test('a planted under-block fires on the P snapshot gate (the gate is not blind)', () => {
    // The snapshot gate had no must-fire plant of its own — the edge fix
    // below could have blinded it silently. Two shapes whose frozen nodes
    // OWN bytes below the (deliberately wrong) boundary and are rewritten
    // by the tail:
    // - a reference the tail's definition retargets (the text node splits
    //   around a new <a>);
    // - the F10 iframe whose raw-text region swallows the probe.
    const ref = snapshotRawDisagreement('uses [x] here\n\n', '[x]: /u\n', 15, CATALOG[0]);
    expect(ref.nodesCompared).toBeGreaterThan(0);
    expect(ref.detail).toMatch(/^P-snap/);
    const f10 = snapshotRawDisagreement('<iframe>\n\n<div>probe</div>\n\n', '</iframe>\n', 28, CATALOG[0]);
    expect(f10.nodesCompared).toBeGreaterThan(0);
    expect(f10.detail).toMatch(/^P-snap/);
  });

  test('a zero-width node AT the boundary stays quiet on the P snapshot gate (281d artifact)', () => {
    // 281d oracle leg, ORACLE_SEED=20294308 benign #558 [no-orphan]: the
    // tail line `p<iframe> x </iframe a> y` collapses its own paragraph
    // element to a ZERO-WIDTH raw node sitting exactly AT the boundary
    // (`297-297:element:p`), and every probe's append legitimately reshapes
    // it. The node owns no frozen byte, so it is not the scanner's claim —
    // engine-clean on seven schedules × six configs, measured before the
    // predicate gained `start < boundary`. Minimal 33-byte reproduction,
    // all configs; nodesCompared stays positive, so the quiet verdict is
    // not vacuous.
    const doc = 'x\n\np<iframe> x </iframe a> y\nmore\n';
    for (const config of CATALOG) {
      const r = snapshotRawDisagreement(doc, 'probe tail text\n', 3, config);
      expect(r.nodesCompared, `[${config.label}] compared`).toBeGreaterThan(0);
      expect(r.detail, `[${config.label}]`).toBeNull();
      const findings = oracleCheckDoc(doc, config, undefined, 0, { idealIdentity: true });
      expect(
        findings.filter((f) => f.detail.startsWith('P-snap')),
        `[${config.label}] full probe battery`
      ).toEqual([]);
    }
  });

  test('a still-open raw-text element does not turn footer furniture into a frozen claim (F21)', () => {
    // v2.8.2 gate, oracle shard 11 (ORACLE_SEED=20298311, hazard #1990):
    // `P-snap: frozen node 49-67:element:li:{"id":"fn-spec"}` — a footnote
    // footer `<li>`, which the gate has always meant to exempt.
    //
    // The exemption used to key on the section wrapper's `data-footnotes`,
    // and a wrapper is a START TAG: any raw-text or escapable-raw-text
    // element still open when remark-rehype's footer is emitted puts parse5
    // in the "text" insertion mode, which drops start tags. The `<section>`
    // and `<h2>` opens vanish, "Footnotes" lands as element text, and the
    // `<ol>` resurfaces at the ROOT — unmarked, so the strip kept it on the
    // open side and removed it on the side the tail closed. All seven
    // members of the class behave identically; `plaintext` does not, because
    // it swallows the `<ol>` too, and neither does a comment.
    //
    // Engine-clean on the whole class before the instrument was touched:
    // 185k frames / 20k engaged over 250 randomized documents × 6 configs,
    // zero divergence, plus the shard's own document at 413 frames per
    // config. The scanner is not involved — boundaries are byte-identical on
    // v2.8.1 (77b1577) and db9f091.
    const withRef = (tag: string) => `uses [^x] here\n\n[^x]: body\n\npara\n\n<${tag}>\n`;
    const orphanOnly = (tag: string) => `[^x]: body\n\npara\n\n<${tag}>\n`;
    for (const tag of ['textarea', 'title', 'style', 'script', 'xmp', 'iframe', 'noembed']) {
      for (const shape of [withRef, orphanOnly]) {
        const doc = shape(tag);
        for (const config of CATALOG) {
          const { defListEnabled } = buildAdvanceOptions(config);
          const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
          const r = snapshotRawDisagreement(doc, `</${tag}>\n`, boundary, config);
          const at = `<${tag}> [${config.label}] b=${boundary}`;
          // Non-vacuous: the body nodes below the boundary are still compared.
          expect(r.nodesCompared, `${at} compared`).toBeGreaterThan(0);
          expect(r.detail, at).toBeNull();
        }
      }
    }
    // Control A — the same shape with a wrapper that SURVIVES. Quiet before
    // and after the fix, so it cannot be what the pin above is measuring.
    for (const config of CATALOG) {
      const doc = 'uses [^x] here\n\n[^x]: body\n\npara\n\n<div>\n';
      const { defListEnabled } = buildAdvanceOptions(config);
      const boundary = computeFreezeBoundary(doc, { defListEnabled }).boundary;
      const r = snapshotRawDisagreement(doc, '</div>\n', boundary, config);
      expect(r.nodesCompared, `<div> [${config.label}] compared`).toBeGreaterThan(0);
      expect(r.detail, `<div> [${config.label}]`).toBeNull();
    }
    // Control B — the exemption is stated in a definition's OWN bytes, so a
    // document that carries one must still be able to fail. The planted
    // reference under-block fires on every config with a footnote definition
    // sitting above it.
    for (const config of CATALOG) {
      const doc = '[^n]: note\n\nuses [x] here\n\n';
      const r = snapshotRawDisagreement(doc, '[x]: /u\n', doc.length, config);
      expect(r.nodesCompared, `plant [${config.label}] compared`).toBeGreaterThan(0);
      expect(r.detail, `plant [${config.label}]`).toMatch(/^P-snap/);
    }
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
 * The ORACLE_RAW gate is the SNAPSHOT-anchored raw identity: any firing
 * fails. It needs no exemption list, because it has no tail-alone parse to
 * produce artifacts about — which is why E1-E7 all measure zero under it.
 *
 * The prefix-anchored form stays as info-only triage beside it, with
 * `classifyRawFamily` demoted from gate to classification aid. See the
 * ledger for the recall/precision tradeoff that decided this.
 */
const snapshotFirings = (findings: Array<{ probeId: string; detail: string }>): string[] =>
  findings.filter((f) => f.detail.startsWith('P-snap')).map((f) => `probe=${f.probeId} ${f.detail.slice(0, 400)}`);

const formatFindings = (findings: unknown): string => JSON.stringify(findings, null, 1)?.slice(0, 4000) ?? '';

describe('oracle sweep — pinned realistic corpus', () => {
  const infoLog: string[] = [];

  for (const doc of REALISTIC_DOCS) {
    test(`${doc.id}`, () => {
      const config = CATALOG[doc.configIndex % CATALOG.length];
      const stats: OracleSweepStats = {
        probesRun: 0,
        spliceableProbes: 0,
        incrementalProbes: 0,
        snapshotNodesCompared: 0,
        snapshotPositions: 0,
      };
      const findings = oracleCheckDoc(doc.doc, config, stats, 0, ORACLE_OPTS);
      const defects = findings.filter((f) => f.severity === 'defect');
      for (const f of findings.filter((f) => f.severity === 'info')) {
        infoLog.push(`${doc.id} [${config.label}] probe=${f.probeId} ${f.detail.slice(0, 160)}`);
      }
      const snapFirings = snapshotFirings(findings);
      expect(
        snapFirings,
        `${doc.id} [${config.label}] the frozen region did not survive an append at the raw layer — ` +
          `this is the scanner's own claim failing, not an instrument artifact:\n${snapFirings.join('\n')}`
      ).toEqual([]);
      expect(defects, `${doc.id} [${config.label}] ${formatFindings(defects)}`).toEqual([]);
      // The sweep must exercise the incremental path, not just prove the
      // fallback correct — and the counter must be the NON-EMPTY-tail one,
      // for the reason recorded on `OracleSweepStats.spliceableProbes`.
      if (RAW_MODE) {
        // The gate must have something to say about this document.
        expect(stats.snapshotPositions, `${doc.id} snapshot gate compared no frozen node`).toBeGreaterThan(0);
      }
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
    // Per-run budget is MEASURED, not guessed (the 100 ms/run guess timed a
    // COMPLETED zero-defect leg-5 sweep out at 4000 runs on the remote box): local dev
    // machine, idle, ORACLE_RUNS=800 — benign 26.3 ms/run, hazard 26.9
    // ms/run (21.1 s / 21.6 s per sweep, 2026-08-27, P0 three-frame probe +
    // snapshot instrument included). The remote box's timeout proves > 100 ms/run
    // on slower server cores under 12-way shard contention, so the budget
    // is 300 ms/run — ≈ 11× the local measurement and ≈ 3× the observed
    // server lower bound. A timeout here marks a FINISHED sweep failed, so
    // generous is the correct direction; real hangs still die within the
    // frame budget.
    test(`${name} × ${runs}`, { timeout: Math.max(60_000, runs * 300) }, () => {
      const docs = fc.sample(arb, { seed: seed + seedOffset, numRuns: runs });
      const stats: OracleSweepStats = {
        probesRun: 0,
        spliceableProbes: 0,
        incrementalProbes: 0,
        snapshotNodesCompared: 0,
        snapshotPositions: 0,
      };
      const failures: string[] = [];
      const snapFirings: string[] = [];
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
        for (const u of snapshotFirings(findings)) {
          snapFirings.push(`#${i} [${config.label}] doc=${JSON.stringify(d.doc).slice(0, 200)} ${u}`);
        }
      });
      const buckets = [...infoBuckets.entries()].sort((a, b) => b[1] - a[1]);
      console.log(
        `[oracle ${name}] probes=${stats.probesRun} spliceable=${stats.spliceableProbes} incremental=${stats.incrementalProbes} ` +
          `snapNodes=${stats.snapshotNodesCompared} snapPositions=${stats.snapshotPositions} info=${buckets.reduce((a, [, n]) => a + n, 0)}\n` +
          buckets
            .map(([k, n]) => `  ${k} ×${n}\n${(infoExamples.get(k) ?? []).map((e) => `    ${e}`).join('\n')}`)
            .join('\n')
      );
      expect(failures, failures.join('\n---\n').slice(0, 6000)).toEqual([]);
      // Under ORACLE_RAW=1 the SNAPSHOT form gates: every firing is the
      // frozen region failing to survive an append, with no exemptions.
      expect(
        snapFirings,
        `snapshot-anchored raw firings (${snapFirings.length}) — the frozen region changed under append:\n` +
          `${snapFirings.slice(0, 12).join('\n')}`
      ).toEqual([]);
      // Anti-vacuity floor for the GATE itself, same discipline as the
      // engagement floors: a gate that compares nothing passes everything.
      // The first prototype of this instrument compared root children only
      // and so compared ZERO nodes at 439 of 797 probe positions — caught
      // by measuring it, not by reasoning about it.
      //
      // The denominator is `spliceableProbes` — NON-EMPTY tails — not
      // `probesRun`. An empty tail compares raw(doc) against itself, and
      // counting those inflated this floor with positions that assert
      // nothing: 12.4% of positions, delivering 99.7% of the budget, so a
      // total gate collapse would have moved the ratio by 0.3%. Same
      // memo-hit shape as the engagement floors, same fix.
      //
      // Landed measurements over non-empty tails: benign 21499 nodes /
      // 2520 positions = 8.53 each, 100% of positions speaking; hazard
      // 10378 / 2281 = 4.55, 95.5%. Floors at 1 node (4.6x margin on the
      // tighter family) and half the positions (1.9x).
      if (RAW_MODE) {
        expect(
          stats.snapshotNodesCompared / stats.spliceableProbes,
          'the snapshot gate compared almost nothing'
        ).toBeGreaterThan(1);
        expect(
          stats.snapshotPositions / stats.spliceableProbes,
          'the snapshot gate was silent at most probe positions'
        ).toBeGreaterThan(0.5);
      }
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
