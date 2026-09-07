import { describe, expect, test } from 'vitest';
import { computeFreezeBoundary } from './computeFreezeBoundary';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { engineProbe } from './conformanceOracles';
import { CATALOG } from './testPluginCatalog';

const cases = [
  { kind: 'footnote', ref: '[^b]', definition: '[^b]:', tail: '[^b]: probe body\n' },
  { kind: 'link', ref: '[b]', definition: '[b]: /ghost', tail: '[b]: /real\n' },
];
for (const config of CATALOG) {
  describe(config.label, () => {
    for (const { kind, ref, definition, tail } of cases) {
      for (const eol of ['\n', '\r\n', '\r']) {
        test(`${kind} after ambiguous HTML/math with ${JSON.stringify(eol)}`, () => {
          const doc = `${ref}\n\n|\n--\n<y>\n$$\n\n$$\n${definition}\n\n$$\n`.replaceAll('\n', eol);
          const suffix = tail.replaceAll('\n', eol);
          const scan = computeFreezeBoundary(doc, { defListEnabled: config.defList });
          expect(scan.boundary).toBe(0);
          for (let cut = 1; cut < doc.length; cut++) {
            assertStreamEquivalence(`poisoned ${kind} cut=${cut}`, [doc.slice(0, cut), doc, doc + suffix], config, {
              minIncrementalFrames: 0,
            });
          }
        });
      }
    }
  });
}
test('the original oracle footnote collision matches a full parse', () => {
  const doc =
    '```\nconst x = "[a]<div>";\n```\rclaim[^b] made\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n| a | b |\n| - | - |\n<x-y/>\nrow follower\r\n$$\ne = mc^2\n\n$$\n\nsee [b] maybe, or [b][b] even ![b]\n\n<svg/>\r\r$$\ne = mc^2\n\n$$\n\n```\nconst x = "[a]<div>";\n```\r\n\r\n[^b]: body text\n\n    indented continuation\r\r[^\u6ce8\u4e00]: body text\n\n    indented continuation\n\n$$\ne = mc^2\n\n';
  const result = engineProbe(
    doc,
    '[^b]: probe body\n',
    CATALOG.find((c) => c.label === 'display-only')!
  );
  expect(result.disagreement).toBeNull();
});
test('definitions settled before uncertain syntax still release earlier references', () => {
  const doc = '[^b]\n\n[^b]: body\n\n|\n--\n<y>\n$$\n\n';
  expect(computeFreezeBoundary(doc, { defListEnabled: false }).boundary).toBeGreaterThan(0);
});

test('an unrelated stable prefix still splices while the unresolved reference stays in the tail', () => {
  const prefix = 'stable paragraph\n\n';
  const first = prefix + '[^b]\n\n';
  const doc = first + '|\n--\n<y>\n$$\n\n$$\n[^b]:\n\n$$\n';
  const scan = computeFreezeBoundary(doc, { defListEnabled: false });
  expect(scan.boundary).toBe(prefix.length);
  assertStreamEquivalence('stable prefix before poisoned definition', [first, doc, doc + '[^b]: body\n'], CATALOG[0]);
});
