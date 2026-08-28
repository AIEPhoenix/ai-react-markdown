/**
 * The construct-axis differential probe (v2.9 item #1): ask both grammars the
 * same two questions over a closed operator set, and make every disagreement
 * they produce owe something.
 *
 * The design constraint this suite exists to enforce is the last assertion in
 * `obligation`: a cell whose verdict pair DISAGREES, and over whose bytes a
 * scanner member's contract claims the grammars AGREE, must name that member
 * and must show the boundary retreating. A cell that disagrees with nothing
 * claiming agreement owes nothing — the scanner is scanning those bytes
 * honestly, which is the `pre` row's whole story (F13).
 *
 * Without that assertion this file would be a prettier `p5TokPartition.test.ts`
 * line 76, where the F20 fact sat as a correct sentence in the file that tests
 * the state, and shipped anyway. A sentence records a fact; only a failing
 * test performs the inference the fact licenses.
 *
 * @see constructAxisAdapters — the four adapters and the pinned alphabet
 * @see GRAMMAR-COVERAGE.md — Tables A-D, the question source
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary, SCANNER_NAME_LISTS } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import {
  CLOSER_OPERATORS,
  CONSTRUCT_AXIS_ALPHABET,
  CONSTRUCT_AXIS_CLAIMED_SHAPES,
  CONSTRUCT_AXIS_DISAGREEING_SHAPES,
  CONSTRUCT_AXIS_ELEMENTS,
  cellDisagreementOffset,
  cellDocument,
  cellVerdict,
  elementSwallows,
  findElement,
  mdBlockExtent,
  measureP5ContentState,
  measureIsVoid,
  micromarkKeepsBlockOpenPastBlank,
  micromarkOpensType6,
  nodeCovers,
  runToRawLayer,
  type ConstructAxisCell,
  type NodeLike,
  type P5ContentState,
} from './constructAxisAdapters';
import { runFull } from './spliceArbiterHarness';

const CFG = CATALOG[0];

/**
 * The HTML void-element set, transcribed from the HTML spec — including the
 * obsolete members (`basefont`, `bgsound`, `command`, `frame`, `image`,
 * `keygen`) that a modern parser may or may not still treat as void. That is
 * the interesting part: the scanner's own list is shorter, and this pool
 * exists to find out whether the difference matters. `html-void-elements`
 * carries the same set but is not a direct dependency of this package, so it
 * is written out rather than added to package.json for a test.
 */
const HTML_VOID_ELEMENTS = [
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'command',
  'embed',
  'frame',
  'hr',
  'image',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

/**
 * Ordinary HTML elements that are NOT CommonMark block names, written out
 * here so the name-list checks have a candidate pool whose provenance is
 * independent of the lists they falsify. Seeding candidates from the list
 * under test is what makes a derived alphabet self-certifying; this is the
 * counterweight, and it is why these names are transcribed by hand from the
 * HTML element set rather than imported from the scanner.
 */
const NON_BLOCK_HTML_ELEMENTS = [
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'big',
  'blink',
  'canvas',
  'cite',
  'code',
  'data',
  'datalist',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'label',
  'map',
  'mark',
  'marquee',
  'meter',
  'noscript',
  'object',
  'output',
  'picture',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'select',
  'slot',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'template',
  'time',
  'tt',
  'u',
  'var',
  'video',
  'audio',
  'applet',
  'svg',
  'math',
  'button',
  'form-x',
  'custom-element',
];
const boundaryOf = (doc: string): number => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;

/** Measure one cell from the two grammars. Nothing in here reads the
 *  scanner except `boundary`, which is its only published output. */
function measureCell(element: string, operator: string, closer: string): ConstructAxisCell {
  const doc = cellDocument(element, closer);
  const at = cellDisagreementOffset(element);
  const closerLineEnd = at + closer.length + 1;
  const govOffset = doc.indexOf('*<b>g</b>*') + 1;

  const { mdast } = runFull(doc, CFG) as { mdast: NodeLike };
  const raw = runToRawLayer(doc, CFG);

  // T1 — terminators. micromark's is the block extent from offset 0; parse5's
  // is how far the element reached, read through the marker rather than
  // through offsets rehype-raw does not reliably keep.
  const extent = mdBlockExtent(mdast, 0);
  const t1md = extent === null ? 'none' : extent[1] <= closerLineEnd ? 'at-closer' : 'after';
  const t1p5 = elementSwallows(raw, element, 'g');

  // T2 — content governance of the bytes after the closer. One byte range,
  // two questions: did micromark parse a markdown construct there, and did
  // parse5 build an element from the tag sitting in the same bytes.
  const t2md = nodeCovers(mdast, 'emphasis', govOffset) ? 'md-live' : 'md-inert';
  const t2p5 = findElement(raw, 'b') === null ? 'tag-inert' : 'tag-live';

  // The inference. `maskUnbacked` in computeFreezeBoundary.ts is
  // `mdType1RawText(cp.mdBlock) && !inRawTextTok(cp.p5Tok)`; each conjunct is
  // restated here as something the grammars answer, so the premise is derived
  // rather than copied from the code it is meant to check.
  const mdBlockStillOpen = micromarkKeepsBlockOpenPastBlank(`<${element}>`, closer, CFG);
  const p5GovernsAsRawText = measureP5ContentState(element, CFG) !== 'DATA';
  const p5AlreadyLeftThatState = t1p5 !== 'runs-on';
  const claimed = mdBlockStillOpen && p5GovernsAsRawText && p5AlreadyLeftThatState;

  // Meanings, not spellings — the two T1 enums are disjoint by wording, so
  // `!==` scored `('after','runs-on')` as a disagreement when both sides are
  // saying "runs past the closer". See `cellVerdict`.
  const verdict = cellVerdict([t1md, t1p5], [t2md, t2p5]);
  return {
    element,
    operator: operator as ConstructAxisCell['operator'],
    shape: closer,
    at,
    t1: [t1md, t1p5],
    t2: [t2md, t2p5],
    verdict,
    claimed,
    coveredBy: claimed ? 'maskUnbacked' : null,
    boundary: boundaryOf(doc),
  };
}

const MEASURED: ConstructAxisCell[] = CONSTRUCT_AXIS_ELEMENTS.flatMap((element) =>
  CLOSER_OPERATORS.map(([operator, make]) => measureCell(element, operator, make(element)))
);

describe('construct axis: T1 terminators and T2 content governance', () => {
  test('the pinned alphabet is what the two grammars actually answer', () => {
    // Whole-table equality, not a spot check: a micromark or parse5 upgrade
    // that moves ONE verdict has to be looked at, and the pin is the only
    // thing that forces the look. The boundary column rides along so a
    // scanner movement is visible here too, even on cells that owe nothing.
    expect(MEASURED).toEqual([...CONSTRUCT_AXIS_ALPHABET]);
  });

  /**
   * THE OBLIGATION. A disagreement over bytes a member claims agreement on is
   * an unbacked claim; the scanner must not have frozen into it. A
   * disagreement nothing claims is free.
   *
   * The failure message carries the byte shape and the verdict pair, because
   * a new claimed cell arriving here is a finding someone has to classify,
   * and the two things they will want first are what it looks like and how
   * the grammars split on it.
   */
  test('every claimed disagreement names a member and the boundary retreats', () => {
    const unnamed: string[] = [];
    const unretreated: string[] = [];
    for (const cell of MEASURED) {
      if (cell.verdict !== 'disagree' || !cell.claimed) continue;
      const where = `${cell.element}:${cell.operator} shape=${JSON.stringify(cell.shape)} T1=${cell.t1.join('/')} T2=${cell.t2.join('/')}`;
      if (cell.coveredBy === null) unnamed.push(where);
      if (cell.boundary > cell.at) unretreated.push(`${where} boundary=${cell.boundary} > at=${cell.at}`);
    }
    expect({ unnamed, unretreated }).toEqual({ unnamed: [], unretreated: [] });
  });

  /**
   * The benign bucket is pinned by NAME, not just by size.
   *
   * A disagreement that nothing claims owes no member, which is right — and
   * it is also the only silent path left in the table: a future element or
   * operator whose disagreement lands here would join 49 existing rows
   * without anyone looking at it once. The whole-table pin above already
   * fails when the generator sets grow, but it fails in a way that invites
   * pasting the regenerated rows back in; this one names the bucket, so
   * growing it is a deliberate edit with a reviewer attached.
   *
   * Adding a row here is not a defect by itself. It means: someone must
   * confirm that nothing claims agreement over those bytes, and say so.
   */
  test('the unclaimed-disagreement bucket is exactly these 39 cells', () => {
    const unclaimed = MEASURED.filter((c) => c.verdict === 'disagree' && !c.claimed).map(
      (c) => `${c.element}:${c.operator}`
    );
    expect(unclaimed.length).toBe(39);
    expect(unclaimed).toEqual([
      'pre:slash',
      'pre:space',
      'pre:attr',
      'pre:newline',
      'pre:truncate',
      'pre:elide',
      'title:identity',
      'title:slash',
      'title:space',
      'title:attr',
      'title:newline',
      'title:caseFold',
      'title:truncate',
      'title:elide',
      'iframe:identity',
      'iframe:slash',
      'iframe:space',
      'iframe:attr',
      'iframe:newline',
      'iframe:caseFold',
      'iframe:truncate',
      'iframe:elide',
      'plaintext:elide',
      'noscript:identity',
      'noscript:slash',
      'noscript:space',
      'noscript:attr',
      'noscript:newline',
      'noscript:caseFold',
      'noscript:truncate',
      'noscript:elide',
      'div:identity',
      'div:slash',
      'div:space',
      'div:attr',
      'div:newline',
      'div:caseFold',
      'div:truncate',
      'div:elide',
    ]);
  });

  /**
   * The retreat assertion above proves nothing on a document whose boundary
   * is 0 for unrelated reasons, so the control is measured rather than
   * assumed: with the CANONICAL closer, the scanner must freeze past the
   * point the mutations are judged at.
   *
   * `plaintext` is the one element where it does not — the element never ends
   * and the scanner poisons the document — so its eight cells assert nothing
   * and are named here instead of being counted as passes.
   */
  test('the anti-vacuity control: canonical closers freeze past the judged offset', () => {
    const vacuous = CONSTRUCT_AXIS_ELEMENTS.filter((element) => {
      const control = MEASURED.find((c) => c.element === element && c.operator === 'identity');
      return control === undefined || control.boundary <= control.at;
    });
    expect(vacuous).toEqual(['plaintext']);
  });

  /**
   * Attribution. Every claimed cell collapses to boundary 0, and a coarse
   * member could have done that on its own — so the zeros are read against a
   * one-name control. `pre` and `script` differ in exactly one measured fact
   * (parse5 governs `pre`'s content in DATA, `script`'s in SCRIPT_DATA), take
   * the same operators in the same sealed shape, and split: the raw-text
   * names go to 0 while `pre` stays up in the forties. That difference is
   * `maskUnbacked`'s signature and nothing else's — which is also why the
   * seal line exists, since without it the type-1 block runs to EOF and
   * `htmlBalanced` alone would zero both sides.
   */
  test('pre versus script attributes the collapse to the raw-text premise', () => {
    const at = (element: string, operator: string): ConstructAxisCell =>
      MEASURED.find((c) => c.element === element && c.operator === operator)!;
    for (const operator of ['slash', 'space', 'attr', 'newline']) {
      expect({
        operator,
        script: at('script', operator).boundary,
        preFroze: at('pre', operator).boundary > at('pre', operator).at,
      }).toEqual({ operator, script: 0, preFroze: true });
    }
  });
});

describe('construct axis: the facts the templates are derived from', () => {
  /**
   * F13, performed. `GRAMMAR-COVERAGE` has carried both halves of this since
   * its first commit — `pre` in the type-1 name list, absent from the parse5
   * raw-text list — and the subtraction was never done until fuzz did it the
   * expensive way. Here it is one line, measured from the grammars, and it
   * fails the moment either list moves.
   */
  test('micromark type-1 minus parse5 raw text is exactly {pre}', () => {
    // Asked with NO closer: type-1-ness is "a blank does not end this
    // block", and a canonical closer ends it first, so passing one measures
    // the closer instead of the start condition.
    const type1 = CONSTRUCT_AXIS_ELEMENTS.filter((e) => micromarkKeepsBlockOpenPastBlank(`<${e}>`, '', CFG));
    const rawText = CONSTRUCT_AXIS_ELEMENTS.filter((e) => measureP5ContentState(e, CFG) !== 'DATA');
    expect({
      type1,
      type1ButNotRawText: type1.filter((e) => !rawText.includes(e)),
      rawTextButNotType1: rawText.filter((e) => !type1.includes(e)),
    }).toEqual({
      type1: ['script', 'pre', 'style', 'textarea'],
      type1ButNotRawText: ['pre'],
      rawTextButNotType1: ['title', 'iframe', 'plaintext'],
    });
  });

  /**
   * The two name lists the scanner keys its raw-text mask on, checked against
   * what the grammars actually do — F13's set difference performed against
   * the scanner's OWN taxonomy rather than against a transcription of it.
   *
   * This is the check that must not be skipped once `SCANNER_NAME_LISTS`
   * exists. A derived alphabet built FROM those lists inherits their blind
   * spots: a name wrong in the list is also absent from the alphabet meant to
   * catch it, which is the F13 shape one layer up. The lists are cheap to
   * falsify directly, so they are falsified directly.
   *
   * Residual limit, stated rather than implied — the same honesty the `type6`
   * test below owes and pays. The candidate set is the two lists plus seven
   * neighbours that have been argued about before, which is wide enough to
   * catch a name that DOES NOT BELONG (every listed name is measured) but not
   * wide enough to guarantee catching one that is MISSING: a type-1 or
   * raw-text name absent from both the lists and those seven would never be
   * probed. The pool is the boundary of this claim, and it is narrower than
   * `type6`'s, which draws on an independent element universe.
   *
   * Risk today is nil rather than managed: CommonMark type 1 is exactly
   * `pre`/`script`/`style`/`textarea` and cannot grow without a spec change,
   * which is why the pool is left as it is instead of widened. If that ever
   * stops being true, widen the pool — do not re-read this comment as
   * coverage it does not provide.
   *
   * Only `type1` and `rawText` are covered here. `void` and `type6` have their
   * own tests below; `documentStructure`, `tablePart`, `scopeBarrier` and
   * `foreignRoot` are NOT checked anywhere and still rest on transcription.
   */
  test('the scanner name lists agree with the grammars they model', () => {
    const lists = new Map(SCANNER_NAME_LISTS);
    const type1List = lists.get('type1');
    const rawTextList = lists.get('rawText');
    if (type1List === undefined || rawTextList === undefined) throw new Error('SCANNER_NAME_LISTS lost a list');

    const candidates = [
      ...new Set([
        ...type1List,
        ...rawTextList,
        // Neighbours with a history: `pre` (type 1, DATA — F13), `noscript`
        // (raw text only with scripting ON), `template` (erased whole, F11),
        // the foreign roots, and two ordinary controls.
        'pre',
        'noscript',
        'template',
        'svg',
        'math',
        'div',
        'b',
      ]),
    ].sort();

    const states = new Map(candidates.map((e) => [e, measureP5ContentState(e, CFG)]));
    // Names whose content never reaches the tree cannot be judged either way,
    // and are listed rather than silently folded into one side. `template` is
    // the only one, because `hast-util-raw` does not surface `.content`; the
    // scanner leaves it out of RAW_TEXT_ELEMENTS and covers it by the F11
    // document-wide erasure poison instead, which this adapter cannot see.
    const unmeasurable = candidates.filter((e) => states.get(e) === 'UNMEASURABLE');
    const measuredType1 = candidates.filter((e) => micromarkKeepsBlockOpenPastBlank(`<${e}>`, '', CFG));
    const judgeable = candidates.filter((e) => !unmeasurable.includes(e));
    const measuredRawText = judgeable.filter((e) => states.get(e) !== 'DATA');

    expect({
      unmeasurable,
      type1MissingFromList: measuredType1.filter((e) => !type1List.has(e)),
      type1ListedButNotType1: [...type1List].filter((e) => !measuredType1.includes(e)),
      rawTextMissingFromList: measuredRawText.filter((e) => !rawTextList.has(e)),
      rawTextListedButNotRaw: [...rawTextList].filter((e) => !measuredRawText.includes(e)),
    }).toEqual({
      unmeasurable: ['template'],
      type1MissingFromList: [],
      type1ListedButNotType1: [],
      rawTextMissingFromList: [],
      rawTextListedButNotRaw: [],
    });
  });

  /**
   * `type6` is the biggest list in `SCANNER_NAME_LISTS` (62 names) and, until
   * this test, the largest self-certifying surface in a design where a census
   * derives its alphabet FROM those lists.
   *
   * The candidate pool deliberately does NOT come from the list under test.
   * It is assembled from sources that know nothing about it: the void-element
   * package, the raw-name list, a hand-written set of ordinary HTML elements
   * that are NOT block names, and two names that are not elements at all. The
   * list itself is unioned in last, so a name that does not belong reds too —
   * but no name in the pool owes its presence to the list.
   *
   * Residual limit, stated rather than implied: a type-6 name that is missing
   * from BOTH the pool and the list still escapes. The pool is the boundary of
   * this claim.
   */
  test('the type6 list agrees with what micromark does', () => {
    const lists = new Map(SCANNER_NAME_LISTS);
    const type6List = lists.get('type6');
    if (type6List === undefined) throw new Error('SCANNER_NAME_LISTS lost type6');

    const pool = [
      ...new Set([
        ...HTML_VOID_ELEMENTS,
        ...NON_BLOCK_HTML_ELEMENTS,
        'pre',
        'script',
        'style',
        'textarea',
        'not-an-element',
        'xyzzy',
        ...type6List,
      ]),
    ].sort();

    // Type 1 interrupts a paragraph as well, so it is subtracted by the other
    // measurable difference: a blank line ends type 6 and does not end type 1.
    const measured = pool.filter(
      (n) => micromarkOpensType6(n, CFG) && !micromarkKeepsBlockOpenPastBlank(`<${n}>`, '', CFG)
    );

    expect({
      poolSize: pool.length,
      missingFromList: measured.filter((n) => !type6List.has(n)),
      listedButNotType6: [...type6List].filter((n) => !measured.includes(n)),
    }).toEqual({ poolSize: 134, missingFromList: [], listedButNotType6: [] });
  });

  /**
   * `void` against parse5's own behaviour, pooled from `html-void-elements`
   * (which the scanner does not use) plus the list plus controls.
   *
   * The two directions are NOT symmetric and are asserted separately:
   *
   * - `listedButNotVoid` is the DANGEROUS direction. The scanner would skip
   *   pushing an element it believes void while parse5 leaves it open, so the
   *   open-element count runs low and the boundary widens — an under-block.
   * - `missingFromList` is the SAFE direction: the scanner pushes an element
   *   parse5 never opened, over-counts, and over-blocks.
   *
   * The safe direction is expected to be non-empty and is pinned by name, so
   * the set is a decision someone made rather than a set nobody looked at.
   */
  test('the void list agrees with what parse5 does, and its gaps are the safe ones', () => {
    const lists = new Map(SCANNER_NAME_LISTS);
    const voidList = lists.get('void');
    if (voidList === undefined) throw new Error('SCANNER_NAME_LISTS lost void');

    const pool = [...new Set([...HTML_VOID_ELEMENTS, ...NON_BLOCK_HTML_ELEMENTS, 'div', 'p', ...voidList])].sort();
    const verdicts = new Map(pool.map((n) => [n, measureIsVoid(n, CFG)]));
    const measuredVoid = pool.filter((n) => verdicts.get(n) === 'void');

    expect({
      // Not "everything the pool could not prove void" — only a DEFINITE
      // contradiction counts here. Folding `unmeasurable` in was this test's
      // first bug and it manufactured a dangerous-direction hit out of `col`,
      // whose element parse5 never puts in the tree at all.
      listedButNotVoid: [...voidList].filter((n) => verdicts.get(n) === 'holds-content'),
      missingFromList: measuredVoid.filter((n) => !voidList.has(n)),
      unmeasurable: pool.filter((n) => verdicts.get(n) === 'unmeasurable'),
    }).toEqual({
      listedButNotVoid: [],
      // The safe direction, pinned by name so it stays a decision. parse5
      // treats all three as void; the scanner does not list them, so it
      // pushes an element parse5 never opened, over-counts, and over-blocks.
      // Obsolete names a markdown stream is unlikely to carry, which is
      // presumably why they were left out — recorded, not "fixed".
      missingFromList: ['basefont', 'bgsound', 'keygen'],
      // Void-ness is not observable for these four. `col` and `frame` are
      // re-dispatched out of the tree outside a table/frameset, `image` is
      // rewritten to `img` by parse5, and `template` hides its content on
      // `.content`. All four would otherwise read as "holds nothing", which
      // is indistinguishable from void — the same false positive the content
      // -state adapter hit on its first run.
      unmeasurable: ['col', 'frame', 'image', 'template'],
    });
  });

  /** Table B's five states, discriminated through the tree rather than read
   *  off `RAW_TEXT_ELEMENTS`. `noscript` landing in DATA is the
   *  `scriptingEnabled: false` fact, which the scanner's name list gets right
   *  by a comment; this gets it right by measurement. */
  test('each element is governed by the tokenizer state Table B assigns it', () => {
    const measured: Record<string, P5ContentState> = {};
    for (const element of CONSTRUCT_AXIS_ELEMENTS) measured[element] = measureP5ContentState(element, CFG);
    expect(measured).toEqual({
      script: 'SCRIPT_DATA',
      pre: 'DATA',
      style: 'RAWTEXT',
      textarea: 'RCDATA',
      title: 'RCDATA',
      iframe: 'RAWTEXT',
      plaintext: 'PLAINTEXT',
      noscript: 'DATA',
      div: 'DATA',
    });
  });
});

describe('construct axis: how complete the operator set is', () => {
  /**
   * The measurement that makes the operator set a defensible generator rather
   * than a guess. The T2 verdict domain is {md-live, md-inert} x {tag-live,
   * tag-inert}, and the operators reach all four — the fourth,
   * `md-live/tag-inert`, is F10's direction and only `elide` produces it, so
   * dropping that operator would leave a whole quadrant unsampled and the
   * count would say so.
   *
   * The parse5 side of the comparison is the state census above: five states
   * can govern content, and the element set reaches five.
   */
  test('the operators reach all four T2 quadrants and all four T1 pairs', () => {
    const quadrants = new Set(MEASURED.map((c) => c.t2.join('/')));
    const pairs = new Set(MEASURED.map((c) => c.t1.join('/')));
    const states = new Set(CONSTRUCT_AXIS_ELEMENTS.map((e) => measureP5ContentState(e, CFG)));
    expect({
      quadrants: [...quadrants].sort(),
      t1Pairs: [...pairs].sort(),
      statesGoverned: states.size,
    }).toEqual({
      quadrants: ['md-inert/tag-inert', 'md-inert/tag-live', 'md-live/tag-inert', 'md-live/tag-live'],
      t1Pairs: ['after/at-closer', 'after/runs-on', 'at-closer/at-closer', 'at-closer/runs-on'],
      statesGoverned: 5,
    });
  });

  /** `elide` is the operator that earns the fourth quadrant. Pinned as its
   *  own claim so a future trim of the operator set fails here with the
   *  reason attached, instead of quietly dropping the coverage. */
  test('elide is the only operator that reaches md-live/tag-inert', () => {
    const reaching = MEASURED.filter((c) => c.t2.join('/') === 'md-live/tag-inert').map((c) => c.operator);
    expect([...new Set(reaching)]).toEqual(['elide']);
  });

  /** The census leg samples these; the shapes are asserted non-empty and
   *  deduped so a consumer importing them gets a token list rather than a
   *  surprise. */
  test('the alphabet exports a usable token list', () => {
    expect(CONSTRUCT_AXIS_DISAGREEING_SHAPES.length).toBe(48);
    expect(CONSTRUCT_AXIS_CLAIMED_SHAPES).toEqual([
      '</script/>',
      '</script >',
      '</script a="b">',
      '</script\n>',
      '</script',
      '</style/>',
      '</style >',
      '</style a="b">',
      '</style\n>',
      '</style',
      '</textarea/>',
      '</textarea >',
      '</textarea a="b">',
      '</textarea\n>',
      '</textarea',
    ]);
    expect(CONSTRUCT_AXIS_DISAGREEING_SHAPES.every((s) => s.length > 0)).toBe(true);
  });
});
