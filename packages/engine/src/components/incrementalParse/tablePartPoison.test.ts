/**
 * A stray table-part tag (`<td>`, `<tr>`, `<col>` …) outside a table re-routes
 * how parse5 builds every LATER table — cell text is foster-parented to the
 * root — so the scanner poisons its candidates from such a tag onwards and
 * the splice refuses any prefix containing one. Neither check asked whether
 * the part was actually stray, so a perfectly well-formed
 * `<table><tr><td>a</td></tr></table>` disabled freezing for the whole rest of
 * the document: measured boundary 0 from the table onwards, against 43 for the
 * same prose without it, and zero incremental frames on every schedule
 * (2026-08-20 B1).
 *
 * `phasePoisonedAt` only ever moves down (`Math.min`) and every candidate past
 * it is rejected, so there was no way back either — one table killed the rest
 * of the stream.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (text: string) => computeFreezeBoundary(text, { defListEnabled: false }).boundary;

const TAIL = '\n\npara one\n\npara two\n\npara three\n\npara four\n\ntail';

/** Well-formed tables: the part is inside a table, nothing is re-routed. */
const WELL_FORMED: Array<[string, string]> = [
  ['closed table', `<table>\n<tr><td>a</td></tr>\n</table>${TAIL}`],
  [
    'closed table, thead + tbody',
    `<table>\n<thead><tr><th>h</th></tr></thead>\n<tbody><tr><td>a</td></tr></tbody>\n</table>${TAIL}`,
  ],
  ['whole table on one line', `<table><tr><td>a</td></tr></table>${TAIL}`],
  ['table inside details', `<details>\n<table><tr><td>a</td></tr></table>\n</details>${TAIL}`],
  ['two tables', `<table><tr><td>a</td></tr></table>\n\nmid\n\n<table><tr><td>b</td></tr></table>${TAIL}`],
];

/** Stray parts: the shape the poison exists for. */
const STRAY: Array<[string, string]> = [
  ['bare td', `intro\n\n<td>x${TAIL}`],
  ['tr after the table closed', `<table><tr><td>a</td></tr></table>\n\n<tr>stray${TAIL}`],
  ['th with no table at all', `<th>h${TAIL}`],
];

const SCHEDULES = [
  [1, 1, 1, 1, 1, 1, 1, 1],
  [4, 4, 4, 1, 4, 4, 4, 1],
  [7, 3, 5, 2, 6, 4, 8, 1],
  [3, 9, 2, 11, 5],
  [2, 2, 13, 2, 2],
];

describe('table-part poison fires only for STRAY parts', () => {
  test('a well-formed table leaves the boundary where prose would', () => {
    const control = boundary(`intro${TAIL}`);
    expect(control).toBeGreaterThan(0);
    for (const [name, doc] of WELL_FORMED) {
      // Not merely non-zero: the boundary has to reach into the trailing
      // prose, which a poison at the table would have made impossible.
      expect({ name, frozenPastTable: boundary(doc) > doc.length - TAIL.length }).toEqual({
        name,
        frozenPastTable: true,
      });
    }
  });

  test('a stray part still poisons from where it appears', () => {
    for (const [name, doc] of STRAY) {
      expect({ name, poisoned: boundary(doc) < 20 }).toEqual({ name, poisoned: true });
    }
  });

  test('well-formed tables actually run the incremental path', () => {
    // The boundary assertion above says the scanner allows it; this says the
    // splice takes it. Both were zero before the fix.
    for (const [name, doc] of WELL_FORMED) {
      let incremental = 0;
      for (const sizes of SCHEDULES) {
        incremental += assertStreamEquivalence(
          `b1-${name}`,
          scheduleSnapshots(doc, sizes),
          CATALOG[0]
        ).incrementalFrames;
      }
      expect({ name, ran: incremental > 0 }).toEqual({ name, ran: true });
    }
  });

  test.each([...WELL_FORMED, ...STRAY])('output stays equivalent — %s', (name, doc) => {
    for (const sizes of SCHEDULES) {
      for (const s of [sizes, [...sizes].reverse()]) {
        // STRAY shapes poison to boundary 0 by design; the engagement claim
        // lives in 'well-formed tables actually run the incremental path'.
        const stats = assertStreamEquivalence(`b1-${name}`, scheduleSnapshots(doc, s), CATALOG[0], {
          minIncrementalFrames: 0,
        });
        expect(stats.frames).toBeGreaterThan(0);
      }
    }
  });

  /** The suppression reads `definitelyInsideTable()`, a wrapper documented as
   *  UNDER-claiming — doubt must resolve to "not inside a table" so the
   *  poison fires. It was implemented on the raw `tagBalance` bag, which
   *  counts a PARAGRAPH-line truncated `<table` that parse5 discards: the
   *  four-axis wrapper audit found it the only direction-carrying predicate
   *  whose implementation contradicted its name (2026-08-26 review M5). */
  describe('a phantom `<table` open must not suppress the poison', () => {
    const TRUNCATED = 'compare a<table b\n<td>x</td>\n</table>\n\npara one\n\npara two\n\nend\n';

    test('a truncated `<table` in prose leaves the stray part poisoned', () => {
      expect(boundary(TRUNCATED)).toBe(0);
    });

    test('the same prose without the phantom is identical', () => {
      // The control the reproducer is measured against: dropping `<table`
      // from the paragraph must not change the verdict at all.
      expect(boundary('compare a b\n<td>x</td>\n</table>\n\npara one\n\npara two\n\nend\n')).toBe(0);
    });

    test('a CONFIRMED `<table` still suppresses it', () => {
      // The `>` arrives, the pending open is confirmed, and the part is
      // genuinely inside a table again — the B1 behaviour is untouched.
      const doc = 'compare a<table b>\n<td>x</td>\n</table>\n\npara one\n\npara two\n\nend\n';
      expect(boundary(doc)).toBeGreaterThan(0);
    });

    test('the truncated shape streams like a full parse', () => {
      assertStreamEquivalence('m5 truncated table', scheduleSnapshots(TRUNCATED, [1]), CATALOG[0], {
        minIncrementalFrames: 0,
      });
    }, 30_000);
  });
});
