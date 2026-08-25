/**
 * Migration B row 4 (exact type 7): code-span masking follows the MEMBER,
 * not the retired any-`<`-line proxy.
 *
 * Masking is valid exactly where micromark parses inline content. The
 * proxy suppressed it on every line between a `<`-starting line and the
 * next blank — including paragraph continuations micromark measurably
 * parses inline, where a backticked tag IS a code span parse5 never sees.
 * The two pins below hold the line in both directions.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (doc: string) => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;

describe('masking follows the member (row 4)', () => {
  test('paragraph continuation after a truncated non-type-6 opener: the backticked tag is a code span', () => {
    // `<embed x` is a PARAGRAPH (embed is not a type-6 name and the line
    // is not a complete tag); its continuation line's backticked `<div>`
    // is inline code — parse5 receives a <code> element, no div opens,
    // and the boundary passes. Under the proxy the div was counted open
    // and the document never froze (the +94 rise on pinned benign-201 is
    // this class, engine-probe verified).
    const doc = '<embed x\n`<div>` y\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(doc)).toBeGreaterThan(0);
    for (const sizes of [
      [4, 4, 4, 4, 4, 4, 4, 4],
      [1, 4, 4, 4, 4, 4, 4, 4],
    ]) {
      assertStreamEquivalence('row4-rise', scheduleSnapshots(doc, sizes), CATALOG[0]);
    }
  }, 30_000);

  test('inside a REAL type-7 run the backticks are literal and the tag stays counted (flip pin)', () => {
    // After a heading the complete tag opens a type-7 block; its content
    // lines are raw to micromark — masking there would hide the real
    // `<div>` from the balance and the boundary would sail past an open
    // element. The member suppresses masking; the div blocks freezing.
    const doc = '# h\n<x-y>\n`<div>` literal\n</x-y>\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(doc)).toBe(0);
    for (const sizes of [
      [4, 4, 4, 4, 4, 4, 4, 4],
      [1, 4, 4, 4, 4, 4, 4, 4],
    ]) {
      assertStreamEquivalence('row4-flip', scheduleSnapshots(doc, sizes), CATALOG[0]);
    }
  }, 30_000);

  test('a 2-5 opener STARTING the line suppresses masking too (the proxy never covered `<?`)', () => {
    // `<? x `?>` y` — the whole line is a type-3 block; the backticks are
    // raw bytes, so the `?>` inside them is the REAL terminator and must
    // stay visible to the construct machine. Suppression keeps it seen;
    // the shape streams like a full parse.
    const doc = '<? x `?>` y\n\ntail one\n\nend\n';
    for (const sizes of [
      [4, 4, 4, 4, 4],
      [1, 4, 4, 4, 4],
    ]) {
      assertStreamEquivalence('row4-pi', scheduleSnapshots(doc, sizes), CATALOG[0]);
    }
  }, 30_000);
});
