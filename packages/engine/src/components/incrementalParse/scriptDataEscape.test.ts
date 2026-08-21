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

/** Double escaped: the grammars disagree, so freezing must stop. */
const POISONING = [
  '<script>\n<!--<script>\n</script>\n</script>',
  '<script>\n<!--<script>\n</script>',
  '<script><!--<script></script></script>',
  '<script>\n<!--<script>\n</script>\n<div>d</div>\n</script>',
  '<script>\n<!-- a comment\n<script>\n</script>\n</script>',
];

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
  test('double escape poisons the document', () => {
    for (const shape of POISONING) {
      expect({ shape, boundary: boundary(`${shape}${TAIL}`) }).toEqual({ shape, boundary: 0 });
    }
  });

  test('escaped without double escape still freezes past the block', () => {
    for (const shape of SAFE) {
      expect({ shape, past: boundary(`${shape}${TAIL}`) > shape.length }).toEqual({ shape, past: true });
    }
  });

  test('every shape streams like a full parse', () => {
    for (const shape of [...POISONING, ...SAFE]) {
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

  /** The state is per-element: a closed `<script>` must not leave the next
   *  one escaped. */
  test('the escape state resets with the element', () => {
    const doc = `<script><!--x--></script>\n\nmid para\n\n<script>\n<script>\n</script>${TAIL}`;
    expect(boundary(doc) > 0).toBe(true);
  });
});
