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
 * TWO classes are deliberately NOT decided, and both poison instead:
 *
 *  - **pipe lines** (GFM table row → type 7 opens after it; pipe-bearing
 *    paragraph → it cannot; table-ness was settled lines earlier by a
 *    header/delimiter pair a line model does not track);
 *  - **container lines** (blockquote markers, list items, footnote
 *    definitions). micromark's `tagName` carries a `!self.parser.lazy`
 *    exception the decision table has no input for: a tag line that LAZILY
 *    continues an open container opens a container-held html block, and a
 *    container whose last line was not a paragraph closes instead, leaving
 *    the tag line to open a TOP-LEVEL multi-line block. Both readings say
 *    "opens" where the content model says "refused", and which one holds
 *    depends on container state this scanner does not track.
 *
 * The oracle walks the WHOLE tree, not `tree.children`: mdast reuses the
 * `html` node type for inline html, so flow-ness is "the parent is not a
 * paragraph". A root-only oracle is blind to exactly the container-held
 * blocks this battery has to see, and pinned the container rows to the
 * wrong answers until 2026-08-26. It also runs remark-math, because the
 * scanner's default profile has `mathFlow` on — an oracle built with a
 * different extension set disagrees for reasons that are not defects.
 */
import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { computeFreezeBoundary, type FreezeScanCheckpointInternal } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import { assertStreamEquivalence } from './spliceArbiterHarness';
import { scheduleSnapshots } from './fuzzGenerators';

const PROBE = '<x-y/>';
const OPTS = { defListEnabled: false };

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** micromark's truth: does a FLOW html block start at the probe line? */
function micromarkOpensType7(prefix: string): boolean {
  const doc = `${prefix}${PROBE}\nprobe-content\n\nafter\n`;
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(doc) as unknown as MdNode;
  let opened = false;
  const walk = (node: MdNode, parentType: string): void => {
    if (node.type === 'html' && parentType !== 'paragraph' && (node.value ?? '').startsWith(PROBE)) opened = true;
    for (const child of node.children ?? []) walk(child, node.type);
  };
  walk(tree, 'root');
  return opened;
}

/** The scanner's claim after the probe line: the member, and whether the
 *  line poisoned the phase instead of answering. */
function scannerAt(prefix: string): { opens: boolean; poisoned: boolean } {
  const { checkpoint } = computeFreezeBoundary(`${prefix}${PROBE}\n`, OPTS);
  const cp = checkpoint as FreezeScanCheckpointInternal;
  return {
    opens: cp.mdBlock.kind === 'html' && cp.mdBlock.type === 7,
    poisoned: cp.phasePoisonedAt <= prefix.length,
  };
}

/** Line classes with a decided answer. */
const DECIDED: Array<[string, string]> = [
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
  ['after titled definition', '[a]: /u "t"\n'],
  ['after invalid-def paragraph', '[a]: /u garbage extra\n'],
  ['a hash without a space is a paragraph', '#hash\n'],
  ['after indented code', '    code\n'],
  ['after lazy continuation', 'para\n    lazy\n'],
  ['after fence close', '```\nx\n```\n'],
  ['after math fence close', '$$\nx\n$$\n'],
  ['after comment terminator', '<!-- c -->\n'],
  ['after PI terminator', '<?php x ?>\n'],
  ['after type-1 close line', '<script>s</script>\n'],
  ['after type-6 run line', '<div>\ncontent\n'],
  ['after a previous type-7 run and blank', '# h\n<em>\n\n'],
];

/** Container lines: micromark opens (lazily inside the container, or at
 *  top level once the container closes), the content model refuses, and
 *  neither reading is derivable here — so the tag line poisons. */
const CONTAINER_UNDECIDABLE: Array<[string, string]> = [
  ['after blockquote line', '> quoted\n'],
  ['after blockquote heading line', '> # h\n'],
  ['after an empty blockquote marker', '>\n'],
  ['after blockquote lazy continuation', '> q\nlazy\n'],
  ['after list item with content', '- item\n'],
  ['after list item continuation', '- item\n  more\n'],
  ['after footnote definition', '[^a]: body\n'],
];

const TAIL = 'content\n\ntail one\n\ntail two\n\nend\n';
const LEAD = 'clean para\n\n';
/** `<br>` is the probe here rather than `<x-y/>`: parse5 ignores the
 *  self-closing flag on an unknown element, so `<x-y/>` leaves an element
 *  OPEN and the balance alone would hold every later candidate at the
 *  lead paragraph — the flip would not be measurable. `br` is void, and
 *  absent from the type-6 name list, so the line is type-7-shaped. */
const VOID_PROBE = '<br>';

describe('type-7 interrupt: prevLineOpenContent vs micromark', () => {
  test('the member agrees with micromark for every decided line class', () => {
    for (const [label, prefix] of DECIDED) {
      expect({ label, opens: scannerAt(prefix).opens }).toEqual({
        label,
        opens: micromarkOpensType7(prefix),
      });
    }
  });

  test('no decided class poisons', () => {
    for (const [label, prefix] of DECIDED) {
      expect({ label, poisoned: scannerAt(prefix).poisoned }).toEqual({ label, poisoned: false });
    }
  });

  test('micromark really opens a block after every container line', () => {
    // The claim the poison exists for, stated against the live parser: a
    // root-only oracle answers `false` for four of these seven.
    for (const [label, prefix] of CONTAINER_UNDECIDABLE) {
      expect({ label, opens: micromarkOpensType7(prefix) }).toEqual({ label, opens: true });
    }
  });

  test('a tag line while a container may be open poisons the phase', () => {
    for (const [label, prefix] of CONTAINER_UNDECIDABLE) {
      expect({ label, poisoned: scannerAt(prefix).poisoned }).toEqual({ label, poisoned: true });
    }
  });

  test('the container poison holds the boundary at the last clean candidate', () => {
    // Sub-class (i): the tag line lazily continues the open blockquote /
    // list item. Sub-class (ii): the container's last line is not a
    // paragraph, so it closes and the tag line opens a TOP-LEVEL block.
    for (const [label, prefix] of [
      ['(i) blockquote lazy continuation', '> quoted\n'],
      ['(ii) blockquote closed by a heading', '> # h\n'],
      ['(i) list item lazy continuation', '- item\n'],
    ] as const) {
      const doc = `${LEAD}${prefix}${VOID_PROBE}\n${TAIL}`;
      expect({ label, boundary: computeFreezeBoundary(doc, OPTS).boundary }).toEqual({ label, boundary: LEAD.length });
    }
  });

  test('the marker disarms where the container provably ended', () => {
    // A blank line closes the container, a paragraph line never opened
    // one, and a heading is not a container marker — all three keep
    // freezing right through the tag line.
    for (const [label, prefix] of [
      ['blank after the blockquote', '> quoted\n\n'],
      ['plain paragraph line', 'para line\n'],
      ['ATX heading line', '# h\n'],
    ] as const) {
      const doc = `${LEAD}${prefix}${VOID_PROBE}\n${TAIL}`;
      expect({ label, past: computeFreezeBoundary(doc, OPTS).boundary > LEAD.length + prefix.length }).toEqual({
        label,
        past: true,
      });
    }
  });

  test('the container counterexamples stream like a full parse', () => {
    // Every one of these froze a prefix a one-character append rewrote:
    // micromark makes the container line and the tag line ONE raw html
    // block, so the backticked raw-text opener on the third line is a
    // REAL opener the scanner had masked as a code span.
    for (const doc of [
      '> q\n<br>\n> `<iframe>`\n\nafter container\n\ntail one\n\ntail two\n\nend\n',
      '> q\n<br>\n> `<xmp>`\n\nafter container\n\ntail one\n\ntail two\n\nend\n',
      '> q\n</span>\n> `<title>`\n\nafter container\n\ntail one\n\ntail two\n\nend\n',
      'para\n> q\n<br>\n> `<iframe>`\n\nafter container\n\ntail one\n\ntail two\n\nend\n',
    ]) {
      // 14ba1ae poisons the container/tag-line pair to boundary 0, so zero
      // engagement is the asserted outcome. The pin that MOVES on a revert
      // is the direct boundary assertion below, not this stream pin.
      assertStreamEquivalence('container lazy type 7', scheduleSnapshots(doc, [1]), CATALOG[0], {
        minIncrementalFrames: 0,
      });
    }
  }, 60_000);

  test('a refused tag line after a pipe-less table CONTINUATION row poisons too (soak 20283008)', () => {
    // A GFM table is continued by any non-blank non-structural line:
    // `see prose` after `| 1 | 2 |` is a ROW, so micromark's table runs
    // to the tag line and type 7 OPENS there — while the content model
    // reads `see prose` as an open paragraph and refuses. The sticky
    // tableMaybeOpen marker keeps the residual poison armed across the
    // pipe-less row; the exact soak counterexample streams clean.
    const doc =
      '| a | b |\n| - | - |\n| 1 | 2 |\rsee [a] maybe, or [a][a] even ![a]\r<noscript title="a>b">\n$$\ne=mc^2\n$$\n\n> a quoted line\n\nend\n';
    expect(computeFreezeBoundary(doc, OPTS).boundary).toBe(0);
  });

  test('the sticky marker survives a pipe-less row — DIRECT flip pin (35f7593)', () => {
    // The discriminating shape the soak counterexample above is NOT: that
    // one poisons for several independent reasons (CR line endings, the
    // quoted `>` on the tag line, math), so reverting the stickiness leaves
    // its boundary at 0 and the pin never moves. Here the ONLY thing
    // holding the boundary down is `tableMaybeOpen` surviving the pipe-less
    // continuation row: `row continuation prose` is still a table ROW to
    // micromark, so type 7 opens at `<br/>` while the content model reads
    // an open paragraph and refuses. Under the pre-35f7593 per-line design
    // ("did THIS line hold a pipe") the marker cleared on the pipe-less row
    // and the boundary rose to 88 — freezing across the undecidable line.
    const doc =
      '| a | b |\n| - | - |\n| 1 | 2 |\nrow continuation prose\n<br/>\ncontent\n\ntail one\n\ntail two\n\nend\n';
    expect(computeFreezeBoundary(doc, OPTS).boundary).toBe(0);
  });

  test('a refused tag line after a pipe line poisons the phase (sticky over-block)', () => {
    // `| a | b |` may be a table row (type 7 would open) or a paragraph
    // line (it cannot) — undecidable here, so the tag line poisons: no
    // candidate at or past it survives, however much clean prose follows.
    const doc = `| a | b |\n| - | - |\n${PROBE}\ncontent\n\ntail one\n\ntail two\n\nend\n`;
    expect(computeFreezeBoundary(doc, OPTS).boundary).toBe(0);
  });

  test('a pipe paragraph without a tag line does not poison', () => {
    const doc = 'a | b\nplain\n\ntail one\n\ntail two\n\nend\n';
    expect(computeFreezeBoundary(doc, OPTS).boundary).toBeGreaterThan(0);
  });
});
