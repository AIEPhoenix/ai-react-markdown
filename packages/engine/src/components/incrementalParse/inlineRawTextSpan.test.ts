/**
 * `title`, `noframes` and `iframe` are RAWTEXT/RCDATA elements to parse5 AND
 * type-6 names to CommonMark, and parse5 lifts them out of the flow: the
 * element and its tags leave no node in the fragment and the text around
 * them merges. Opened INLINE — micromark html-TEXT inside a paragraph rather
 * than an html block — and spanning a line ending, that rewrites the
 * paragraph they sat in, which the scanner may already have frozen.
 *
 * Minimal shape (2026-08-21 soak leg 2, minimised from a 160-char prefix to
 * 19 chars): `p<title>` + newline + `</title>` + blank line. The single `<p>`
 * goes from children [`p`, "\n"] at 0-8 to [`p`, "\n\n"] at 0-19 the moment
 * anything is appended — the same erase-and-merge as the document-structure
 * names in documentStructurePoison.test.ts, only inside a paragraph.
 *
 * The wider shape is worse. micromark and parse5 disagree about where such a
 * span ENDS: `</title a>` is literal paragraph text to micromark (a closing
 * tag takes no attributes) but parse5's RCDATA tokenizer accepts it. The
 * scanner kept `rawTextOpen` set across it and so suppressed a `<div>` that
 * the real parse leaves OPEN — the frozen `<div>` then grew from @86-159 to
 * @86-161 on a one-character append. Because the divergence outlives the
 * span, this poisons from the line rather than rejecting one candidate.
 *
 * Scope was measured, not assumed: 40 tag names × 7 shapes, then 12 names ×
 * 10 shapes. Unsafe for exactly these three names, and only when opened
 * inline AND crossing a line ending — the same-line form, the block-level
 * form and every candidate further along are all stable, and `script` /
 * `style` / `textarea` / `xmp` are covered by the type-1 block path instead.
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
const FUTURES = ['x', ' tail', '\nglued\n', '\n\npara\n', '</div>\n'];
const LIFTED = ['title', 'noframes', 'iframe'];

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
/** '' when the frozen region survives every future. */
const instability = (doc: string): string[] => {
  const b = computeFreezeBoundary(doc, OPTS).boundary;
  if (b === 0) return [];
  const before = frozenOf(doc, b);
  return FUTURES.filter((f) => !isEqual(before, frozenOf(doc + f, b)));
};

const UNSAFE: Array<[string, string]> = [
  ['minimal 19-char shape', 'p<title>\n</title>\n\n'],
  ...LIFTED.flatMap((n): Array<[string, string]> => [
    [`${n} inline across a line`, `p<${n}>\n</${n}>\n\n`],
    [`${n} inline with content`, `p<${n}>\ninner\n</${n}>\n\n`],
    [`${n} after a settled paragraph`, `intro\n\np<${n}>\n</${n}>\n\n`],
    [`${n} attribute close then a div`, `p<${n}> x </${n} a> y\n\n<div>\n<${n}>\n</div>\n</${n}>\n\ntail\n\n`],
  ]),
  [
    'the soak prefix itself',
    '[a]: https://example.com/a\n\np <title> x </title a> y\n\ntail para\n\nprose with [a] used\n\n<div>\n<title>\n</div>\n</title>\n\ninline `<div>` stays code\n\n> a quoted line\n',
  ],
];

/** Must keep freezing — same name, but a shape parse5 does not lift out of
 *  a frozen paragraph. */
const SAFE: Array<[string, string]> = LIFTED.flatMap((n): Array<[string, string]> => [
  [`${n} opened and closed on one line`, `p<${n}> x </${n}> y\n\ntail para\n\nmore prose\n`],
  [`${n} as a block-level run`, `<${n}>\n</${n}>\n\ntail para\n\nmore prose\n`],
  [`${n} only mentioned in code`, `Use \`<${n}>\` here.\n\ntail para\n\nmore prose\n`],
]);

const SCHEDULES = [[1], [4, 4, 4, 4], [7, 3, 5, 2], [2, 2, 13, 2, 2]];

describe('inline raw-text spans', () => {
  test('nothing frozen is rewritten by a lifted element', () => {
    for (const [name, doc] of UNSAFE) {
      expect({ name, unstable: instability(doc) }).toEqual({ name, unstable: [] });
    }
  });

  test('the shapes parse5 does not lift keep freezing', () => {
    for (const [name, doc] of SAFE) {
      expect({ name, frozen: computeFreezeBoundary(doc, OPTS).boundary > 0 }).toEqual({ name, frozen: true });
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
          expect(assertStreamEquivalence(`irt-${name}`, scheduleSnapshots(doc, s), CATALOG[0]).frames).toBeGreaterThan(
            0
          );
        }
      }
    },
    30_000
  );

  test('every plugin configuration agrees', () => {
    for (const [name, doc] of [...UNSAFE, ...SAFE]) {
      for (const cfg of CATALOG) {
        expect(
          assertStreamEquivalence(`irt-${name}`, scheduleSnapshots(doc, SCHEDULES[1]), cfg).frames
        ).toBeGreaterThan(0);
      }
    }
  }, 60_000);
});
