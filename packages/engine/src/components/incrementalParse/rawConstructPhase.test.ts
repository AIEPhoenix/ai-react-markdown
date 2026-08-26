/**
 * Two poisons completed on 2026-08-24, both instances of one sentence: a
 * construct that is INTERIOR to one grammar and STRUCTURE to the other cannot
 * be scanned line by line past the point where they disagree.
 *
 * ## 1. Paragraph-inline raw constructs that cross the line ending
 *
 * Blocker 7 already poisoned a paragraph-inline `<!--` that fails to close on
 * its own line. `<?`, `<!` + letter and `<![CDATA[` had the same shape and no
 * rule. Two stacked failure modes:
 *
 *  - micromark's block scan interrupts the paragraph at the next line, so the
 *    bytes the scanner reads as construct interior are a fresh html block to
 *    micromark. `x <!D y` + newline + `<!DOCTYPE>`: type 4 interrupts, parse5
 *    erases the doctype (document-structure family) — while the scanner read
 *    it as declaration interior, never ran the doctype poison, and "closed"
 *    the declaration at the doctype's own `>`. Thirty bytes.
 *  - parse5 reads the whole cross-line construct as one bogus comment (to the
 *    first `>`), a node sanitize REMOVES, and the removal merges the text on
 *    either side. The merge reaches BACKWARD: in the fuzz counterexample the
 *    merged separator sat at root index 1, inside a boundary forty bytes
 *    before the opener. Hence the DOCUMENT-WIDE poison — an opener-offset
 *    poison provably did not cover it.
 *
 * ## 2. Block-level raw-text elements open across a blank line
 *
 * A type-6 html block ends at a blank line; parse5's RAWTEXT/RCDATA state runs
 * on to the literal end tag. After the blank, every line lives in both
 * grammars at once: micromark opens fresh blocks whose ELEMENT nodes
 * hast-util-raw pushes straight into the tree, while the same bytes are raw
 * TEXT to parse5 — so their end tags close nothing. `<iframe>` + blank +
 * `*b*\n<div>…</div>\n</iframe>` left the div OPEN, swallowing the rest of the
 * document, while the scanner — suppressing every tag under `rawTextOpen` —
 * called it balanced. Sixty-three bytes, found by the direction battery: a
 * ONE-CHARACTER append rewrote the frozen region.
 *
 * Type-1 blocks are exempt: a blank does not end them, so the two grammars
 * agree the content is raw — which is why an unclosed `<script>` still
 * streams. The v2.5.3 `rawTextInline` poison covers the inline-opened form.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

/** Live under-blocks before the poisons, all minimised from soak output. */
const DIVERGING: Array<[string, string]> = [
  ['inline decl hides a doctype', 'x <!D y\n<!DOCTYPE>\n\ntail\n\n*b*\n'],
  ['inline PI, false close', 'x <?p y\n<!DOCTYPE ?>\n\ntail\n\n*b*\n'],
  ['inline decl hides a barrier', 'x <!D y\n<div><table></div></table>\n\ntail\n\n*b*\n'],
  [
    'fuzz seed 20270404 verbatim',
    'see [a](/u "t") linked\n\n[^a]: body text\r\n<i>y</i> <?php, see [a] maybe, or [a][a] even ![a]\n\n<!DOCTYPE html>\n\ntail para\n\n[^a]: body text\n',
  ],
  ['rawtext across a blank', '<iframe>\n\n*b*\n<div>\n<iframe>\n</div>\n</iframe>\n\ntail para\n\nmore\n'],
  // `<template>` — the second kind of erasure: children go to the content
  // fragment, sanitize drops the element, the whole block VANISHES. Inside a
  // container the later paragraphs land inside the li/blockquote and lazy
  // continuation rewrites the frozen region on a one-character append
  // (scaled-soak direction battery, 2026-08-24). An earlier sweep had
  // recorded template as harmless — it sampled only blank-line-separated
  // layouts, where the merge stays invisible.
  ['template in a list item', '- a\n<template>\n<div>x</div>\n</template>\n\ntail para\n\nmore\n'],
  ['template in a blockquote', '> a\r\n<template>\n<div>x</div>\n</template>\n\ntail para\n\nmore\n'],
  ['template at top level', '<template>\n<div>x</div>\n</template>\n\ntail para\n\nmore\n'],
  // The inline `<!--` poison, un-gated: `!inRawText` read `htmlFlowSinceBlank`,
  // which ANY `<letter` line start sets — `<b>x</b> <!-- y` is a PARAGRAPH
  // (`b` is not a type-6 name) yet the `<b` suppressed the poison entirely,
  // and the scaled soak froze 173 of 200 bytes across the erasure merge.
  ['inline comment after a tag', '<b>x</b> <!-- y\n\ntail para\n\nmore\n'],
  ['inline comment mid-prose', 'x <!-- y\n\ntail para\n\nmore\n'],
  ['title across a blank', '<title>\n\n*b*\n<div>\n</div>\n</title>\n\ntail para\n\nmore\n'],
];

/** Same ingredients, no divergence — the poisons must not fire here. */
const SAFE: Array<[string, string, boolean]> = [
  // [name, doc, mustKeepFreezing]
  ['decl closes on its line', 'x <!D y>\nplain\n\ntail\n\n*b*\n', true],
  ['PI closes on its line', 'x <?p y?>\nplain\n\ntail\n\n*b*\n', true],
  ['block decl (type 4)', '<!ENTITY x\n<!DOCTYPE html>\n\ntail\n\n*b*\n', true],
  ['rawtext closed inside its block', '<iframe>x</iframe>\n\ntail\n\n*b*\n', true],
  ['div in a list item (no erasure)', '- a\n<div>\nx\n</div>\n\ntail\n\n*b*\n', true],
  ['unclosed script (type 1, blank does not end it)', '<script>\nx\n\ny\n', false],
];

const SCHEDULES = [
  [4, 4, 4, 4, 4, 4, 4, 4],
  [2, 2, 2, 2, 2, 2, 2, 2],
  [7, 3, 5, 2, 6, 4, 8, 1],
];

describe('raw-construct phase splits', () => {
  test('every diverging shape is poisoned to zero', () => {
    for (const [name, doc] of DIVERGING) {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: 0 });
    }
  });

  test.each(SCHEDULES)(
    'diverging shapes stream like a full parse — schedule %#',
    (...sizes) => {
      for (const [name, doc] of DIVERGING) {
        // 'every diverging shape is poisoned to zero' above: no frame here
        // can splice, and that is the assertion.
        assertStreamEquivalence(name, scheduleSnapshots(doc, sizes), CATALOG[0], { minIncrementalFrames: 0 });
      }
    },
    60_000
  );

  test.each(CATALOG)(
    'diverging shapes hold on every config — $label',
    (config) => {
      for (const [name, doc] of DIVERGING) {
        assertStreamEquivalence(name, scheduleSnapshots(doc, [4, 4, 4, 4, 4, 4, 4, 4]), config, {
          minIncrementalFrames: 0,
        });
      }
    },
    60_000
  );

  test('the safe shapes stream like a full parse, and freezing survives them', () => {
    let incremental = 0;
    for (const [name, doc, mustFreeze] of SAFE) {
      incremental += assertStreamEquivalence(name, scheduleSnapshots(doc, [4, 4, 4, 4, 4, 4, 4, 4]), CATALOG[0], {
        minIncrementalFrames: 0,
      }).incrementalFrames;
      if (mustFreeze) {
        expect({ name, frozen: boundary(doc) > 0 }).toEqual({ name, frozen: true });
      }
    }
    // Per-shape engagement varies (some SAFE shapes only freeze late), so
    // the anti-vacuity floor is the family aggregate: measured 10 frames.
    expect(incremental).toBeGreaterThan(0);
  }, 60_000);
});
