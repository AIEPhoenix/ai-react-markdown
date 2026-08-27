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

/**
 * F19 — the same discard, on an end tag that is not in the document.
 *
 * Everything above needs the discarded end tag to be WRITTEN: `</div>` is
 * there in the source, the scanner scans it, and the stack walk models what
 * parse5 does with it. The second consequence needs no such tag.
 * `hast-util-raw` serialises the whole mdast before re-parsing, so every
 * markdown construct contributes a real tag pair to parse5's input — `>` is
 * `<blockquote>…</blockquote>`, `#` is `<h1>…</h1>`, `*a*` is `<em>…</em>`.
 * A barrier still open when one of THOSE end tags fires discards it by the
 * same scope walk, and the host leaks:
 *
 *   ><table>
 *   </table>
 *
 * is 19 bytes in which nothing is unbalanced — `<table>` opens, `</table>`
 * closes, `openTotal` is 0 — and the tail paragraph lands INSIDE the
 * blockquote, because the generated `</blockquote>` was thrown away while the
 * table was open. 11 of 13 hazard futures move the frozen region.
 *
 * For a formatting host the leak is worse than re-nesting: the element stays
 * in the active-formatting-elements list and is RECONSTRUCTED around all
 * following content. That one is a live shipped divergence, not a model-level
 * one — `*<object>*\n</object>` + blank + prose puts the tail inside a
 * top-level `<em>` that the incremental path never produced, on every
 * incremental frame of all six configs, byte-identical back through v2.8.1
 * and the pre-campaign scanner (found 2026-08-27, pre-existing).
 *
 * The matrix that found it is not about which NAME is a barrier: `table`
 * leaks out of a blockquote or a heading but not out of a paragraph, because
 * a `<table>` start tag closes an open `p` and foster-parents its text back
 * out in front of itself, so the barrier is no longer between `em`/`p` and
 * its end tag by the time that end tag fires. Reading the matrix as a
 * name-vs-host rule would have encoded foster parenting into the scanner.
 * The rule is the concept's own: is anything GENERATED open around this
 * barrier — which is answerable, because the answer is no in exactly one
 * position, a column-0 html block.
 */
describe('generated end tags discarded by a scope barrier (F19)', () => {
  /** The 19-byte minimum, with no tail at all: this scanner applies no
   *  minimum-gain threshold, so the short shape measures the boundary and not
   *  a vacuum. Without the fix it freezes all 19. */
  test('the 19-byte minimum freezes nothing', () => {
    expect(boundary('><table>\n</table>\n\n')).toBe(0);
    // The same 15-byte shape with a non-barrier name still freezes.
    expect(boundary('><div>\n</div>\n\n')).toBeGreaterThan(0);
  });

  /** One per host that leaks — the axis the family matrix moves along. */
  const LEAKING_HOSTS: Array<[string, string]> = [
    ['blockquote marker', '><table>\n</table>'],
    ['blockquote lazy continuation', '> a quoted line\ncompare a<table b>\n</table>'],
    ['list item', '- a <table>\n</table>'],
    ['list item own line', '- a\n  <table>\n</table>'],
    ['atx heading + table', '# h <table>\n</table>'],
    ['atx heading + marquee', '# h <marquee>\n</marquee>'],
    ['setext heading + object', 'h <object>\n===\n</object>'],
    ['emphasis + object', '*a<object>b*\n</object>'],
    ['emphasis + marquee', '*a<marquee>b*\n</marquee>'],
    ['link text + applet', '[a<applet>b](/u)\n</applet>'],
  ];

  test('a barrier held by a markdown construct freezes nothing', () => {
    for (const [host, shape] of LEAKING_HOSTS) {
      expect({ host, boundary: boundary(doc(shape)) }).toEqual({ host, boundary: 0 });
    }
  });

  test.each(SCHEDULES)(
    'the family streams like a full parse — schedule %#',
    (...sizes) => {
      for (const [host, shape] of LEAKING_HOSTS) {
        assertStreamEquivalence(host, scheduleSnapshots(doc(shape), sizes), CATALOG[0], { minIncrementalFrames: 0 });
      }
    },
    60_000
  );

  /** The shipped half: this one diverged in `advanceIncrementalParse` itself,
   *  on every frame it engaged, under every config. */
  test.each(CATALOG)(
    'the formatting-host reproducer streams like a full parse — $label',
    (config) => {
      assertStreamEquivalence(
        'em + object',
        scheduleSnapshots('*<object>*\n</object>\n\ntail para here\n\nmore prose\n', [1]),
        config,
        { minIncrementalFrames: 0 }
      );
    },
    60_000
  );

  /** Without these the fix is a blanket refusal to freeze near a barrier. The
   *  first two are the measured controls of the 19-byte minimum: the same
   *  shape with a non-barrier name, and the same barrier with no host. */
  const CONTROLS_F19 = [
    '><div>\n</div>',
    '<table>\n</table>',
    '<marquee>\n</marquee>',
    '<object>\n</object>',
    '*a<span>b*\n</span>',
    '<div>\n<table>\n</table>\n</div>',
  ];

  test('controls still freeze past the construct', () => {
    for (const shape of CONTROLS_F19) {
      expect({ shape, frozen: boundary(doc(shape)) > shape.length }).toEqual({ shape, frozen: true });
    }
  });

  test('controls stream like a full parse', () => {
    for (const shape of CONTROLS_F19) {
      assertStreamEquivalence(shape, scheduleSnapshots(doc(shape), [2, 2, 2, 2, 2, 2, 2, 2]), CATALOG[0], {
        minIncrementalFrames: 0,
      });
    }
  }, 60_000);

  /** A barrier that opens and closes INSIDE its host never straddles the
   *  generated end tag, and a GENERATED barrier (a GFM pipe table) is well
   *  nested by construction — which is what bounds this defect to raw
   *  barriers. Both freeze; only the second is free of over-block. */
  test('a well-nested generated barrier is not the defect', () => {
    expect(boundary(doc('<div>\n\n| a | b |\n| - | - |\n\n</div>'))).toBeGreaterThan(0);
  });
});
