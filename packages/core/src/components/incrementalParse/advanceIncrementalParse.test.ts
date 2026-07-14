/**
 * Gate-semantics tests for the incremental-parse state machine. Output
 * CORRECTNESS is the splice-equivalence arbiter's job; these tests pin the
 * control flow: which gate fires, what `usedIncremental`/`boundary` report,
 * and what `nextState` records on each path.
 */

import { describe, expect, test } from 'vitest';

import { advanceIncrementalParse, type IncrementalParseState } from './advanceIncrementalParse';
import { buildAdvanceOptions, CATALOG } from './testPluginCatalog';

const BASE = () => buildAdvanceOptions(CATALOG[0]);

const DOC = 'para one.\n\npara two.\n\n';
const GROWN = `${DOC}para three.\n\n`;

function seed(content: string = DOC): IncrementalParseState {
  return advanceIncrementalParse(null, content, BASE()).nextState;
}

describe('advanceIncrementalParse — gates', () => {
  test('no previous state → full path, boundary reported as 0', () => {
    const result = advanceIncrementalParse(null, DOC, BASE());
    expect(result.usedIncremental).toBe(false);
    expect(result.boundary).toBe(0);
    // …but the boundary is still recorded for the NEXT frame.
    expect(result.nextState.stableBoundary).toBeGreaterThan(0);
    expect(result.nextState.content).toBe(DOC);
  });

  test('equal content short-circuits and returns the previous trees by reference', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, DOC, BASE());
    expect(result.usedIncremental).toBe(true);
    expect(result.mdast).toBe(prev.mdast);
    expect(result.hast).toBe(prev.hast);
  });

  test('G0: depsKey identity mismatch → full path', () => {
    const prev = seed();
    const options = { ...BASE(), depsKey: ['different'] };
    const result = advanceIncrementalParse(prev, GROWN, options);
    expect(result.usedIncremental).toBe(false);
    expect(result.nextState.depsKey).toEqual(['different']);
  });

  test('G1: non-append rewrite → full path', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, DOC.replace('one', 'ONE'), BASE());
    expect(result.usedIncremental).toBe(false);
  });

  test('G2: footnote syntax anywhere → full path', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, `${DOC}claim[^n] here.\n`, BASE());
    expect(result.usedIncremental).toBe(false);
  });

  test('G3: zero boundary (single growing block) → full path', () => {
    const prev = advanceIncrementalParse(null, 'one long paragraph', BASE()).nextState;
    const result = advanceIncrementalParse(prev, 'one long paragraph keeps growing', BASE());
    expect(result.usedIncremental).toBe(false);
    expect(prev.stableBoundary).toBe(0);
  });

  test('append with a valid boundary → splice path with boundary > 0', () => {
    const prev = seed();
    const result = advanceIncrementalParse(prev, GROWN, BASE());
    expect(result.usedIncremental).toBe(true);
    expect(result.boundary).toBeGreaterThan(0);
    expect(result.boundary).toBeLessThanOrEqual(prev.content.length);
  });

  test('H1: splice boundary is capped by the PREVIOUS frame boundary', () => {
    // Frame k: unresolved shortcut ref pins prev.stableBoundary to 0.
    const withRef = 'See [spec] here.\n\nfiller.\n\n';
    const prev = seed(withRef);
    expect(prev.stableBoundary).toBe(0);
    // Frame k+1: def arrives and settles — fresh boundary would jump past
    // the (previously literal) ref paragraph, but min() must hold it back.
    const resolved = `${withRef}[spec]: https://example.com\n\ntail.\n\n`;
    const result = advanceIncrementalParse(prev, resolved, BASE());
    expect(result.usedIncremental).toBe(false); // min(fresh, 0) = 0 → full path
    expect(result.nextState.stableBoundary).toBeGreaterThan(0); // recorded for frame k+2
    // Frame k+2 can then splice against the re-parsed (resolved) trees.
    const grown = `${resolved}more prose.\n\n`;
    const next = advanceIncrementalParse(result.nextState, grown, BASE());
    expect(next.usedIncremental).toBe(true);
  });

  test('nextState.stableBoundary is written on both paths from one scan', () => {
    const full = advanceIncrementalParse(null, GROWN, BASE());
    const prev = seed();
    const spliced = advanceIncrementalParse(prev, GROWN, BASE());
    expect(spliced.nextState.stableBoundary).toBe(full.nextState.stableBoundary);
  });

  test('measure hook: scan runs once per new content, zero-scan short-circuits skip it', () => {
    const stages: string[] = [];
    const options = {
      ...BASE(),
      measure: <T>(stage: string, fn: () => T): T => {
        stages.push(stage);
        return fn();
      },
    };
    const prev = advanceIncrementalParse(null, DOC, options).nextState;
    expect(stages).toEqual(['scan', 'parse', 'transform']);
    stages.length = 0;
    advanceIncrementalParse(prev, DOC, options); // equal-content: whole state reused, NO scan
    expect(stages).toEqual([]);
  });

  test('sticky footnote flag: append frames after [^ detection skip the scan entirely', () => {
    const stages: string[] = [];
    const options = {
      ...BASE(),
      measure: <T>(stage: string, fn: () => T): T => {
        stages.push(stage);
        return fn();
      },
    };
    const withFn = 'a claim[^n] here.\n\n';
    const s1 = advanceIncrementalParse(null, withFn, options).nextState;
    expect(s1.sawFootnote).toBe(true);
    stages.length = 0;
    const r2 = advanceIncrementalParse(s1, `${withFn}more.\n`, options);
    expect(r2.usedIncremental).toBe(false);
    expect(stages).toEqual(['parse', 'transform']); // no 'scan' — the E1 fix
    expect(r2.nextState.sawFootnote).toBe(true);
  });

  test('fence-guarded [^ does NOT disengage splicing (Alt2 fix)', () => {
    const code = '```js\nconst re = /[^0-9]/;\n```\n\npara one.\n\n';
    const prev = advanceIncrementalParse(null, code, BASE()).nextState;
    expect(prev.sawFootnote).toBe(false);
    const r = advanceIncrementalParse(prev, `${code}para two.\n`, BASE());
    expect(r.usedIncremental).toBe(true);
    expect(r.boundary).toBeGreaterThan(0);
  });
});
