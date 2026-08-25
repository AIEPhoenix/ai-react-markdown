/**
 * P3a (T3.1/B2) pins: the four byte-shapes where the OLD field quartet
 * held two facts at once — measured before the union landed — must keep
 * their blocking behaviour under the partition + `pendingTag` overlay +
 * collision-poison rule. Each shape asserts the boundary stays 0 (the
 * observable that matters); the checkpoint-level claim ("tag is an overlay,
 * not a member") is what the shapes exercise.
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (doc: string) => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;

describe('P5Tok partition + pendingTag overlay (B2 co-existence shapes)', () => {
  const SHAPES: Array<[string, string]> = [
    ['rawText + bogus opener', '<iframe>\n</ y\n\ntail\n\nend\n'],
    ['rawText + quoted pendingTag', '<iframe>\n</iframe a="\n\ntail\n\nend\n'],
    ['script + quoted pendingTag', '<script>\n</script a="\n\ntail\n\nend\n'],
    ['bogus + pendingTag', '<div a=\n</ y\n\ntail\n\nend\n'],
  ];
  for (const [name, doc] of SHAPES) {
    test(name, () => {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: 0 });
    });
  }

  /** P4b-completion commit 1's relation invariant: at `--!>` parse5 leaves
   *  the comment while micromark stays inside it. The divergence poisons on
   *  the RELATION; the parse5 field going back to data must never release
   *  the micromark block — the boundary stays 0 no matter how much clean
   *  prose follows. */
  test('the --!> split poisons the relation; neither field releases the other', () => {
    expect(boundary('<!--x--!>\n<details>\n-->\n\ntail para\n\nend\n')).toBe(0);
    expect(boundary('<!--\na--!>b\n\ntail para\n\nend\n')).toBe(0);
  });

  /** P4b-completion commit 6: a type-1 line inside an open type 2-5 block
   *  no longer opens a phantom type-1 (the member is html{3-5} and the
   *  gate reads it, not the deleted run flag). The construct's own
   *  divergence rules still decide the outcome — the `<script>` line's
   *  stray `>` inside a `<?`/`<![CDATA[` block poisons, and the whole
   *  class streams like a full parse. */
  test('no phantom type-1 inside an open 2-5 construct', () => {
    const piDoc = '<?a\n<script>\nx\n</script>\n?>\n\ntail\n\nend\n';
    expect(boundary(piDoc)).toBe(0);
    assertStreamEquivalence('c6-pi', scheduleSnapshots(piDoc, [4, 4, 4, 4, 4, 4, 4, 4]), CATALOG[0]);
    const cdataDoc = '<![CDATA[\n<pre>\n]]>\n\ntail\n\nend\n';
    expect(boundary(cdataDoc)).toBe(0);
    assertStreamEquivalence('c6-cdata', scheduleSnapshots(cdataDoc, [1, 1, 1, 1, 1, 1, 1, 1]), CATALOG[0]);
  });

  /** Migration B row 5's would-fail-if-flipped pin: a def-shaped line
   *  glued under a closed 2-5 block, or on a type-7-hole run line, is a
   *  paragraph CONTINUATION to micromark — its `[a]` ref must stay live
   *  (unregistered def ⇒ taint keeps the boundary at 0). A REAL def after
   *  a blank registers and the boundary passes the ref. If either 0 turns
   *  positive, someone loosened `defLineStart` or the def gate — the two
   *  halves of one safety argument. */
  test('glued def lines stay unregistered; real defs register', () => {
    expect(boundary('see [a] cited\n\n<!-- x -->\n[a]: /u\n\ntail\n\nend\n')).toBe(0);
    expect(boundary('see [a] cited\n\n<span title="a>b">\n[a]: /u\n\ntail\n\nend\n')).toBe(0);
    expect(boundary('see [a] cited\n\n[a]: /u\n\ntail\n\nend\n')).toBe(30);
  });

  test('F10 still fires for the script kind (M1)', () => {
    // <script> nested in a type-6 run, then a blank: the raw-text state
    // runs on while micromark's block ends — document-wide poison.
    expect(boundary('<div>\n<script>\n\nx\n\ny\n')).toBe(0);
  });
});
