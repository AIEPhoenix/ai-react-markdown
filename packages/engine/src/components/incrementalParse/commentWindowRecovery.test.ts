/**
 * P3b batch 2 — the `--!>` divergence window, exact instead of poisoned.
 *
 * parse5 closes a comment at `--!>`; micromark's type-2 block runs on to
 * `-->`. The window between the two closers is comment CONTENT to
 * micromark and live input to parse5 — irreconcilable exactly when parse5
 * would act on it, i.e. when it holds `<` + letter / `!` / `/` / `?`
 * (P5_MARKUP_RE). A markup-free window is parse5 TEXT inside micromark's
 * block: the grammars converge at `-->`, the block's output is a text
 * remnant owned by the blocker-6 seam machinery (floatingResidue now runs
 * on the INTERSECTION of the two grammars' comment states — oracle rev2
 * amendment #5), and freezing resumes past the block.
 */
import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const boundary = (doc: string) => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;

describe('--!> window recovery (P3b batch 2)', () => {
  test('a markup-free window converges at --> and freezing resumes', () => {
    const t = 'x\n\n<!--x--!>\n-->\n\ny\n\nzzz\n';
    expect(boundary(t)).toBeGreaterThan(t.indexOf('-->'));
    const sameLine = '<!--a--!>plain text\n-->\n\ntail one\n\ntail two\n\nend\n';
    expect(boundary(sameLine)).toBeGreaterThan(0);
    // A lone `<` not followed by letter/!//? is character data to parse5.
    expect(boundary('<!--a--!>x < b\nmore - text\n-->\n\ntail\n\nend\n')).toBeGreaterThan(0);
  });

  test('markup in the window still poisons (flip pin)', () => {
    expect(boundary('<!--x--!>\n<details>\n-->\n\nx\n\ny\n')).toBe(0);
    expect(boundary('<!--x--!><i>b</i>\n-->\n\ntail\n\nend\n')).toBe(0);
    // …including markup arriving on a LATER window line.
    expect(boundary('<!--x--!>\nplain\n<em>w</em>\n-->\n\ntail\n\nend\n')).toBe(0);
  });

  test('a never-closing window stays blocked (md comment to EOF)', () => {
    expect(boundary('<!--\na--!>b\n\ntail para\n\nend\n')).toBe(0);
  });

  test('every window shape streams like a full parse', () => {
    const SHAPES = [
      'x\n\n<!--x--!>\n-->\n\ny\n\nzzz\n',
      '<!--a--!>plain text\n-->\n\ntail one\n\ntail two\n\nend\n',
      '<!--a--!>x < b\nmore - text\n-->\n\ntail\n\nend\n',
      '<!--x--!>\n<details>\n-->\n\nx\n\ny\n',
      '<!--\ncontent\n--!> trailing\n\nstill comment\n-->\n\ntail\n\nend\n',
      '<div>\n<!--c--!>after\nrun line\n\ntail\n\nend\n',
      '<!--!>w\n-->\n\ntail\n\nend\n',
      '<!---!>w\n-->\n\ntail\n\nend\n',
    ];
    for (const doc of SHAPES) {
      for (const sizes of [
        [4, 4, 4, 4, 4, 4, 4, 4],
        [1, 4, 4, 4, 4, 4, 4, 4],
        [64, 8, 8, 8],
      ]) {
        assertStreamEquivalence(JSON.stringify(doc.slice(0, 18)), scheduleSnapshots(doc, sizes), CATALOG[0]);
      }
    }
  }, 240_000);
});
