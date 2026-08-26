/**
 * `<pre>` is a CommonMark type-1 block and NOT a parse5 raw-text element —
 * the one member of `TYPE1_NAMES` that is absent from `RAW_TEXT_ELEMENTS`.
 *
 * The phantom-opener gate (P4a slice 2) skips the raw-construct openers
 * while an outer TEXT-CONSUMING construct owns the bytes, and its parse5
 * half was justified with "a comment / raw-text content runs to its own
 * terminator". That holds for `script` / `style` / `textarea`; inside
 * `<pre>` parse5 stays in the DATA state, so `<?x` / `<!y` / `<![CDATA[` /
 * `</3` really do open a BOGUS COMMENT — which then eats the `>` of the
 * `</pre>` closer line and leaves the element open, swallowing every later
 * block. Before the gate existed the phantom opener's own first-`>`
 * divergence poison covered this by accident; the gate removed the phantom
 * and the accidental cover with it (F13).
 *
 * The type-1 member carries parse5-rawness now, so the gate asks the
 * member — `pre` is html{1} to micromark and DATA to parse5, and the
 * openers on its lines are scanned like any other paragraph's.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (t: string) => computeFreezeBoundary(t, { defListEnabled: false }).boundary;
const TAIL = '\n\ntail\n\nend\n';

/** Every opener parse5's DATA state acts on, inside a `<pre>` block: the
 *  bogus comment swallows the closer line's `>` and the element survives. */
const PRE_BOGUS: Array<[string, string]> = [
  ['processing instruction', `<pre>\n<?x\n</pre>${TAIL}`],
  ['declaration', `<pre>\n<!y\n</pre>${TAIL}`],
  ['CDATA', `<pre>\n<![CDATA[\n</pre>${TAIL}`],
  ['bogus end tag', `<pre>\n</3\n</pre>${TAIL}`],
  ['mid-line opener', `<pre>\nx <?y\n</pre>${TAIL}`],
  ['opener on the opening line', `<pre> <?x\n</pre>${TAIL}`],
];

/** The three REAL raw-text type-1 names: parse5 reads the same bytes as
 *  element content, both grammars agree, and the boundaries stay exactly
 *  where they were (measured on HEAD before the member gained `raw`). */
const RAW_TEXT_CONTROLS: Array<[string, string, number]> = [
  ['style', `<style>\n<?x\n</style>${TAIL}`, 28],
  ['script', `<script>\n<?x\n</script>${TAIL}`, 30],
  ['textarea', `<textarea>\n<?x\n</textarea>${TAIL}`, 34],
];

describe('type 1 vs parse5 raw text (`<pre>`)', () => {
  test('a bogus-comment opener inside `<pre>` blocks the boundary', () => {
    for (const [name, doc] of PRE_BOGUS) {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: 0 });
    }
  });

  test('the real raw-text names are untouched', () => {
    for (const [name, doc, expected] of RAW_TEXT_CONTROLS) {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: expected });
    }
  });

  test('the streamed counterexample matches a full parse frame for frame', () => {
    // 20 of the frames diverged on HEAD: the frozen prefix carried
    // `<pre></pre>` with the tail paragraph as a SIBLING, while the full
    // parse keeps the paragraph INSIDE the still-open `<pre>`.
    const doc = '<pre>\n<?x\n</pre>\n\ntail\n\nend\nmore text\n';
    assertStreamEquivalence('pre bogus opener', scheduleSnapshots(doc, [1]), CATALOG[0]);
  }, 30_000);
});
