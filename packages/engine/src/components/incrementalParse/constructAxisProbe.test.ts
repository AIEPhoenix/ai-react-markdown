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

import { computeFreezeBoundary } from './computeFreezeBoundary';
import { CATALOG } from './testPluginCatalog';
import {
  CLOSER_OPERATORS,
  CONSTRUCT_AXIS_ALPHABET,
  CONSTRUCT_AXIS_CLAIMED_SHAPES,
  CONSTRUCT_AXIS_DISAGREEING_SHAPES,
  CONSTRUCT_AXIS_ELEMENTS,
  cellDisagreementOffset,
  cellDocument,
  elementSwallows,
  findElement,
  mdBlockExtent,
  measureP5ContentState,
  micromarkKeepsBlockOpenPastBlank,
  nodeCovers,
  runToRawLayer,
  type ConstructAxisCell,
  type P5ContentState,
} from './constructAxisAdapters';
import { runFull } from './spliceArbiterHarness';

const CFG = CATALOG[0];
const boundaryOf = (doc: string): number => computeFreezeBoundary(doc, { defListEnabled: false }).boundary;

interface NodeLike {
  type: string;
  children?: NodeLike[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

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

  const disagrees = t1md !== t1p5 || (t2md === 'md-inert') !== (t2p5 === 'tag-inert');
  return {
    element,
    operator: operator as ConstructAxisCell['operator'],
    shape: closer,
    at,
    t1: [t1md, t1p5],
    t2: [t2md, t2p5],
    verdict: disagrees ? 'disagree' : 'agree',
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
    expect(CONSTRUCT_AXIS_DISAGREEING_SHAPES.length).toBe(55);
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
