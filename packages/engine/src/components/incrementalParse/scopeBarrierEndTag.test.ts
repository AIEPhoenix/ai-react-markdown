/**
 * An end tag parse5 DISCARDS, and the bag that decremented anyway.
 *
 * The HTML spec resolves most end tags by asking whether the element is "in
 * scope": the search walks DOWN the open-element stack and stops at a barrier
 * (`table`, `marquee`, `object`, `template`, `applet`, `caption`, `td`, `th`,
 * `html`, plus the MathML/SVG integration points). If no match is found before
 * a barrier, the end tag is a parse error and is IGNORED — the element stays
 * open.
 *
 *   <div><table></div></table>
 *
 * `</div>` is discarded because `table` is a barrier; `</table>` pops only the
 * table; the div is still open, and every later block nests inside it. The
 * scanner counted `div` 1−1 and `table` 1−1, reported `openTotal === 0`, and
 * froze at 41 of 66 bytes while the full parse produced
 * `div(table, "\n", p("filler"), "\n", p("tail"))`.
 *
 * This shipped. `tagBalance`'s clamp (`count > 0`) guards the case where a
 * close arrives before its open; it cannot guard the case where an open's
 * close is ignored, because a name→count bag has no idea what lies between
 * them. Order is exactly the information a bag throws away — the same root
 * cause as the foreign-content families in v2.5.4, one level deeper.
 *
 * Found 2026-08-24 by asking, for a large matrix of prefixes and tails,
 * whether `raw(prefix ++ tail) === raw(prefix) ++ raw(tail)`. `GRAMMAR-
 * COVERAGE.md`'s Table C had asserted the opposite of this in writing:
 * misnested elements were "reached only through unbalanced `<b>`/`<i>`, which
 * block on tag balance anyway".
 *
 * The fix keeps an ordered stack and resolves end tags through it, removing
 * ONLY the matched element: what parse5 does with the elements above the match
 * differs between block names (implied end tags, pop through) and formatting
 * names (the adoption agency re-parents instead), and modelling the first
 * under-counts the second — measured, it turned four existing fixtures into
 * fresh under-blocks. Leaving them counted over-blocks, which is allowed.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;
const doc = (shape: string) => `${shape}\n\nfiller para\n\ntail paragraph with text\n`;

/** Barriers that make the inner end tag unreachable. `td`/`th`/`caption` are
 *  barriers too but are already stopped by the stray-table-part poison. */
const BARRIERS = ['table', 'marquee', 'object', 'template', 'applet'];

/** No barrier between the end tag and its element: the close is real. */
const CONTROLS = [
  '<div><span></div></span>',
  '<div><p></div></p>',
  '<div><em></div></em>',
  '<div>x</div>',
  '<table><tr><td>c</td></tr></table>',
  '<div><table></table></div>',
];

const SCHEDULES = [
  [2, 2, 2, 2, 2, 2, 2, 2],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [7, 3, 5, 2, 6, 4, 8, 1],
];

describe('end tags discarded by a scope barrier', () => {
  test('a barrier keeps the outer element open, so nothing may freeze', () => {
    for (const barrier of BARRIERS) {
      const shape = `<div><${barrier}></div></${barrier}>`;
      expect({ barrier, boundary: boundary(doc(shape)) }).toEqual({ barrier, boundary: 0 });
    }
  });

  test.each(SCHEDULES)(
    'the family streams like a full parse — schedule %#',
    (...sizes) => {
      for (const barrier of BARRIERS) {
        const shape = `<div><${barrier}></div></${barrier}>`;
        // The test above pins boundary 0 for every barrier shape: zero
        // engagement is the asserted outcome here.
        assertStreamEquivalence(barrier, scheduleSnapshots(doc(shape), sizes), CATALOG[0], {
          minIncrementalFrames: 0,
        });
      }
    },
    60_000
  );

  test.each(CATALOG)(
    'the family streams like a full parse — $label',
    (config) => {
      for (const barrier of BARRIERS) {
        const shape = `<div><${barrier}></div></${barrier}>`;
        assertStreamEquivalence(barrier, scheduleSnapshots(doc(shape), [2, 2, 2, 2, 2, 2, 2, 2]), config, {
          minIncrementalFrames: 0,
        });
      }
    },
    60_000
  );

  /** Without a barrier the end tag really does close, and freezing must
   *  continue — otherwise the fix is just a blanket refusal. */
  test('controls still freeze past the construct', () => {
    for (const shape of CONTROLS) {
      expect({ shape, frozen: boundary(doc(shape)) > shape.length }).toEqual({ shape, frozen: true });
    }
  });

  test('controls stream like a full parse', () => {
    let incremental = 0;
    for (const shape of CONTROLS) {
      incremental += assertStreamEquivalence(
        shape,
        scheduleSnapshots(doc(shape), [2, 2, 2, 2, 2, 2, 2, 2]),
        CATALOG[0],
        {
          minIncrementalFrames: 0,
        }
      ).incrementalFrames;
    }
    // One control (`<div><p></div></p>`) freezes only at the very last frame
    // and never splices; the floor is the family aggregate (measured 67).
    expect(incremental).toBeGreaterThan(0);
  }, 60_000);

  /** The pair "boundary is 0" + "stream is equivalent" would also hold if the
   *  scanner had simply stopped freezing everything. Pin the discrimination:
   *  the SAME two tags freeze normally when the end tag is not discarded. */
  test('the refusal is specific to the discarded end tag', () => {
    expect(boundary(doc('<div><table></div></table>'))).toBe(0);
    expect(boundary(doc('<div><table></table></div>'))).toBeGreaterThan(0);
  });
});
