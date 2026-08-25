/**
 * The type-7 INTERRUPT input, pinned against micromark itself.
 *
 * micromark refuses §4.6 condition 7 while its CONTENT construct is open —
 * paragraph, definition chain, or a container-held paragraph — and opens
 * it after everything else: headings, thematic breaks, table rows,
 * raw-construct terminator lines, fence closes, indented code, bare list
 * markers. `prevLineOpenContent` is the scanner's per-line derivation of
 * that state; this battery streams `<x-y/>` (a complete non-type-6 tag)
 * after one line of each class and demands the member agree with the live
 * remark-parse about whether an html block opened there.
 *
 * The one class the table deliberately does NOT decide is a pipe line
 * (GFM table row → type 7 opens after it; pipe-bearing paragraph → it
 * cannot; table-ness was settled lines earlier by a header/delimiter pair
 * a line model does not track). A refused tag line after a pipe line
 * poisons the phase instead — the sticky-over-block pin below.
 */
import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { computeFreezeBoundary, type FreezeScanCheckpointInternal } from './computeFreezeBoundary';

const PROBE = '<x-y/>';

/** micromark's truth: does an html block start at the probe line? */
function micromarkOpensType7(prefix: string): boolean {
  const doc = `${prefix}${PROBE}\nprobe-content\n\nafter\n`;
  const tree = unified().use(remarkParse).use(remarkGfm).parse(doc) as {
    children: Array<{ type: string; value?: string }>;
  };
  return tree.children.some((c) => c.type === 'html' && (c.value ?? '').startsWith(PROBE));
}

/** The scanner's claim: the member right after the probe line confirms. */
function scannerOpensType7(prefix: string): boolean {
  const { checkpoint } = computeFreezeBoundary(`${prefix}${PROBE}\n`, { defListEnabled: false });
  const cp = checkpoint as FreezeScanCheckpointInternal;
  return cp.mdBlock.kind === 'html' && cp.mdBlock.type === 7;
}

/** Line classes with a decided answer (everything except pipe lines). */
const PREFIXES: Array<[string, string]> = [
  ['document start', ''],
  ['after paragraph', 'plain paragraph\n'],
  ['after two-line paragraph', 'one\ntwo\n'],
  ['after blank', 'para\n\n'],
  ['after ATX heading', '# heading\n'],
  ['after thematic break', '---\n'],
  ['after spaced thematic break', '- - -\n'],
  ['after underscore break', '___\n'],
  ['after star break', '***\n'],
  ['after setext heading', 'para\n===\n'],
  ['after dash setext', 'para\n--\n'],
  ['after bare dash (empty item)', '-\n'],
  ['after bare star (empty item)', '*\n'],
  ['after bare ordered marker', '1.\n'],
  ['standalone === is a paragraph', '===\n'],
  ['standalone -- is a paragraph', '--\n'],
  ['after definition', '[a]: /u\n'],
  ['after invalid-def paragraph', '[a]: /u garbage extra\n'],
  ['after footnote definition', '[^a]: body\n'],
  ['after blockquote line', '> quoted\n'],
  ['after list item with content', '- item\n'],
  ['after indented code', '    code\n'],
  ['after lazy continuation', 'para\n    lazy\n'],
  ['after fence close', '```\nx\n```\n'],
  ['after comment terminator', '<!-- c -->\n'],
  ['after PI terminator', '<?php x ?>\n'],
  ['after type-1 close line', '<script>s</script>\n'],
  ['after type-6 run line', '<div>\ncontent\n'],
  ['after a previous type-7 run and blank', '# h\n<em>\n\n'],
];

describe('type-7 interrupt: prevLineOpenContent vs micromark', () => {
  test('the member agrees with micromark for every decided line class', () => {
    for (const [label, prefix] of PREFIXES) {
      expect({ label, opens: scannerOpensType7(prefix) }).toEqual({
        label,
        opens: micromarkOpensType7(prefix),
      });
    }
  });

  test('a refused tag line after a pipe-less table CONTINUATION row poisons too (soak 20283008)', () => {
    // A GFM table is continued by any non-blank non-structural line:
    // `see prose` after `| 1 | 2 |` is a ROW, so micromark's table runs
    // to the tag line and type 7 OPENS there — while the content model
    // reads `see prose` as an open paragraph and refuses. The sticky
    // tableMaybeOpen marker keeps the residual poison armed across the
    // pipe-less row; the exact soak counterexample streams clean.
    const doc =
      '| a | b |\n| - | - |\n| 1 | 2 |\rsee [a] maybe, or [a][a] even ![a]\r<noscript title="a>b">\n$$\ne=mc^2\n$$\n\n> a quoted line\n\nend\n';
    expect(computeFreezeBoundary(doc, { defListEnabled: false }).boundary).toBe(0);
  });

  test('a refused tag line after a pipe line poisons the phase (sticky over-block)', () => {
    // `| a | b |` may be a table row (type 7 would open) or a paragraph
    // line (it cannot) — undecidable here, so the tag line poisons: no
    // candidate at or past it survives, however much clean prose follows.
    const doc = `| a | b |\n| - | - |\n${PROBE}\ncontent\n\ntail one\n\ntail two\n\nend\n`;
    expect(computeFreezeBoundary(doc, { defListEnabled: false }).boundary).toBe(0);
  });

  test('a pipe paragraph without a tag line does not poison', () => {
    const doc = 'a | b\nplain\n\ntail one\n\ntail two\n\nend\n';
    expect(computeFreezeBoundary(doc, { defListEnabled: false }).boundary).toBeGreaterThan(0);
  });
});
