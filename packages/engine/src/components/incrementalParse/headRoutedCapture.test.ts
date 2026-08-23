/**
 * The tail-only parse captures a different insertion mode than the full one.
 *
 * `startTagInTemplate` handles most start tags by popping the template
 * insertion mode, pushing "in body" and REPROCESSING the token — which is why
 * a tail parsed on its own converges with the full parse after its first
 * element. Ten names skip that: `base`, `basefont`, `bgsound`, `link`, `meta`,
 * `noframes`, `script`, `style`, `template`, `title` are routed straight to
 * "in head". Four of them open a raw-text region, and `_switchToTextParsing`
 * stores `originalInsertionMode` at that instant:
 *
 *   full parse  — a preceding block already pushed "in body" → captures IN_BODY
 *   tail parse  — starts in "in template"                    → captures IN_TEMPLATE
 *
 * parse5 leaves TEXT mode on the FIRST stray end tag and restores the captured
 * mode. From there the two disagree: `</p>` synthesizes an empty paragraph in
 * "in body" and is ignored in "in template".
 *
 *   a
 *
 *   <title>
 *
 *   *b*
 *
 * Sixteen bytes, boundary 3, and the full parse carries an empty `<p>` the
 * spliced tree does not. Shipped. The same for `<noframes>`, and for
 * `<script>` once the double-escape keeps its region open past the apparent
 * closer — that last one is why the v2.5.4 script-escape poison did not cover
 * this: the poison fires at the escape LINE, while `c.offset > phasePoisonedAt`
 * deliberately keeps the candidate at the construct's own start, on the premise
 * that the ambiguous region re-parses inside the tail. Mode capture is exactly
 * what invalidates that premise.
 *
 * Found 2026-08-24 by a fresh-seed soak leg after the scope-barrier fix, from
 * a 190-byte fuzz counterexample that only failed on a reversed chunk
 * schedule; minimised to the sixteen bytes above.
 *
 * `textarea` / `iframe` / `noembed` / `xmp` take the default branch, pop
 * first, and capture the converged mode — measured safe and deliberately left
 * alone. `style` is in the routed set but unreachable unclosed today (a type-1
 * block runs to EOF, so the whole remainder is one raw node and both sides
 * swallow it identically); it is gated anyway, free when closed.
 */
import { describe, expect, test } from 'vitest';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

/** Two frames is enough — the divergence is at the first splice. */
const twoFrames = (doc: string) => [doc.slice(0, 3), doc];

/** Capture is live: the region opens before any mode-popping start tag and
 *  does not honestly close inside the tail's leading html run. */
const DIVERGING = [
  'a\n\n<title>\n\n*b*\n',
  'a\n\n<noframes>\n\n*b*\n',
  'a\n\n<script>\n<!--<script>\n</script>\n\n*b*\n',
  'a\n\n<title>\n\n[x](y)\n',
  'a\n\n<noframes>\n\n**b**\n',
];

/** Capture is converged, or the region closes inside the run. */
const CONVERGED = [
  // default-branch names: they pop the template mode before capturing
  'a\n\n<textarea>\n\n*b*\n',
  'a\n\n<iframe>\n\n*b*\n',
  'a\n\n<noembed>\n\n*b*\n',
  'a\n\n<xmp>\n\n*b*\n',
  // type-1 runs to EOF, so both sides swallow the same bytes
  'a\n\n<style>\n\n*b*\n',
  // honestly closed, in the same block or a later one in the same run
  'a\n\n<title>t</title>\n\n*b*\n',
  'a\n\n<script>x</script>\n\n*b*\n',
  'a\n\n<noframes>n</noframes>\n\n*b*\n',
  'a\n\n<title>\n\n</title>\n\n*b*\n',
  // a generic start tag first: both parses captured "in body"
  'a\n\n<div>d</div>\n\n<title>\n\n*b*\n',
  // no raw text at all
  'a\n\nplain\n\n*b*\n',
];

/** The fuzz counterexample this was minimised from, verbatim. */
const FUZZ_ORIGINAL =
  '> a quoted line\n\n<script>\n<!--<script>\n</script>\n\n[a]: https://example.com/a\n\n[a]: /u(x)y\r<script><!--<script></script></script>\n    <details>[a] scanned literal\n\n$$\ne = mc^2\n\n';

describe('head-routed raw text captures the wrong insertion mode', () => {
  test('the diverging shapes stream like a full parse', () => {
    for (const doc of DIVERGING) assertStreamEquivalence(doc, twoFrames(doc), CATALOG[0]);
  }, 60_000);

  test('the converged shapes stream like a full parse', () => {
    for (const doc of CONVERGED) assertStreamEquivalence(doc, twoFrames(doc), CATALOG[0]);
  }, 60_000);

  test.each(CATALOG)(
    'the diverging shapes hold on every config — $label',
    (config) => {
      for (const doc of DIVERGING) assertStreamEquivalence(doc, twoFrames(doc), config);
    },
    60_000
  );

  test('the 190-byte fuzz counterexample, on the schedule that found it', () => {
    const sizes = [4, 4, 4, 1, 4, 22, 4, 4];
    for (const s of [sizes, [...sizes].reverse()]) {
      assertStreamEquivalence('fuzz original', scheduleSnapshots(FUZZ_ORIGINAL, s), CATALOG[0]);
    }
  }, 60_000);

  /** The bail must be specific: a converged capture still splices, or the fix
   *  is just "stop freezing near raw text". */
  test('the converged shapes still take the incremental path', () => {
    const engaged = CONVERGED.map((doc) => assertStreamEquivalence(doc, twoFrames(doc), CATALOG[0]).incrementalFrames);
    expect(engaged.some((n) => n > 0)).toBe(true);
  }, 60_000);
});
