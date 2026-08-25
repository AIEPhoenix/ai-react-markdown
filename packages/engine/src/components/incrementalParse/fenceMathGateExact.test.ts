/**
 * Migration B row 6 (exact type 7): the fence/math suppression gate reads
 * the html-block MEMBER, with the phasePoisonedAt backstop kept.
 *
 * A ``` / `$$` line inside a real html-flow run is raw text (suppress the
 * open, poison the phase — the member is container-blind, so whether the
 * run really swallowed the line stays container-dependent). After a
 * `<embed x`-style PARAGRAPH opener the fence/math open is REAL — the
 * retired proxy suppressed it, which was the seed-20260757
 * phase-corruption class.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (doc: string) => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;

const stream = (label: string, doc: string) => {
  for (const sizes of [
    [4, 4, 4, 4, 4, 4, 4, 4],
    [1, 4, 4, 4, 4, 4, 4, 4],
  ]) {
    assertStreamEquivalence(label, scheduleSnapshots(doc, sizes), CATALOG[0]);
  }
};

describe('fence/math suppression follows the member (row 6)', () => {
  test('a fence after a paragraph tag-opener is REAL: its content is code, not markup', () => {
    // `<div>inside` sits in a fence — parse5 receives a <code> block, no
    // div opens, the boundary passes. Under the proxy the fence was
    // suppressed, the div counted, and the phase poisoned.
    const doc = '<embed x\n```\n<div>inside\n```\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(doc)).toBeGreaterThan(0);
    stream('row6-fence-rise', doc);
  }, 30_000);

  test('a math open after a paragraph tag-opener is REAL', () => {
    const doc = '<embed x\n$$\nE = mc^2\n$$\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(doc)).toBeGreaterThan(0);
    stream('row6-math-rise', doc);
  }, 30_000);

  test('inside a REAL run the fence line is raw text: suppressed AND poisoned (flip pin)', () => {
    // The ``` line belongs to the type-7 block; entering fence state
    // would skip tag extraction on rehype-raw-real markup. The poison is
    // sticky — clean prose after the run must not resurrect candidates.
    const doc = '# h\n<x-y>\n```\n</x-y>\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(doc)).toBe(0);
    stream('row6-flip', doc);
  }, 30_000);

  test('the classic `</details>` + glued fence counterexample still blocks', () => {
    // The original fuzz counterexample for the suppression: a fence glued
    // to a type-6 run hiding a quoted `<div>`. The member (type 6) keeps
    // the suppression + poison.
    const doc = '</details>\n``` "<div>"\nx\n\ntail one\n\nend\n';
    expect(boundary(doc)).toBe(0);
    stream('row6-details', doc);
  }, 30_000);
});
