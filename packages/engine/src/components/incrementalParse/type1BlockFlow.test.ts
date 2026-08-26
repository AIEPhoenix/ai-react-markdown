/**
 * A CommonMark type-1 html block (`<script`, `<pre`, `<style`, `<textarea`)
 * has block boundaries unlike every other html block, and the line scanner
 * modelled neither of them (2026-08-20, soak leg 2 — the direction battery
 * caught it once the corpus reached the shape; present since long before
 * v2.5.2, and reachable from the OLD corpus too, which had every ingredient
 * — `<script>` blocks, `p <div> x </div a="b"> y`, lone-`\r` separators —
 * and simply never sampled the combination).
 *
 *  1. Type 1 ENDS AT ITS CLOSER LINE, not at a blank. `htmlFlowReal` was
 *     "sticky to the blank", so the line after `</script>` was still read as
 *     a real html-flow run — and in a real run parse5 accepts end tags with
 *     attributes, so `</div a="b">` was counted as a REAL close. micromark
 *     sees a fresh PARAGRAPH there, where `</div a="b">` is literal text and
 *     the `<div>` before it stays OPEN. Freezing past it nested the entire
 *     rest of the document inside that div, so any append changed a frozen
 *     top-level child.
 *
 *  2. A BLANK LINE DOES NOT END TYPE 1 — only the literal closer or EOF.
 *     The scanner reset the run at every blank, so the content of an
 *     UNTERMINATED block was read as markup: `<script></script >` never
 *     closes (CommonMark wants the literal `</script>`; the space makes it
 *     text), and the ``` lines after the blank became a real fence to the
 *     scanner while micromark kept them as raw block content.
 *
 *  3. Inside such an unterminated block the balance scan is BLIND — its
 *     tags are suppressed by `rawTextOpen` — so `openTotal` reads 0 and a
 *     candidate looked perfectly balanced. `htmlBalanced` has to know.
 *
 * The type-6 case (`<div>` … `</div>` then a paragraph line with no blank)
 * is the control: type 6 really does run to the blank, so the same
 * `</div a="b">` really is a close there, and the scanner must keep
 * freezing.
 */
import { describe, expect, test } from 'vitest';
import isEqual from 'lodash-es/isEqual';
import { attributeHastChildren } from './attributeHastChildren';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG, buildAdvanceOptions } from './testPluginCatalog';
import { assertStreamEquivalence, runFull } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const config = CATALOG[0];
const OPTS = { defListEnabled: buildAdvanceOptions(config).defListEnabled };
const boundary = (t: string) => computeFreezeBoundary(t, OPTS).boundary;
const TAIL = '\n\ntail para\n\nmore prose\n';
const FUTURES = ['x', ' tail', '\nglued\n', '\n\npara\n', '</div>\n', '```\n', '</script>\n'];

/** The frozen top-level children, exactly as the direction battery counts them. */
function frozenOf(doc: string, b: number) {
  const { mdast, hast } = runFull(doc, config) as never as {
    mdast: Parameters<typeof attributeHastChildren>[0];
    hast: Parameters<typeof attributeHastChildren>[1];
  };
  const attrs = attributeHastChildren(mdast, hast, b);
  const kids: Array<{ position?: unknown }> = [];
  for (let i = 0; i < hast.children.length && attrs[i] < b; i++) kids.push(hast.children[i] as never);
  while (kids.length > 0 && kids[kids.length - 1].position === undefined) kids.pop();
  return kids;
}

/** Every one of these froze past an element the real parse leaves OPEN. */
const UNSAFE: Array<[string, string]> = [
  ['script closer then paragraph', `<script>\nx\n</script>\np <div> x </div a="b"> y${TAIL}`],
  ['same, lone CR ending', `<script>\nx\n</script>\rp <div> x </div a="b"> y${TAIL}`],
  ['pre closer then paragraph', `<pre>\nx\n</pre>\np <div> x </div a="b"> y${TAIL}`],
  ['style closer then paragraph', `<style>\nx\n</style>\np <div> x </div a="b"> y${TAIL}`],
  ['textarea closer then paragraph', `<textarea>\nx\n</textarea>\np <div> x </div a="b"> y${TAIL}`],
  ['one-line script then paragraph', `<script>x</script>\np <div> x </div a="b"> y${TAIL}`],
  ['unterminated: space in closer', `<script></script >\n\n\`\`\`\n\`\`\`${TAIL}`],
  ['unterminated: slash in closer', `<script>\nx\n</script/>\n\n<div>\nd\n</div>${TAIL}`],
  ['unterminated: named closer', `<script>\nx\n</scripty>\n\n<!-- c -->${TAIL}`],
  ['unterminated pre + fence', `<pre>\nx\n</pre >\n\n\`\`\`\ncode\n\`\`\`${TAIL}`],
  // The type-1 opener is NOT the line that started the run. `htmlFlowSinceBlank`
  // is set by ANY `<tag` line start, so an `<embed` / `<b>` line — a PARAGRAPH
  // to micromark, being neither a type-6 name nor a complete type-7 line —
  // opened the run and hid the real type-1 block behind it. Type 1 may
  // interrupt a paragraph, so that block is real; gating on `htmlFlowReal`
  // instead of on "the run starts here" is what makes these pass (2026-08-21
  // scaled soak, 400k over 12 fresh seeds, shards 0 and 11 — and the second
  // one had been failing on the HEAD scanner too, i.e. the first type-1 fix
  // simply had not reached it).
  [
    'type-1 behind a non-type-6 tag start',
    '> a quoted line\n\n<embed\n  src="x"\n/>\r<script>\nx\n</scripty>\n\n<!-- c -->\n\n```\ncode\n```\n\ninline prose\n',
  ],
  [
    'type-1 behind an inline tag and an open comment',
    '<b>x</b> <!-- trailing opener\r<script>\nx\n</scripty>\n\n<!-- c -->\n\n- tight one\n- tight two\n\n> a quoted line\n\nfoo line\n\nbar joins\n',
  ],
  ['the 30-char minimum of that shape', '<x<!--\r<script\n<!---->\n\nh\n\nine'],
];

/** Must keep freezing — type 6 genuinely reaches the blank. */
const SAFE: Array<[string, string]> = [
  ['type-6 div block then paragraph', `<div>\nx\n</div>\np <div> x </div a="b"> y${TAIL}`],
  ['script closed, blank, prose', `<script>\nx\n</script>\n\nafter prose${TAIL}`],
  ['pre closed, blank, prose', `<pre>\nx\n</pre>\n\nafter prose${TAIL}`],
  ['script nested in a div block', `<div>\n<script>\na\n</script>\n</div>\n\nafter${TAIL}`],
  ['two closed scripts', `<script>a</script>\n\n<script>b</script>\n\nafter${TAIL}`],
  ['script in a fence', `\`\`\`html\n<script>a</script>\n\`\`\`\n\nafter${TAIL}`],
];

const SCHEDULES = [[1], [4, 4, 4, 4], [7, 3, 5, 2], [2, 2, 13, 2, 2]];

describe('type-1 html block boundaries', () => {
  test('nothing freezes past an element the real parse leaves open', () => {
    for (const [name, doc] of UNSAFE) {
      const b = boundary(doc);
      if (b === 0) continue; // rejected outright — safe by construction
      const before = frozenOf(doc, b);
      const unstable = FUTURES.filter((f) => !isEqual(before, frozenOf(doc + f, b)));
      expect({ name, unstable }).toEqual({ name, unstable: [] });
    }
  });

  test('a type-6 run still reaches its blank and keeps freezing', () => {
    for (const [name, doc] of SAFE) {
      expect({ name, frozen: boundary(doc) > 0 }).toEqual({ name, frozen: true });
    }
  });

  test('the safe cases still run the incremental path', () => {
    // `type-6 div block then paragraph` is excluded: its splice engagement
    // is 0 at HEAD too (the frozen prefix ends inside an html block and the
    // structural bail takes it), so demanding engagement there would assert
    // a behaviour this fix neither has nor changed. Its boundary and its
    // output equivalence are still covered by the other two tests.
    for (const [name, doc] of SAFE.filter(([n]) => n !== 'type-6 div block then paragraph')) {
      let incremental = 0;
      for (const sizes of SCHEDULES) {
        incremental += assertStreamEquivalence(`t1-${name}`, scheduleSnapshots(doc, sizes), config).incrementalFrames;
      }
      expect({ name, ran: incremental > 0 }).toEqual({ name, ran: true });
    }
  });

  // Split rather than nested: the product of every plugin config, every
  // schedule and both directions is 48 stream runs PER SHAPE, which timed
  // out on CI at the 5 s default (2026-08-21). Schedules vary the splice
  // path and configs vary the plugin chain — nothing needs them crossed, so
  // one axis is swept per test and both carry an explicit budget.
  test.each([...UNSAFE, ...SAFE])(
    'output stays equivalent across schedules — %s',
    (name, doc) => {
      for (const sizes of SCHEDULES) {
        for (const s of [sizes, [...sizes].reverse()]) {
          // UNSAFE shapes poison to boundary 0 by design; the engagement
          // claim for this file lives in 'the safe cases still run the
          // incremental path' above.
          expect(
            assertStreamEquivalence(`t1-${name}`, scheduleSnapshots(doc, s), CATALOG[0], { minIncrementalFrames: 0 })
              .frames
          ).toBeGreaterThan(0);
        }
      }
    },
    30_000
  );

  test('every plugin configuration agrees', () => {
    for (const [name, doc] of [...UNSAFE, ...SAFE]) {
      for (const cfg of CATALOG) {
        expect(
          assertStreamEquivalence(`t1-${name}`, scheduleSnapshots(doc, SCHEDULES[1]), cfg, { minIncrementalFrames: 0 })
            .frames
        ).toBeGreaterThan(0);
      }
    }
  }, 60_000);
});
