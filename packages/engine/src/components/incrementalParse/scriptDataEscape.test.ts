/**
 * Script-data escape states — a point where the two grammars cannot be
 * reconciled, only detected.
 *
 * parse5 moves the tokenizer through "script data escaped" on a `<!--` inside
 * an open `<script>`, and through "script data double escaped" when a nested
 * `<script` start tag arrives while escaped. In the double-escaped state a
 * `</script>` does NOT end the element — it only steps back to escaped, and
 * the element runs on, swallowing whatever follows.
 *
 * CommonMark has no such notion. A type-1 html block ends at the first line
 * holding the literal closer, full stop. So after
 *
 *   <script>
 *   <!--<script>
 *   </script>
 *
 * micromark says the block is over and the next `$$` opens flow math, while
 * parse5 says the `<script>` is still open and every following byte is script
 * text. The two disagree about which BYTES are raw, and modelling parse5 more
 * faithfully does not help: the scanner would still have to pick one grammar
 * and be wrong under the other.
 *
 * That is precisely blocker 7's case — "every point where CommonMark's
 * terminator and parse5's tokenizer DISAGREE about where a raw construct
 * ends" — so entering the double-escaped state poisons. Pure over-block, and
 * unreachable except by markup that nests `<script` inside a comment inside a
 * script.
 *
 * Found by the 2026-08-21 soak (leg 1, seven of twelve shards) once
 * `scriptEscapeArb` entered the corpus. A hand sweep of the same family had
 * passed the day it was written, having reasoned — wrongly — that a stream
 * only appends and therefore no attribution is ever revised.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const TAIL = '\n\npara one\n\npara two\n\npara three\n';
const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

/** Double escape (P3b batch 1, final shape after the 20282500-series
 *  soak): the ladder is tracked exactly — while double, `</script>`
 *  steps back to escaped and the element stays open AND COUNTED. A
 *  tangle that RESOLVES ON ITS OPENING LINE recovers (one md block, one
 *  parse5 element — no divergence survives the line). */
const RECOVERING = ['<script><!--<script></script></script>'];
/** A MULTI-LINE tangle cannot recover: micromark's type-1 block ends at
 *  the first literal closer line while parse5's element survives it, so
 *  the element swallows later md blocks AND their wrap separators as its
 *  own text — and sanitize stripping it merges the survivors BACKWARD
 *  past any earlier boundary (the F9/F11 erasure class). The
 *  direction-battery counterexamples (seeds 20282605/10/11) froze at 56
 *  and a one-character append changed the frozen region's children —
 *  document-wide poison at the surviving close, like every erasure. */
const ERASURE_POISONED = [
  '<script>\n<!--<script>\n</script>\n</script>',
  '<script>\n<!--<script>\n</script>\n<div>d</div>\n</script>',
  '<script>\n<!-- a comment\n<script>\n</script>\n</script>',
];
/** The element never truly closes — the balance holds the boundary at 0. */
const STILL_OPEN = ['<script>\n<!--<script>\n</script>'];

/** Escaped but never double escaped — both grammars still end the block at
 *  the literal closer, so these must keep freezing normally. */
const SAFE = [
  '<script><!--x--></script>',
  '<script>\n<!--\nx\n-->\n</script>',
  '<script>\n<!--- x\n</script>',
  // RAWTEXT elements have no escape states at all: `<!--` is just text.
  '<style><!--<style></style></style>',
  '<textarea><!--<textarea></textarea></textarea>',
  // A nested `<script` with NO preceding `<!--` never enters double escape.
  '<script>\n<script>\n</script>',
];

describe('script data escape states', () => {
  test('a single-line tangle recovers', () => {
    for (const shape of RECOVERING) {
      expect({ shape, past: boundary(`${shape}${TAIL}`) > 0 }).toEqual({ shape, past: true });
    }
  });

  test('a multi-line tangle is the erasure class: document-wide poison', () => {
    for (const shape of ERASURE_POISONED) {
      expect({ shape, boundary: boundary(`${shape}${TAIL}`) }).toEqual({ shape, boundary: 0 });
    }
  });

  test('while the element stays open the boundary holds at 0', () => {
    for (const shape of STILL_OPEN) {
      expect({ shape, boundary: boundary(`${shape}${TAIL}`) }).toEqual({ shape, boundary: 0 });
    }
  });

  test('escaped without double escape still freezes past the block', () => {
    for (const shape of SAFE) {
      expect({ shape, past: boundary(`${shape}${TAIL}`) > shape.length }).toEqual({ shape, past: true });
    }
  });

  test('every shape streams like a full parse', () => {
    for (const shape of [...RECOVERING, ...ERASURE_POISONED, ...STILL_OPEN, ...SAFE]) {
      assertStreamEquivalence(shape, scheduleSnapshots(`${shape}${TAIL}`, [4, 4, 4, 4, 4, 4, 4, 4]), CATALOG[0]);
    }
  }, 60_000);

  /** The soak counterexample, verbatim — the `$$` block after the script is
   *  what made the divergence observable. */
  test('the soak leg-1 counterexample', () => {
    const doc =
      '<script>\n<!--<script>\n</script>\n</script>\n\n$$\ne = mc^2\n\n$$\n\n[^a]: body text\n\nfoo line\n\nbar joins the paragraph\n';
    for (const sizes of [
      [4, 4, 4, 4, 4, 4, 4, 4],
      [1, 4, 4, 4, 4, 4, 4, 4],
    ]) {
      assertStreamEquivalence('soak leg 1', scheduleSnapshots(doc, sizes), CATALOG[0]);
    }
  }, 30_000);

  /** P3b batch 1': `-->` LEAVES the escaped state (exact per HTML
   *  §13.2.5.24). Being exact here opens no divergence window — a
   *  `<script` in PLAIN script data is text to parse5 and the element
   *  still ends at the first literal closer, where micromark agrees — so
   *  the sticky-escaped bias this replaced poisoned these shapes for
   *  nothing. */
  test('a closed comment lifts the escape: a later nested <script> is inert', () => {
    const doc = `<script>\n<!--x-->\n<script>\n</script>${TAIL}`;
    expect(boundary(doc)).toBeGreaterThan(0);
    assertStreamEquivalence('lifted escape', scheduleSnapshots(doc, [4, 4, 4, 4, 4, 4, 4, 4]), CATALOG[0]);
  });

  /** P3b batch 1, the full history (three landings' worth of evidence):
   *  the FIRST landing was reverted on the splice-side counterexample
   *  (the crossing element swallows the inter-block separator; frame 20
   *  carried an extra root "\n" — reproduced red, then fixed by
   *  `rawTextRegionCrossesOut`). The SECOND landing's release soak then
   *  found the scanner-side hole (seeds 20282605/10/11): even with the
   *  splice refusing, the BOUNDARY itself was unsafe — the stripped
   *  crossing element is an erasure whose merge reaches backward, so
   *  multi-line tangles now poison document-wide at the surviving close
   *  and only single-line tangles recover. The splice guard stays as
   *  defense in depth. */
  test('the escape state resets with the element', () => {
    const doc = `<script><!--x--></script>\n\nmid para\n\n<script>\n<script>\n</script>${TAIL}`;
    expect(boundary(doc) > 0).toBe(true);
  });
});
