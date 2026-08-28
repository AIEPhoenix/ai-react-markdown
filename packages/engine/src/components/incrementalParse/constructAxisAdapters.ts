/**
 * TEST-ONLY adapters for the construct-axis differential probe (v2.9 item
 * #1), plus the alphabet the probe measures.
 *
 * The scanner has to predict two grammars at once, and every under-block in
 * the deviation ledger is one field standing in for both. `GRAMMAR-COVERAGE`
 * records where they differ; this module asks the question mechanically
 * instead, over a closed operator set, so the answer is a measurement rather
 * than a sentence someone has to remember to act on.
 *
 * Why a probe and not another prose row: both of the last two ledger entries
 * were already WRITTEN DOWN before they shipped. `GRAMMAR-COVERAGE` carried
 * both halves of the F13 fact from its first commit — `pre` in the type-1
 * name list, absent from the parse5 raw-text list, one set difference apart —
 * and nobody performed the subtraction; fuzz found F13 months later. The F20
 * fact sits as prose in `p5TokPartition.test.ts`, in the very file that tests
 * that state, and F20 still reached the v2.8.2 release gate. What was missing
 * both times is not the fact but the INFERENCE it licenses: *therefore any
 * scanner member whose contract is "both grammars agree here" is unbacked in
 * this state*. So the inference is what this module computes.
 *
 * Two question templates, one operator set, four adapters:
 *
 * - **T1, terminators** — what byte sequence ENDS construct C? micromark's
 *   answer is the mdast html block's extent (`mdBlockExtent`); parse5's is
 *   how much the hast element swallowed (`elementSwallows`).
 * - **T2, content governance** — what tokenizer state governs the bytes after
 *   the closer? micromark answers by whether a markdown construct placed
 *   there becomes a node (`md-live`) or stays inside its opaque html block
 *   (`md-inert`); parse5 answers by whether an inner `<b>` comes back as an
 *   element (`tag-live`) or as text (`tag-inert`).
 *
 * The generator side is deliberately an operator set rather than a fact set,
 * because a fact set's completeness is unfalsifiable while an operator set's
 * is MEASURABLE: count the distinct verdict pairs the operators produce and
 * compare against the parse5 tokenizer states that can govern content.
 * `constructAxisProbe.test.ts` performs both counts.
 *
 * Nothing here introspects the scanner. `measureP5ContentState` discriminates
 * parse5's state behaviourally — through the hast, the way `formElement`
 * taught us to — and `micromarkKeepsBlockOpenPastBlank` reads micromark's own
 * block division. The scanner is only ever observed through the boundary it
 * grants, which is the one output the safety claim is stated over.
 *
 * @module components/incrementalParse/constructAxisAdapters
 */

import rehypeRaw from '@ai-markdown/rehype-raw';

import { parseStage, transformStage } from '../markdown';
import { runFull } from './spliceArbiterHarness';
import { buildAdvanceOptions, type CatalogConfig } from './testPluginCatalog';

interface PosPoint {
  offset?: number;
}

interface NodeLike {
  type: string;
  value?: string;
  tagName?: string;
  children?: NodeLike[];
  position?: { start?: PosPoint; end?: PosPoint };
}

// ── adapters ────────────────────────────────────────────────────────────

/**
 * The production chain truncated after `rehype-raw` — the layer the two
 * grammars actually meet at.
 *
 * Sanitize is deliberately NOT applied. It masks real parse5 divergences (the
 * `formElement` counterexample survives to the final hast as equal output
 * only because `form` is lifted), and `sanitizeSchema` is a public prop, so a
 * verdict read after sanitize would be a verdict about the default schema
 * rather than about the grammar.
 *
 * This duplicates `conformanceOracles.ts`'s private `runToRawLayer`; that
 * file is owned elsewhere this cycle, so the four lines are copied rather
 * than exported. Worth collapsing to one export when both files are free.
 */
export function runToRawLayer(content: string, config: CatalogConfig): NodeLike {
  const options = buildAdvanceOptions(config);
  const parsed = parseStage({
    children: content,
    remarkPlugins: options.remarkPlugins,
    rehypePlugins: [[rehypeRaw, { passThrough: [] }]] as never,
    remarkRehypeOptions: options.remarkRehypeOptions,
  });
  return transformStage(parsed) as unknown as NodeLike;
}

/**
 * ADAPTER 1 — micromark's block extent: the widest `html` node covering
 * `offset`, or null.
 *
 * The walk goes through the WHOLE tree, not `tree.children`. mdast reuses the
 * `html` node type for inline html, and a container-held block hangs under
 * its blockquote or list item — a root-only version of this walk is blind to
 * exactly the container-held blocks F14 turned out to be about, and it pinned
 * four of seven container rows to the wrong answers for two days.
 */
export function mdBlockExtent(mdast: NodeLike, offset: number): [number, number] | null {
  let widest: [number, number] | null = null;
  const walk = (node: NodeLike): void => {
    for (const child of node.children ?? []) {
      const s = child.position?.start?.offset;
      const e = child.position?.end?.offset;
      if (child.type === 'html' && s !== undefined && e !== undefined && s <= offset && offset < e) {
        if (widest === null || e > widest[1]) widest = [s, e];
      }
      walk(child);
    }
  };
  walk(mdast);
  return widest;
}

/** Is a node of `type` covering `offset` anywhere in the tree? The T2
 *  micromark half asks this about `emphasis`: a markdown construct that
 *  became a node proves micromark is parsing flow there rather than holding
 *  the bytes inside an opaque html block. */
export function nodeCovers(mdast: NodeLike, type: string, offset: number): boolean {
  for (const child of mdast.children ?? []) {
    const s = child.position?.start?.offset;
    const e = child.position?.end?.offset;
    if (child.type === type && s !== undefined && e !== undefined && s <= offset && offset < e) return true;
    if (nodeCovers(child, type, offset)) return true;
  }
  return false;
}

/** The first element with `tagName`, any depth. */
export function findElement(root: NodeLike, tagName: string): NodeLike | null {
  for (const child of root.children ?? []) {
    if (child.type === 'element' && child.tagName === tagName) return child;
    const deeper = findElement(child, tagName);
    if (deeper !== null) return deeper;
  }
  return null;
}

/** Concatenated text at every depth. */
export function textContent(node: NodeLike): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textContent).join('');
}

/**
 * ADAPTER 2 — parse5's element extent, stated as what the element SWALLOWED.
 *
 * Offsets are not usable for this: `rehype-raw` reserialization drops
 * positions on 26% of nodes and can hand back inverted ranges. A marker the
 * document plants after the closer answers the same question without them —
 * `runs-on` when the element ate it, `at-closer` when it did not, `absent`
 * when there is no such element at all.
 *
 * `absent` is a third answer on purpose, not a null: a truncated end tag
 * consumes the following line as attributes, so "the marker is not inside the
 * element" and "the element never existed" are different facts about the
 * terminator, and collapsing them was this adapter's first bug.
 */
export function elementSwallows(root: NodeLike, tagName: string, marker: string): 'runs-on' | 'at-closer' | 'absent' {
  const host = findElement(root, tagName);
  if (host === null) return 'absent';
  return textContent(host).includes(marker) ? 'runs-on' : 'at-closer';
}

/** The five parse5 tokenizer states that can govern an element's content —
 *  Table B's rows, and the domain the operator-completeness measurement is
 *  counted against. */
export type P5ContentState = 'DATA' | 'RCDATA' | 'RAWTEXT' | 'SCRIPT_DATA' | 'PLAINTEXT' | 'UNMEASURABLE';

/**
 * ADAPTER 3 — which tokenizer state governs `element`'s content, measured
 * through the hast rather than read off a name list.
 *
 * Discriminators, applied in this order because each later one assumes the
 * earlier answers:
 *
 * 0. an element whose content never reaches the tree at all is UNMEASURABLE —
 *    see below, this guard is load-bearing;
 * 1. an inner `<i>` that comes back as an ELEMENT ANYWHERE means markup was
 *    acted on — DATA, and nothing else;
 * 2. otherwise, an element that swallows text past its own end tag never
 *    ends — PLAINTEXT;
 * 3. otherwise, `&amp;` arriving DECODED is character-reference handling —
 *    RCDATA, which is the only difference from RAWTEXT that reaches the tree;
 * 4. otherwise, content surviving a `<!--<E>` … `-->` nest is the script-data
 *    escape ladder — SCRIPT_DATA;
 * 5. otherwise RAWTEXT.
 *
 * Deriving the set instead of mirroring `RAW_TEXT_ELEMENTS` is the whole
 * point. A mirrored constant agrees with the scanner for the same reason the
 * scanner is right or wrong; a measurement disagrees when the scanner is
 * wrong, which is what F13 needed and did not have.
 *
 * TWO PREMISE FAILURES, both found by pointing this at the scanner's own name
 * lists (2026-08-28) and both of which it answered CONFIDENTLY AND WRONGLY
 * before the guards existed — a measurement that cannot detect its own
 * inapplicability is worse than a transcription, because it looks like
 * evidence:
 *
 * - `<template>` puts its children on `.content`, which `hast-util-raw` never
 *   surfaces (the F11 fact). The host came back empty, so step 1 saw no `<i>`
 *   and step 3 saw no `&amp;` — and the empty string "decodes", so it was
 *   reported RCDATA. Step 0 catches it: content went in and nothing came out.
 * - `<svg>` / `<math>` switch namespace, and `<i>` is a BREAKOUT tag — it pops
 *   the foreign root and lands as a SIBLING, so looking for it inside the host
 *   found nothing and the decoded `&` again said RCDATA. Step 1 now asks
 *   whether an `<i>` element exists ANYWHERE, which is the question that
 *   actually distinguishes "markup was acted on" from "markup became text":
 *   a raw-text element leaves no `<i>` element in the tree at all, wherever
 *   the tree construction puts it.
 */
export function measureP5ContentState(element: string, config: CatalogConfig): P5ContentState {
  // Step 0. Did the element's content reach the tree at all? If the source
  // carried a marker and no marker survives anywhere, this element's content
  // is not observable here and every later discriminator is reading silence.
  const probe = runToRawLayer(`<${element}>\nMARKER\n</${element}>\n`, config);
  if (!textContent(probe).includes('MARKER')) return 'UNMEASURABLE';

  const withInner = runToRawLayer(`<${element}>\n<i>i</i>\n</${element}>\n`, config);
  if (findElement(withInner, 'i') !== null) return 'DATA';
  if (
    elementSwallows(runToRawLayer(`<${element}>\nx\n</${element}>\nAFTER\n`, config), element, 'AFTER') === 'runs-on'
  ) {
    return 'PLAINTEXT';
  }
  const amp = findElement(runToRawLayer(`<${element}>\n&amp;\n</${element}>\n`, config), element);
  if (amp !== null && !textContent(amp).includes('&amp;')) return 'RCDATA';
  const nested = `<${element}>\n<!--<${element}>\n</${element}>\nDEEP\n-->\n</${element}>\n`;
  if (elementSwallows(runToRawLayer(nested, config), element, 'DEEP') === 'runs-on') return 'SCRIPT_DATA';
  return 'RAWTEXT';
}

/**
 * ADAPTER 4 — is micromark's block for this opener/closer pair blank-immune?
 *
 * This is CommonMark's type-1 end condition observed rather than pattern
 * matched: types 2-7 all end at or before a blank line, type 1 does not, so a
 * line BELOW a blank that is still inside the html node starting at offset 0
 * means the block is type 1 and still open.
 *
 * It is measured per CELL, not per element name, because the operator can
 * change the answer: `<script/>` is not a type-1 start (the `/` fails the
 * start condition) even though `script` is a type-1 name, and a claim keyed
 * on the name would be wrong there.
 */
export function micromarkKeepsBlockOpenPastBlank(opener: string, closer: string, config: CatalogConfig): boolean {
  const doc = `${opener}\nx\n${closer}\n\ny\n`;
  const { mdast } = runFull(doc, config) as { mdast: NodeLike };
  return mdBlockExtent(mdast, doc.lastIndexOf('y')) !== null;
}

/**
 * Is there a FLOW html node covering `offset` — one whose parent is not a
 * paragraph?
 *
 * The parent test is the whole point. mdast reuses the `html` node type for
 * INLINE html, so `mdBlockExtent` alone cannot tell "this line opened an html
 * block" from "this tag sits inside a paragraph". Asking the root's children
 * only is the opposite mistake and is the one GRAMMAR-COVERAGE records: a
 * container-held block hangs under its blockquote or list item, and a
 * root-only oracle pinned four of seven container rows wrong.
 */
function flowHtmlCovers(node: NodeLike, offset: number, parentType: string | null): boolean {
  for (const child of node.children ?? []) {
    const s = child.position?.start?.offset;
    const e = child.position?.end?.offset;
    if (
      child.type === 'html' &&
      parentType !== 'paragraph' &&
      s !== undefined &&
      e !== undefined &&
      s <= offset &&
      offset < e
    ) {
      return true;
    }
    if (flowHtmlCovers(child, offset, child.type)) return true;
  }
  return false;
}

/**
 * ADAPTER 5 — does `<name>` open a CommonMark type-6 block?
 *
 * Measured by the one property that separates type 6 from type 7: **type 6
 * may interrupt a paragraph and type 7 may not** (§4.6). So the probe puts the
 * tag on a paragraph continuation line and asks whether micromark ended the
 * paragraph and opened a flow html block there.
 *
 * Type 1 interrupts too, so the type-1 names would answer yes; the caller
 * subtracts them with `micromarkKeepsBlockOpenPastBlank`, which is the other
 * measurable difference (a blank ends type 6, not type 1). Types 2-5 never
 * enter a name-keyed comparison — their start conditions are punctuation.
 */
export function micromarkOpensType6(name: string, config: CatalogConfig): boolean {
  const doc = `para text\n<${name}>\nafter\n`;
  const { mdast } = runFull(doc, config) as { mdast: NodeLike };
  return flowHtmlCovers(mdast, doc.indexOf(`<${name}>`), null);
}

/** What `measureIsVoid` could determine. `unmeasurable` covers an element
 *  parse5 does not put in the tree at all (the document-structure names are
 *  absorbed) — void-ness is not observable there, and saying so beats
 *  guessing either way. */
export type VoidVerdict = 'void' | 'holds-content' | 'unmeasurable';

/**
 * ADAPTER 6 — does parse5 treat `<name>` as a void element?
 *
 * A void element takes no children, so a marker written between its tags ends
 * up as a SIBLING rather than inside it. That is the observable, and it needs
 * no name list.
 *
 * `unmeasurable` is returned rather than a verdict when the element never
 * reaches the tree (`<head>`, `<body>`, `<html>` are absorbed into document
 * structure) or when its content is hidden (`<template>`). Both would
 * otherwise read as "no content inside it" — which is exactly the shape of a
 * void element, and exactly the false positive that made this adapter's
 * sibling report three bogus names on its first run.
 */
export function measureIsVoid(name: string, config: CatalogConfig): VoidVerdict {
  const raw = runToRawLayer(`<${name}>MARKER</${name}>\n`, config);
  const swallows = elementSwallows(raw, name, 'MARKER');
  if (swallows === 'absent') return 'unmeasurable';
  if (swallows === 'runs-on') return 'holds-content';
  // The element exists and does not hold the marker. Distinguish "void" from
  // "the marker vanished with the element's content": the marker must still be
  // SOMEWHERE, as a sibling.
  return textContent(raw).includes('MARKER') ? 'void' : 'unmeasurable';
}

// ── the operator set ────────────────────────────────────────────────────

export type OperatorName = 'identity' | 'slash' | 'space' | 'attr' | 'newline' | 'caseFold' | 'truncate' | 'elide';

/**
 * The closed operator set, applied to a canonical end tag. Each one is a
 * single edit that a real stream produces on its own — a stray slash, a
 * trailing space, an attribute on a closer, a wrapped tag, shouting, a frame
 * that cut mid-tag, a closer that never arrived.
 *
 * `elide` (replace the closer with nothing, leaving the line blank) is the
 * member that earns the set its completeness: without it the operators reach
 * three of the four T2 quadrants, and the missing one is `md-live/tag-inert`
 * — the F10 direction, where micromark's block ended at the blank while
 * parse5's element ran on. It is still a closer operator, taken to its limit.
 */
export const CLOSER_OPERATORS: ReadonlyArray<readonly [OperatorName, (name: string) => string]> = [
  ['identity', (n) => `</${n}>`],
  ['slash', (n) => `</${n}/>`],
  ['space', (n) => `</${n} >`],
  ['attr', (n) => `</${n} a="b">`],
  ['newline', (n) => `</${n}\n>`],
  ['caseFold', (n) => `</${n.toUpperCase()}>`],
  ['truncate', (n) => `</${n}`],
  ['elide', () => ''],
];

/**
 * The elements the templates run over: every CommonMark type-1 name, plus one
 * type-6 representative of each parse5 content state, plus two DATA controls.
 * The set is chosen to span all five states of `P5ContentState` — the
 * completeness measurement checks that it does — and to carry the three names
 * whose two-grammar classification has already been wrong in production:
 *
 * - `pre` — type 1 to micromark, DATA to parse5 (F13);
 * - `title` — type 6 to micromark, RCDATA to parse5;
 * - `noscript` — RAWTEXT only with scripting ENABLED, which `hast-util-raw`
 *   is not, so it is DATA here and correctly absent from `RAW_TEXT_ELEMENTS`.
 */
export const CONSTRUCT_AXIS_ELEMENTS: readonly string[] = [
  'script',
  'pre',
  'style',
  'textarea',
  'title',
  'iframe',
  'plaintext',
  'noscript',
  'div',
];

/** Micromark's type-1 end condition is ANY of the four literal closers, not
 *  the one that opened the block, so this line re-seals a run-on type-1 block
 *  without being an end tag parse5 acts on — nothing of that name is open, so
 *  parse5's "any other end tag" walks the stack and discards it. Without the
 *  seal, a mutated closer leaves the md block open to EOF and the coarse
 *  `htmlBalanced` member alone drives the boundary to 0, hiding every finer
 *  member behind it. It is the shape F20's own fixture uses. */
export const sealFor = (element: string): string => (element === 'pre' ? '</style>' : '</pre>');

/** The document one cell is measured on. `x` is block content, `*<b>g</b>*`
 *  is the governance probe (a markdown construct and an html tag over the
 *  same bytes, so T2's two halves ask about one byte range), the seal closes
 *  micromark's block, and the blank plus trailing paragraphs give the scanner
 *  candidates to emit. */
export function cellDocument(element: string, closer: string): string {
  return `<${element}>\nx\n${closer}\n*<b>g</b>*\n${sealFor(element)}\n\ntail para\n\nend\n`;
}

/** Offset of the mutated closer's line start — where the disagreement the
 *  cell measures begins, and the offset the coverage obligation is stated
 *  against. */
export function cellDisagreementOffset(element: string): number {
  return `<${element}>\nx\n`.length;
}

// ── the alphabet ────────────────────────────────────────────────────────

/** micromark's terminator, relative to the mutated closer's line. */
export type T1Micromark = 'at-closer' | 'after' | 'none';
/** parse5's, from `elementSwallows`. */
export type T1Parse5 = 'at-closer' | 'runs-on' | 'absent';
/** Whether micromark parses flow in the bytes after the closer, or holds
 *  them inside an opaque html block. */
export type T2Micromark = 'md-live' | 'md-inert';
/** Whether parse5 acts on a tag in those bytes, or reads it as text. */
export type T2Parse5 = 'tag-live' | 'tag-inert';

export interface ConstructAxisCell {
  element: string;
  operator: OperatorName;
  /** The mutated closer's bytes — `''` for `elide`. This is the token the
   *  census leg samples. */
  shape: string;
  /** `cellDisagreementOffset(element)`, carried so a consumer needs no
   *  arithmetic. */
  at: number;
  t1: readonly [T1Micromark, T1Parse5];
  t2: readonly [T2Micromark, T2Parse5];
  /** `disagree` when the two grammars answer either template differently. */
  verdict: 'agree' | 'disagree';
  /**
   * Whether a scanner member's contract CLAIMS the two grammars agree over
   * these bytes, derived from the grammars alone:
   *
   *     claimed = micromark's block is still open past a blank
   *             ∧ parse5 governs this element's content as non-DATA
   *             ∧ parse5 has already LEFT that state at the closer
   *
   * which is `maskUnbacked = mdType1RawText(cp.mdBlock) && !inRawTextTok(cp.p5Tok)`
   * in `computeFreezeBoundary.ts`, restated as a measurement. A `disagree`
   * cell with `claimed: true` owes a named member and a boundary that
   * retreats; `constructAxisProbe.test.ts` fails when either is missing.
   *
   * WHY THE OBLIGATION IS NARROWED TO `claimed` (reviewed and approved
   * 2026-08-28; recorded here so it is not re-litigated). The constraint this
   * table exists to enforce was never "every disagreement must be explained".
   * It is "the scanner must not silently claim agreement where none exists".
   * 49 of the 64 disagreeing cells are a type-6 html block ending at a blank
   * while its parse5 element ends at its own end tag — a disagreement the
   * scanner never claimed away, and one the pipeline is built on. Demanding a
   * `coveredBy` string for those would manufacture exactly the ceremonial
   * prose the constraint exists to prevent, and the F13/F20 history is that
   * ceremonial prose is what fails.
   *
   * What keeps the narrowing sound is that `claimed` is MEASURED from the two
   * grammars and never read off `computeFreezeBoundary.ts`, so the test is not
   * checking the scanner against itself. That the three measured conjuncts
   * turn out to coincide with `maskUnbacked`'s semantics is therefore a
   * finding — the member really does cover the danger condition — rather than
   * a tautology. If the member's definition drifts away from the grammars,
   * these conjuncts do not drift with it, and the cell fails.
   */
  claimed: boolean;
  /** The member that owns a claimed cell, or null when nothing claims
   *  agreement over these bytes and the scanner is scanning them honestly. */
  coveredBy: string | null;
  /** The boundary `computeFreezeBoundary` grants on `cellDocument`, pinned so
   *  a movement is visible even where the obligation is already satisfied. */
  boundary: number;
}

/**
 * One row per cell: element, operator, shape, judged offset, T1's verdict
 * pair, T2's verdict pair, whether a member CLAIMS agreement here, and the
 * boundary the scanner grants.
 *
 * `verdict` and `coveredBy` are deliberately NOT stored — both are functions
 * of the fields above, and a stored copy is a second place for them to be
 * wrong. `constructAxisProbe.test.ts` regenerates every field from the two
 * grammars and compares the whole table, so this is a pin: a micromark or
 * parse5 upgrade that moves one verdict fails there instead of drifting.
 *
 * The 15 `claimed` cells are the ones with an obligation, and every one of
 * them sits at boundary 0. What attributes those zeros to `maskUnbacked`
 * rather than to a coarser member is the `pre` block: same operators, same
 * sealed shape, DATA instead of a raw-text state, boundary stays in the
 * forties.
 */
type AlphabetRow = readonly [
  element: string,
  operator: OperatorName,
  shape: string,
  at: number,
  t1Micromark: T1Micromark,
  t1Parse5: T1Parse5,
  t2Micromark: T2Micromark,
  t2Parse5: T2Parse5,
  claimed: boolean,
  boundary: number,
];

const ALPHABET_ROWS: readonly AlphabetRow[] = [
  // script — SCRIPT_DATA, type 1. The F20 family; `style` and `textarea`
  // below are the same premise in the other two raw-text states.
  ['script', 'identity', '</script>', 11, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 51],
  ['script', 'slash', '</script/>', 11, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['script', 'space', '</script >', 11, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['script', 'attr', '</script a="b">', 11, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['script', 'newline', '</script\n>', 11, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['script', 'caseFold', '</SCRIPT>', 11, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 51],
  ['script', 'truncate', '</script', 11, 'after', 'at-closer', 'md-inert', 'tag-inert', true, 0],
  ['script', 'elide', '', 11, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  // pre — type 1 to micromark, DATA to parse5 (F13). Nothing claims
  // agreement here, so the scan stays live and the boundary stays up: these
  // rows are the control the raw-text zeros are read against.
  ['pre', 'identity', '</pre>', 8, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 47],
  ['pre', 'slash', '</pre/>', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 48],
  ['pre', 'space', '</pre >', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 48],
  ['pre', 'attr', '</pre a="b">', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 53],
  ['pre', 'newline', '</pre\n>', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 48],
  ['pre', 'caseFold', '</PRE>', 8, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 47],
  ['pre', 'truncate', '</pre', 8, 'after', 'at-closer', 'md-inert', 'tag-inert', false, 46],
  ['pre', 'elide', '', 8, 'after', 'runs-on', 'md-inert', 'tag-live', false, 0],
  // style — RAWTEXT, type 1.
  ['style', 'identity', '</style>', 10, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 49],
  ['style', 'slash', '</style/>', 10, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['style', 'space', '</style >', 10, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['style', 'attr', '</style a="b">', 10, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['style', 'newline', '</style\n>', 10, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['style', 'caseFold', '</STYLE>', 10, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 49],
  ['style', 'truncate', '</style', 10, 'after', 'at-closer', 'md-inert', 'tag-inert', true, 0],
  ['style', 'elide', '', 10, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  // textarea — RCDATA, type 1.
  ['textarea', 'identity', '</textarea>', 13, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 55],
  ['textarea', 'slash', '</textarea/>', 13, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['textarea', 'space', '</textarea >', 13, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['textarea', 'attr', '</textarea a="b">', 13, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['textarea', 'newline', '</textarea\n>', 13, 'after', 'at-closer', 'md-inert', 'tag-live', true, 0],
  ['textarea', 'caseFold', '</TEXTAREA>', 13, 'at-closer', 'at-closer', 'md-live', 'tag-live', false, 55],
  ['textarea', 'truncate', '</textarea', 13, 'after', 'at-closer', 'md-inert', 'tag-inert', true, 0],
  ['textarea', 'elide', '', 13, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  // title — RCDATA to parse5, type 6 to micromark, so the terminators
  // already differ for the CANONICAL closer. The mutations move nothing,
  // which is why no operator here carries an obligation.
  ['title', 'identity', '</title>', 10, 'after', 'at-closer', 'md-inert', 'tag-live', false, 49],
  ['title', 'slash', '</title/>', 10, 'after', 'at-closer', 'md-inert', 'tag-live', false, 50],
  ['title', 'space', '</title >', 10, 'after', 'at-closer', 'md-inert', 'tag-live', false, 50],
  ['title', 'attr', '</title a="b">', 10, 'after', 'at-closer', 'md-inert', 'tag-live', false, 55],
  ['title', 'newline', '</title\n>', 10, 'after', 'at-closer', 'md-inert', 'tag-live', false, 50],
  ['title', 'caseFold', '</TITLE>', 10, 'after', 'at-closer', 'md-inert', 'tag-live', false, 49],
  ['title', 'truncate', '</title', 10, 'after', 'at-closer', 'md-inert', 'tag-inert', false, 48],
  ['title', 'elide', '', 10, 'at-closer', 'runs-on', 'md-live', 'tag-inert', false, 0],
  // iframe — RAWTEXT, type 6. Same shape as title, different state.
  ['iframe', 'identity', '</iframe>', 11, 'after', 'at-closer', 'md-inert', 'tag-live', false, 51],
  ['iframe', 'slash', '</iframe/>', 11, 'after', 'at-closer', 'md-inert', 'tag-live', false, 52],
  ['iframe', 'space', '</iframe >', 11, 'after', 'at-closer', 'md-inert', 'tag-live', false, 52],
  ['iframe', 'attr', '</iframe a="b">', 11, 'after', 'at-closer', 'md-inert', 'tag-live', false, 57],
  ['iframe', 'newline', '</iframe\n>', 11, 'after', 'at-closer', 'md-inert', 'tag-live', false, 52],
  ['iframe', 'caseFold', '</IFRAME>', 11, 'after', 'at-closer', 'md-inert', 'tag-live', false, 51],
  ['iframe', 'truncate', '</iframe', 11, 'after', 'at-closer', 'md-inert', 'tag-inert', false, 50],
  ['iframe', 'elide', '', 11, 'at-closer', 'runs-on', 'md-live', 'tag-inert', false, 0],
  // plaintext — never ends, so every cell disagrees and every boundary is
  // 0. Its control is 0 too, which makes this element's obligations VACUOUS;
  // the probe names that rather than counting eight free passes.
  ['plaintext', 'identity', '</plaintext>', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'slash', '</plaintext/>', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'space', '</plaintext >', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'attr', '</plaintext a="b">', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'newline', '</plaintext\n>', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'caseFold', '</PLAINTEXT>', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'truncate', '</plaintext', 14, 'after', 'runs-on', 'md-inert', 'tag-inert', false, 0],
  ['plaintext', 'elide', '', 14, 'at-closer', 'runs-on', 'md-live', 'tag-inert', false, 0],
  // noscript — DATA, because `hast-util-raw` sets `scriptingEnabled: false`.
  // Modelling it as raw text under-blocked once already; the measurement is
  // what keeps the answer honest if that option ever changes.
  ['noscript', 'identity', '</noscript>', 13, 'after', 'at-closer', 'md-inert', 'tag-live', false, 55],
  ['noscript', 'slash', '</noscript/>', 13, 'after', 'at-closer', 'md-inert', 'tag-live', false, 56],
  ['noscript', 'space', '</noscript >', 13, 'after', 'at-closer', 'md-inert', 'tag-live', false, 56],
  ['noscript', 'attr', '</noscript a="b">', 13, 'after', 'at-closer', 'md-inert', 'tag-live', false, 61],
  ['noscript', 'newline', '</noscript\n>', 13, 'after', 'at-closer', 'md-inert', 'tag-live', false, 56],
  ['noscript', 'caseFold', '</NOSCRIPT>', 13, 'after', 'at-closer', 'md-inert', 'tag-live', false, 55],
  ['noscript', 'truncate', '</noscript', 13, 'after', 'at-closer', 'md-inert', 'tag-inert', false, 54],
  ['noscript', 'elide', '', 13, 'at-closer', 'runs-on', 'md-live', 'tag-live', false, 0],
  // div — the DATA control. An html block that ends at the blank while its
  // element ends at its own end tag disagrees about the terminator by
  // construction: that is the pipeline working, not a hazard.
  ['div', 'identity', '</div>', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 45],
  ['div', 'slash', '</div/>', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 46],
  ['div', 'space', '</div >', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 46],
  ['div', 'attr', '</div a="b">', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 51],
  ['div', 'newline', '</div\n>', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 46],
  ['div', 'caseFold', '</DIV>', 8, 'after', 'at-closer', 'md-inert', 'tag-live', false, 45],
  ['div', 'truncate', '</div', 8, 'after', 'at-closer', 'md-inert', 'tag-inert', false, 44],
  ['div', 'elide', '', 8, 'at-closer', 'runs-on', 'md-live', 'tag-live', false, 0],
];

export const CONSTRUCT_AXIS_ALPHABET: readonly ConstructAxisCell[] = ALPHABET_ROWS.map(
  ([element, operator, shape, at, t1md, t1p5, t2md, t2p5, claimed, boundary]) => ({
    element,
    operator,
    shape,
    at,
    t1: [t1md, t1p5],
    t2: [t2md, t2p5],
    verdict: t1md !== t1p5 || (t2md === 'md-inert') !== (t2p5 === 'tag-inert') ? 'disagree' : 'agree',
    claimed,
    coveredBy: claimed ? 'maskUnbacked' : null,
    boundary,
  })
);

/**
 * The alphabet's primary consumer form: every distinct byte shape that made
 * the two grammars answer differently, deduped, in table order. `elide`'s
 * empty shape is excluded — it is the absence of a token, and a census token
 * list has nothing to sample for it.
 */
export const CONSTRUCT_AXIS_DISAGREEING_SHAPES: readonly string[] = [
  ...new Set(CONSTRUCT_AXIS_ALPHABET.filter((c) => c.verdict === 'disagree' && c.shape !== '').map((c) => c.shape)),
];

/** The subset a census should weight hardest: shapes on which a scanner
 *  member's contract asserts agreement the grammars do not have. These are
 *  F20's family, and the boundary must collapse on every one. */
export const CONSTRUCT_AXIS_CLAIMED_SHAPES: readonly string[] = [
  ...new Set(CONSTRUCT_AXIS_ALPHABET.filter((c) => c.claimed && c.shape !== '').map((c) => c.shape)),
];
