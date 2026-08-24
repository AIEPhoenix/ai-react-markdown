/**
 * parse5's tree construction CONSUMES the document-structure tokens —
 * `<!DOCTYPE …>`, `<html>`, `<head>`, `<body>`, `<frameset>` and their end
 * tags. In the "before html" / "in head" / "in body" insertion modes they
 * are absorbed into the document and emit NO node into the fragment: their
 * bytes vanish and the text nodes on either side MERGE into one whose span
 * STARTS BEFORE the construct.
 *
 * That is retroactive, and every other invariant in the line model assumes
 * a confirmed line only affects itself and what follows. Measured before
 * the fix (2026-08-20, 16800-shape sweep, 4098 failures):
 *
 *   '```\n```\n\n<!DOCTYPE>\ne'   frozen at 9, then the top-level text node
 *                                 at index 1 went "\n" → "\n\n" when the
 *                                 doctype arrived — hast mismatch against a
 *                                 full parse, i.e. an UNDER-BLOCK.
 *
 * Two findings worth keeping:
 *
 *  - An UNCLOSED `<body>` was already safe by accident: it left `openTotal`
 *    at 1, which blocked candidates for an unrelated reason. Only the
 *    BALANCED `<body>…</body>` form reaches zero and freezes across, so the
 *    usual "unbalanced is the dangerous one" intuition is inverted here.
 *  - `<!DOCTYPE` is the ONLY `<!` + letter declaration parse5 tokenizes as a
 *    real doctype. `<!ENTITY` and friends become comment nodes, are
 *    position-stable, and must keep freezing normally.
 *
 * The corpus reached none of this: it had no `<!` + letter shape at all
 * (every `<!` form was `<!--`, `<!-`, `<! x >` or `<![CDATA[`), which is why
 * a whole 784-test suite passed with the construct's state handling broken.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary, type FreezeScanCheckpointInternal } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

const HEAD = '```\n```\n\n';
const TAIL = '\n\npara one\n\npara two\n\npara three\n\ntail';

/** Consumed by parse5 → retroactive → the whole document must be poisoned. */
const RETROACTIVE: Array<[string, string]> = [
  ['bare doctype', `${HEAD}<!DOCTYPE>${TAIL}`],
  ['html5 doctype', `${HEAD}<!DOCTYPE html>${TAIL}`],
  ['lowercase doctype', `${HEAD}<!doctype html>${TAIL}`],
  ['mixed-case doctype', `${HEAD}<!DoCtYpE h>${TAIL}`],
  ['legacy doctype', `${HEAD}<!DOCTYPE html PUBLIC "x">${TAIL}`],
  ['doctype split across lines', `${HEAD}<!DOCTYPE\nhtml>${TAIL}`],
  ['doctype then html', `${HEAD}<!DOCTYPE html>\n<html>${TAIL}`],
  ['paired body', `${HEAD}<body>\nx\n</body>${TAIL}`],
  ['paired head', `${HEAD}<head>\nx\n</head>${TAIL}`],
  ['paired html', `${HEAD}<html>\nx\n</html>${TAIL}`],
  ['uppercase paired body', `${HEAD}<BODY>\nx\n</BODY>${TAIL}`],
  ['body with attributes', `${HEAD}<body class="a">\nx\n</body>${TAIL}`],
  ['self-closing body', `${HEAD}<body/>\nx${TAIL}`],
  ['frameset', `${HEAD}<frameset>\nx\n</frameset>${TAIL}`],
];

/** Position-stable — these must keep freezing exactly as before. */
const SAFE: Array<[string, string]> = [
  ['entity declaration', `${HEAD}<!ENTITY x>${TAIL}`],
  ['notation declaration', `${HEAD}<!NOTATION n>${TAIL}`],
  ['comment', `${HEAD}<!-- c -->${TAIL}`],
  ['bogus comment', `${HEAD}<! x>${TAIL}`],
  ['processing instruction', `${HEAD}<?x?>${TAIL}`],
  ['paired div', `${HEAD}<div>\nx\n</div>${TAIL}`],
  ['doctype inside a fence', `${HEAD}\`\`\`html\n<!DOCTYPE html>\n\`\`\`${TAIL}`],
  ['doctype in inline code', `${HEAD}The \`<!DOCTYPE html>\` decl.${TAIL}`],
  ['doctype in indented code', `${HEAD}    <!DOCTYPE html>${TAIL}`],
];

/** Position-stable too, but the scanner is conservative about them for
 *  reasons that predate this fix (the `<![CDATA[` opener is one of the
 *  documented APPROX cases), so they never freeze past the construct.
 *  Listed separately: they belong in the equivalence sweep, not in the
 *  "keeps freezing" assertion. */
const SAFE_BUT_CONSERVATIVE: Array<[string, string]> = [['cdata', `${HEAD}<![CDATA[d]]>${TAIL}`]];

const SCHEDULES = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [4, 4, 4, 1, 4, 4, 4, 1],
  [7, 3, 5, 2, 6, 4, 8, 1],
  [3, 9, 2, 11, 5],
  [2, 2, 13, 2, 2],
];

/** All three production lineages of the scanner. `collectDefLabels` states
 *  in its own doc comment that the soak battery does not cover its switch
 *  combination, and `remarkInjectPhantomDefs` runs a third, mixed profile
 *  (mathFlow ON, referenceTaint OFF) while reading the checkpoint (via
 *  `pendingFenceCloser`) rather than the boundary — so the poison is
 *  asserted on every one of them, not just the engine default. */
const LINEAGES: Array<[string, Parameters<typeof computeFreezeBoundary>[1]]> = [
  ['engine (advanceIncrementalParse)', { defListEnabled: true }],
  ['scanner (collectDefLabels)', { defListEnabled: false, mathFlow: false, referenceTaint: false }],
  ['phantom (remarkInjectPhantomDefs)', { defListEnabled: false, referenceTaint: false }],
];

describe('document-structure poison', () => {
  test('a retroactive construct poisons the whole document', () => {
    for (const [name, doc] of RETROACTIVE) {
      expect({ name, boundary: boundary(doc) }).toEqual({ name, boundary: 0 });
    }
  });

  test.each(LINEAGES)('the poison holds on every lineage — %s', (_label, options) => {
    for (const [name, doc] of RETROACTIVE) {
      const { boundary: b, checkpoint } = computeFreezeBoundary(doc, options);
      // The public checkpoint type is opaque; tests may look behind the brand.
      expect({ name, boundary: b, poisoned: (checkpoint as FreezeScanCheckpointInternal).phasePoisonedAt }).toEqual({
        name,
        boundary: 0,
        poisoned: 0,
      });
    }
    for (const [name, doc] of SAFE) {
      expect({
        name,
        poisoned: (computeFreezeBoundary(doc, options).checkpoint as FreezeScanCheckpointInternal).phasePoisonedAt,
      }).toEqual({
        name,
        poisoned: Infinity,
      });
    }
  });

  test('position-stable constructs still freeze into the trailing prose', () => {
    for (const [name, doc] of SAFE) {
      // Not merely non-zero: the boundary has to reach past the construct,
      // which a poison would have made impossible.
      expect({ name, frozenPastConstruct: boundary(doc) > doc.length - TAIL.length }).toEqual({
        name,
        frozenPastConstruct: true,
      });
    }
  });

  test('the safe cases actually run the incremental path', () => {
    for (const [name, doc] of SAFE) {
      let incremental = 0;
      for (const sizes of SCHEDULES) {
        incremental += assertStreamEquivalence(
          `ds-${name}`,
          scheduleSnapshots(doc, sizes),
          CATALOG[0]
        ).incrementalFrames;
      }
      expect({ name, ran: incremental > 0 }).toEqual({ name, ran: true });
    }
  });

  // Split rather than nested: the product of every plugin config, every
  // schedule and both directions is 48 stream runs PER SHAPE, which timed
  // out on CI at the 5 s default (2026-08-21). Schedules vary the splice
  // path and configs vary the plugin chain — nothing needs them crossed, so
  // one axis is swept per test and both carry an explicit budget.
  test.each([...RETROACTIVE, ...SAFE, ...SAFE_BUT_CONSERVATIVE])(
    'output stays equivalent across schedules — %s',
    (name, doc) => {
      for (const sizes of SCHEDULES) {
        for (const s of [sizes, [...sizes].reverse()]) {
          expect(assertStreamEquivalence(`ds-${name}`, scheduleSnapshots(doc, s), CATALOG[0]).frames).toBeGreaterThan(
            0
          );
        }
      }
    },
    30_000
  );

  test('every plugin configuration agrees', () => {
    for (const [name, doc] of [...RETROACTIVE, ...SAFE, ...SAFE_BUT_CONSERVATIVE]) {
      for (const config of CATALOG) {
        expect(
          assertStreamEquivalence(`ds-${name}`, scheduleSnapshots(doc, SCHEDULES[1]), config).frames
        ).toBeGreaterThan(0);
      }
    }
  }, 60_000);
});
