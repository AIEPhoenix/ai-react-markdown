/**
 * Freeze-boundary detector for incremental (prefix-freeze) parsing.
 *
 * Production port of the "L4" rule validated by the measurement study in
 * `src/experiments/prefixFreeze/` (see its README for the ablation ladder,
 * the falsification results, and the intentional two-way divergence note —
 * stricter blockers AND looser code-span masking; the corpus-scoped
 * directional pin lives in detectorConsistency.test.ts).
 *
 * The boundary is the largest source offset `b` such that, for ANY future
 * append to `text`, the markdown blocks that begin before `b` parse
 * byte-identically. Candidates are confirmed blank lines outside fenced
 * code and flow math; a candidate survives only if every blocker below
 * clears:
 *
 * 1. **Raw-HTML balance** — an unclosed container tag (or `<!--` comment)
 *    before the candidate lets rehype-raw reparent later top-level siblings
 *    into it (the v1.5.1 swallow bug, commit a8e89ec). Tag balance is
 *    tracked outside fences; while any tag, comment, or raw block
 *    (`<?…?>` / `<!DECL…>` / `<![CDATA[…]]>` — CommonMark html block types
 *    3–5) is open, candidates are blocked. Line-truncated tag starts
 *    (`<div` at EOL, attributes wrapping) count as opens. Closers that
 *    OVERLAP their opener (`<!-->`, `<!--->`, line-start `<?>`) close on
 *    the spot — CommonMark and parse5 agree — so the markup after them is
 *    scanned, not skipped as construct interior.
 * 2. **`$$` flow math** — remark-math's flow math swallows blank lines and
 *    runs to EOF when unclosed (verified empirically); its closing fence
 *    must sit at LINE START (a mid-line `$$` does not close it). Math
 *    interiors are treated exactly like fence interiors: no candidates.
 * 3. **Continuation context** — CommonMark lists, footnote definitions, and
 *    indented code blocks are NOT terminated by blank lines; later indented
 *    lines can extend a block that "ended" before the candidate. With the
 *    definition-list extension enabled, `: description` bodies behave the
 *    same way.
 * 4. **Definition-list term claim** (`options.defListEnabled`) — the
 *    micromark definition-list extension scans BACKWARD across exactly one
 *    blank line to claim a preceding paragraph as a `<dt>`. A candidate
 *    whose blank run is 1 is only safe once the next line is confirmed to
 *    never match `^ {0,3}:[ \t]`; runs of ≥ 2 blanks are immune.
 * 5. **Reference taint** — micromark decides reference-ness at parse time,
 *    so a later `[label]:` definition retargets earlier literal `[text]`.
 *    Every reference-style candidate before the boundary must resolve
 *    against a SETTLED definition (one followed by a confirmed blank line).
 *    Labels are matched with micromark's own `normalizeIdentifier`
 *    (Unicode case folding — `toLowerCase` is the unsafe direction).
 *    Definitions must START a block (or chain a valid definition line) —
 *    a def-shaped paragraph continuation line is literal text.
 * 6. **Raw-remnant seam** — an html FLOW run can swallow non-tag lines
 *    (e.g. a `$$` math fence glued under `</details>`); once tag balance
 *    returns to zero, that remnant becomes FLOATING text that parse5/
 *    rehype-raw attaches at the root, and its hast shape (position vs
 *    seam-owned position-less, trailing-newline ownership) depends on
 *    whether a sibling node FOLLOWS it. A tail block that flips between
 *    def (no hast output) and paragraph therefore reshapes the frozen
 *    region retroactively (2026-07-31 direction-battery counterexample,
 *    reproduced on v1.8.0). Every candidate emitted while the remnant is
 *    the last frozen child is rejected (they stay rejected for good); once
 *    a later confirmed content line pins the seam from the frozen side,
 *    the candidates AFTER that line are safe again. Dropping candidates
 *    only over-blocks (safe direction). Whitespace-only remnant counts.
 *    A type 2-5 block that opens AND closes on its first line owns the
 *    rest of that line as raw content too (`<!-- c --> tail`) — same seam.
 * 7. **Phase poison** (`phasePoisonedAt`) — points where this line-level
 *    model may have DIVERGED from micromark and provably cannot resync:
 *    a fence/math open suppressed by `mayBeRawToMicromark` (only certainly
 *    swallowed at top level — in a container it really opens and the
 *    open/close phase inverts permanently), and a paragraph-inline `<!--`
 *    that fails to close by end of line (literal text to micromark, but
 *    the comment scan would skip real markup as comment interior), and
 *    every point where CommonMark's terminator and parse5's tokenizer
 *    DISAGREE about where a raw construct ends (`--!>` closes a comment
 *    for parse5 only; a `<?…`/`<![CDATA[…` bogus comment ends at its
 *    first `>` for parse5 but at `?>`/`]]>` for CommonMark; a paragraph-
 *    inline `<?>` is open to micromark, closed to parse5) — the bytes in
 *    between are raw text to one grammar and real markup to the other, and
 *    the hast is parse5's. Every candidate past the first such point is
 *    rejected, sticky; candidates at or before it stay valid — the
 *    ambiguous region then re-parses inside the tail (pure over-block).
 *
 * ## Incremental scanning (checkpoint resume)
 *
 * The hot path calls this once per streamed frame. Appends leave every
 * previously-CONFIRMED line byte-identical, so the scan checkpoints its
 * entire per-line state after the last confirmed line (one whose
 * terminating `\n` exists) and, given `resume`, re-lexes only from there.
 * The trailing PARTIAL line is never baked into the checkpoint: it cannot
 * emit candidates (unconfirmed lines are never blank), its tag/ref effects
 * cannot affect candidates that all precede it, and the next frame re-lexes
 * it from scratch. Resume MUTATES the checkpoint monotonically and is
 * idempotent for identical input — but a checkpoint belongs to exactly one
 * advancing state lineage (advanceIncrementalParse's), never share it.
 *
 * Continuation hazards (blocker 3) are a forward-rolling verdict updated at
 * each decisive block start — equivalent to the previous per-candidate
 * upward walk ("nearest decisive block start above") at O(1) per candidate.
 * Reference taint (blocker 5) maintains defs and an unresolved-ref list
 * incrementally; settling is monotone, so resolved entries only ever leave.
 *
 * ## Inline code-span masking
 *
 * `` `<div>` ``, `` `[x]` `` and `` `[^n]` `` in prose are code, not
 * markup. Before HTML/ref/footnote extraction each line is masked using
 * micromark's own pairing rule (equal-length backtick runs, leftmost
 * first) — but ONLY when the pairing is provably intra-line: if any run on
 * a line is left unpaired, or an earlier line of the same paragraph left
 * one unpaired, masking is disabled for the rest of the paragraph. A
 * cross-line span can therefore never cause an unmask mismatch: every
 * masked span is one micromark would pair identically. Skipped masking
 * only over-blocks (safe direction).
 *
 * A line only counts as blank once its terminating newline exists: the
 * trailing partial line is UNCONFIRMED (the next chunk may append content
 * to it) and treating it as blank breaks boundary monotonicity.
 *
 * Footnote refs/defs participate in blockers 3 and 5 like their link
 * counterparts (separate label namespace); the engine splices across them
 * via injection replay (v2).
 */

import { htmlBlockNames } from 'micromark-util-html-tag-name';
import { isMdBlank, mdTrimStart } from './mdLineText';
import {
  collectRefLine,
  settleRefsAndEarliestUnresolved,
  DEF_RE,
  FOOTNOTE_DEF_RE,
  type UnresolvedRef,
} from './referenceTaint';

/** CommonMark type-6 block tag names (micromark's own list), lowercase. */
const TYPE6_NAMES = new Set(htmlBlockNames);
/** Table-part tag names: a stray one outside a table re-routes how parse5
 *  builds every LATER GFM table (cell text foster-parented to the root —
 *  v2.4.2 review P1-2; the splice bails on any such tag in the frozen
 *  prefix). Poisoning candidates from the tag on at the scanner saves the
 *  per-frame scan + tail parse + splice attempt that the bail would throw
 *  away, and keeps the direction battery honest (soak 2026-08-19: a
 *  `<td>` prefix froze a table whose shape depended on the tail). Same
 *  list as spliceParse's TABLE_PART_TAG_RE. */
const TABLE_PART_NAMES = new Set(['td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'col', 'colgroup']);
/** parse5 tree-construction CONSUMES these tokens: `rehype-raw` parses in
 *  FRAGMENT mode with a `<template>` context, so the run starts in "in
 *  template" and `startTagInTemplate` routes these names onward to the modes
 *  that absorb them into document structure — they emit NO node into the
 *  fragment. Their bytes
 *  vanish and the text nodes on either side MERGE into one — a merge whose
 *  result STARTS BEFORE the construct. That is retroactive: a `<!DOCTYPE>`
 *  arriving later rewrites hast the scanner already froze (2026-08-20,
 *  16800-shape sweep: `` `\`\`\`\n\`\`\`\n\n<!DOCTYPE>\ne` `` — the text node at
 *  index 1 goes `"\n"` → `"\n\n"`). Every other line-model invariant here
 *  assumes a confirmed line only affects itself and what follows, so these
 *  names cannot be modelled — they poison the whole document instead.
 *
 *  Counter-intuitively an UNCLOSED `<body>` was already safe: it left
 *  `openTotal` at 1, which blocked candidates by accident. Only the
 *  BALANCED `<body>…</body>` form reaches zero and freezes across. */
const DOCUMENT_STRUCTURE_NAMES = new Set(['html', 'head', 'body', 'frameset']);

/** The same retroactive constructs as literal openers, for the TRAILING
 *  PARTIAL line. That line is never confirmed and never enters the
 *  checkpoint, so `processConfirmedLine` cannot poison from it — yet the
 *  full parse the frozen prefix is checked against DOES see it, and a
 *  half-arrived `<!DOCTYPE html` already erases and merges (soak leg 1,
 *  shards 3 and 9: a snapshot cut mid-doctype froze at a boundary the
 *  arriving doctype then rewrote). */
const RETROACTIVE_OPENERS = [
  '<!doctype',
  '<html',
  '<head',
  '<body',
  '<frameset',
  '</html',
  '</head',
  '</body',
  '</frameset',
];

/** Does a partial line already carry one of them? Matches COMPLETE openers
 *  only. A "could still become one" arm was tried and reverted: every `<`
 *  is a prefix of every opener, so a stream cut right after a `<` dropped
 *  the boundary to 0 — and since the consumer takes
 *  `min(boundary, prev.stableBoundary)`, one transient dip disables
 *  freezing for the whole stream permanently. Frames that cut INSIDE an
 *  opener (`…<!DOCTYP`) need no suppression: the full parse they are
 *  checked against does not see a doctype there either, so the frozen
 *  prefix still matches. Suppresses the BOUNDARY only — nothing here may
 *  reach the checkpoint, since the tail is not confirmed. */
function tailCarriesRetroactive(text: string): boolean {
  const lower = text.toLowerCase();
  for (let i = lower.indexOf('<'); i !== -1; i = lower.indexOf('<', i + 1)) {
    const rest = lower.slice(i);
    for (const op of RETROACTIVE_OPENERS) if (rest.startsWith(op)) return true;
  }
  return false;
}
/** HTML start tags that BREAK OUT of foreign content (HTML spec "in foreign
 *  content": the svg/math is popped and the tag is processed as HTML). */
/** Elements whose CONTENT is parsed with HTML rules again inside svg/math. */
// `title` belongs here too: an SVG `title` is an HTML integration point, so
// its CONTENT is parsed with HTML rules (a `<g/>` inside it opens an element
// rather than honouring its self-closing flag). Adding the name is safe for
// the tokenizer question as well, because every call site asks BEFORE this
// tag's own `applyTag` counts it: while `<title>` itself is judged the count
// is still 0, so it does not switch to RCDATA — which is correct, a foreign
// `title` stays in the DATA state — and once it is open its children see
// HTML rules, which is also correct. `annotation-xml` is an HTML integration
// point only when its `encoding` is text/html or application/xhtml+xml;
// treating it as one unconditionally over-blocks, i.e. errs safe.
/** parse5 ignores an end tag whose element is not "in scope": the search walks
 *  DOWN the open-element stack and stops at a barrier. `<div><table></div>`
 *  therefore leaves the div OPEN — `</div>` is discarded, `</table>` pops only
 *  the table — and everything after it nests inside that div.
 *
 *  A name→count bag cannot see this: it decrements `div` because it counted a
 *  `div`, and reports balance. That is an UNDER-block, live since the scanner
 *  was written and found 2026-08-24 (`<div><table></div></table>` freezes at
 *  41 of 66 while the full parse nests the whole tail inside the div).
 *  `marquee`, `object`, `template` and `applet` are the same family.
 *
 *  Per the HTML spec's "has an element in scope"; the MathML text integration
 *  points and the SVG ones are barriers too. */
const SCOPE_BARRIER_NAMES = new Set([
  'applet',
  'caption',
  'html',
  'table',
  'td',
  'th',
  'marquee',
  'object',
  'template',
  'mi',
  'mo',
  'mn',
  'ms',
  'mtext',
  'annotation-xml',
  'foreignobject',
  'desc',
  'title',
]);
/** The two foreign-namespace roots markdown can reach. */
const FOREIGN_ROOT_NAMES = ['svg', 'math'];
/** CommonMark type-1 block start names — start tags only. */
const TYPE1_NAMES = new Set(['script', 'pre', 'style', 'textarea']);
/** parse5 elements whose CONTENT is text to the tokenizer (RAWTEXT /
 *  RCDATA / script data / plaintext): every `<…>` inside is text until the
 *  element's own end tag. Not the CommonMark type-1 list — `title`,
 *  `iframe`, `noframes`, `xmp`, `noembed` sit in the type-6 list, so their content is a normal html
 *  block to micromark yet text to parse5, and a `</div>` in there closed the
 *  outer div in the balance (2026-08-19 review r2 P1-4). `plaintext` never
 *  ends. */
const RAW_TEXT_ELEMENTS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  // NOT `noscript`: hast-util-raw constructs parse5 with
  // `scriptingEnabled: false`, under which `<noscript>` content is ordinary
  // HTML — modelling it as raw text ignored a `<b>` inside and under-blocked
  // (oracle review of the r2 batch; regression caught before release).
  'plaintext',
]);
/** Type-6 start: `<`/`</` + name + (whitespace | `>` | `/>` | EOL). */
const TYPE6_START_RE = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t\r]|\/?>|$)/;
/** Type-1 start: an OPEN tag of a raw-text name + (whitespace | `>` | EOL). */
const TYPE1_START_RE = /^<(script|pre|style|textarea)(?:[ \t\r]|>|$)/i;
/** Type 1's end condition is a literal substring anywhere on the line —
 *  no attributes, no whitespace before `>` (CommonMark 4.6). */
const TYPE1_CLOSE_RE = /<\/(?:script|pre|style|textarea)>/i;
/** Type-7 start (approximate, no quoted-`>` support): the whole line is
 *  one complete OPEN tag (attributes allowed) or CLOSING tag (attributes are
 *  NOT part of a closing tag in CommonMark — `</span a="b">` is a paragraph,
 *  and treating it as html flow made the scanner apply a close parse5 never
 *  sees: `<span>\n\n</span a="b">\n\ntail` froze past a still-open span
 *  (oracle re-check of the r2 batch). Type 6 is unaffected — its names are
 *  recognized on `</name` + whitespace regardless of what follows.) */
const TYPE7_LINE_RE = /^(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t\r][^>]*|\/)?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t\r]*>)[ \t\r]*$/;
/** The tag name of a TYPE7_LINE_RE match (the line starts `<` or `</`). */
const t7Name = (line: string): string => /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(line)![1];

export interface FreezeBoundaryOptions {
  /** Whether remark-definition-list is in the active plugin chain (the
   *  `enginePlugins` selection includes `definitionList`). Enables blockers 3b/4. */
  defListEnabled: boolean;
  /**
   * Whether `$$` flow math is in the grammar (remark-math). Default `true`
   * (the engine's own profile). The def-label scanner runs a PINNED
   * remark-parse+gfm subset where `$$` is ordinary paragraph text — under
   * that grammar the math branch is a MASKING hole: `inMath` returns early
   * without comment/fence scanning, so `$$\n<!--\n$$` reads as a closed
   * math block here while the subset grammar sees an OPEN type-2 HTML
   * comment running to `-->`/EOF (a candidate after it would let a
   * standalone tail parse invent ghost defs). With `false`, `$$` lines take
   * the ordinary text path and comments/fences inside are scanned.
   */
  mathFlow?: boolean;
  /**
   * Whether blocker 5 (reference taint) applies. Default `true`: the
   * engine must reject candidates past an unresolved `[label]` because a
   * later definition retargets the reference's PARSE. The def-label
   * scanner only extracts definition IDENTITIES — a pure block-level fact
   * unaffected by how inline references resolve — and under taint a
   * streaming citation footer (defs with no settling blank line yet)
   * collapses the boundary to the body's first reference, zeroing the
   * caching this profile exists for. `false` skips ref tracking entirely.
   */
  referenceTaint?: boolean;
}

export interface FreezeScanResult {
  /** Largest freeze-safe boundary, or 0 when nothing can be frozen. */
  boundary: number;
  /** Opaque resume state — pass back on the next APPEND-ONLY call to skip
   *  re-lexing the confirmed prefix. Single-consumer; see module docs. */
  checkpoint: FreezeScanCheckpoint;
}

interface LineRec {
  start: number;
  end: number; // offset of the terminating \n, or text.length for the last line
  text: string; // line content WITHOUT the line ending (a CRLF's `\r` is stripped too)
  blank: boolean;
  indent: number; // leading whitespace width, tab = 4 (approximation)
}

interface Candidate {
  /** Freeze boundary: start of the line after this blank line. */
  offset: number;
  /** Consecutive confirmed blank lines (outside fences/math) ending here. */
  blankRun: number;
  /** No unbalanced HTML container / comment / raw block before this point. */
  htmlBalanced: boolean;
  /** Rolling continuation-hazard verdict at emission (blocker 3). */
  hazard: boolean;
  /** Blocker-6: the run ending at this blank left balanced FLOATING raw
   *  remnant whose hast seam is tail-dependent; reject this candidate. */
  seamRisk: boolean;
  /** Blocker-4 settle verdict, decided by the NEXT confirmed line (`null`
   *  while that line hasn't confirmed — only the newest candidate can be
   *  pending). Storing the verdict instead of the line lets the checkpoint
   *  drop its lines array, which retained a full copy of the document
   *  (round-2 review: ~2-3× doc size per mounted instance). */
  defListSettled: boolean | null;
}

/** micromark's open VERBATIM flow construct at a line boundary (two-model
 *  P4a, first slice): fenced code and `$$` flow math — the members whose
 *  interiors are candidate-free and whose close is a marker line. The
 *  html-block types join this union in the next slice. `indent` is the
 *  opener line's indent (0-3): only a column-0 opener is provably
 *  top-level, so `pendingFenceCloser` suppresses the closer otherwise
 *  (v2.4.0 review R1). Members are REPLACED, never mutated (see P5Tok). */
type MdBlock =
  | { kind: 'none' }
  | { kind: 'fence'; char: string; len: number; indent: number }
  | { kind: 'math'; len: number; indent: number }
  /** A CommonMark html block. Types 1-5 end by their own condition
   *  (type 1: the literal closer line; 2-5: their terminators); types 6/7
   *  end at the blank. Type 7 is entered by the APPROXIMATE
   *  `TYPE7_LINE_RE` on purpose — exact §4.6 type 7 is cut from the plan,
   *  and an exact test here would raise the boundary, which the stage
   *  acceptances forbid; the run flags stay as deliberate conservative
   *  cover until their consumers migrate one by one. */
  | { kind: 'html'; type: 1 | 2 | 3 | 4 | 5 | 6 | 7 };

const mdHtml = (b: MdBlock, type: 1 | 2 | 3 | 4 | 5): boolean => b.kind === 'html' && b.type === type;
/** Types 2-5 open: the interiors both grammars agree are raw content. */
const mdHtml25 = (b: MdBlock): boolean => b.kind === 'html' && b.type >= 2 && b.type <= 5;

/** parse5 tokenizer macro-state at a LINE BOUNDARY (two-model P3a, T3.1).
 *  A PARTITION of {data, rawText, script, bogus} — measured before the
 *  design was frozen: the within-tag attribute position co-exists with any
 *  of these (`<iframe>\n</iframe a="`), so it is the separate `pendingTag`
 *  overlay, NOT a member. `openedInline` is captured AT OPEN (the old
 *  `rawTextInline` latch — `htmlFlowReal` is reset before the poison that
 *  reads it, so a live read would lose the poison). Members are REPLACED,
 *  never mutated: checkpoints are shared mutable state, and a module-level
 *  token constant would alias across mounted documents. */
type P5Tok =
  | { kind: 'data' }
  /** RAWTEXT / RCDATA content: everything is text until `</element`. */
  | { kind: 'rawText'; element: string; openedInline: boolean }
  /** SCRIPT_DATA, with the `<!--` escape flag. Double-escape is NOT
   *  modelled — a nested `<script` poisons instead (blocker 7 / F6); its
   *  retirement belongs to stage P3b. */
  | { kind: 'script'; escaped: boolean; openedInline: boolean }
  /** COMMENT state: `<!--` seen, closes at `-->` — or at `--!>`, which
   *  micromark does NOT accept; that split is why this is a separate
   *  field from `mdBlock` html{2} (P4b-completion, commit 1). Until the
   *  divergence actually opens, the two agree everywhere; where it opens,
   *  the relation poison has already fired. */
  | { kind: 'comment' }
  /** Bogus comment: eaten to the next `>`. */
  | { kind: 'bogus' };

/** "Comment content" for the tag walk's markup decision — the union of the
 *  two grammars' comment states, so bytes are skipped as comment interior
 *  if EITHER grammar is still inside one (the divergence between them is
 *  poisoned at the point it opens; neither field alone may release the
 *  other's block). */
const commentEitherOpen = (md: MdBlock, p5: P5Tok): boolean => mdHtml(md, 2) || p5.kind === 'comment';

/** The raw-text MASK predicate: while it holds, `applyTag` admits only the
 *  element's own end tag, so nothing reaches the balance — a raw-text state
 *  the model believes in but parse5 is not in makes candidates MORE likely
 *  to survive (the unsafe direction). BOTH kinds mask; every read site goes
 *  through this one predicate so no rewrite can drop the script kind. */
const inRawTextTok = (t: P5Tok): t is Extract<P5Tok, { kind: 'rawText' | 'script' }> =>
  t.kind === 'rawText' || t.kind === 'script';
/** The open raw-text element's name, or null when none is open. */
const rawTextElement = (t: P5Tok): string | null =>
  t.kind === 'rawText' ? t.element : t.kind === 'script' ? 'script' : null;

/** Opaque resume token. Produced by one `computeFreezeBoundary` call and
 *  passed back on the next APPEND-ONLY call; the only supported operations
 *  are storing it and passing it back. The field set is an implementation
 *  detail of the scanner and changes between minor versions — the brand key
 *  (a structural string literal, safe across dual d.ts entries) is all that
 *  ships in the public type. */
export interface FreezeScanCheckpoint {
  readonly '~freezeScanCheckpoint'?: never;
}

/** Mutable resume state — the real shape behind `FreezeScanCheckpoint`.
 *  Intra-package only (the scanner and its tests); not reachable from the
 *  public entry, so the shape stays out of `dist/index.d.ts`. All fields
 *  describe the scan strictly BEFORE the first unconfirmed character
 *  (`confirmedOffset`). */
export interface FreezeScanCheckpointInternal extends FreezeScanCheckpoint {
  defListEnabled: boolean;
  /** Grammar-profile switches baked at creation — a checkpoint is only
   *  resumable under the exact profile that built it. */
  mathFlow: boolean;
  referenceTaint: boolean;
  /** Start offset of the first line NOT yet baked into this checkpoint. */
  confirmedOffset: number;
  candidates: Candidate[];
  defs: Map<string, number>; // normalized label → def line end offset
  footnoteDefs: Map<string, number>;
  unresolvedRefs: UnresolvedRef[];
  tagBalance: Map<string, number>;
  openTotal: number;
  /** parse5's tokenizer macro-state (see `P5Tok`). Bogus comment (`<!` not
   *  followed by `--` / letter / `[CDATA[`, or `</` not followed by a
   *  letter — eaten up to the next `>`; micromark has no such construct),
   *  raw-text content, script data with its escape flag. */
  p5Tok: P5Tok;
  /** micromark's open verbatim flow construct (see `MdBlock`). */
  mdBlock: MdBlock;
  blankRun: number;
  lastBlankStart: number;
  /** Rolling blocker-3 verdict ("nearest decisive block start so far"). */
  hazardVerdict: boolean;
  /** Previous confirmed line was blank (block-start detection). */
  prevLineBlank: boolean;
  /** Previous confirmed line was a plain text line (def-chain detection). */
  prevLineWasText: boolean;
  /** Previous confirmed line registered a VALID definition (def chains). */
  prevLineWasValidDef: boolean;
  /** An earlier line of the current paragraph left an unpaired backtick
   *  run — masking is disabled until the paragraph ends (safety gate). */
  /** A `[` left unclosed at the end of a paragraph line (code spans
   *  masked). micromark lets a reference label span soft line breaks, so
   *  the label may close on a LATER line where the per-line REF_RE never
   *  sees a `[…]` pair (v2.4.1 review P1: `see [foo\nbar] end` + a late
   *  `[foo bar]: /u` retargeted frozen output). Cleared wherever the
   *  paragraph ends. */
  openBracket: { offset: number; text: string } | null;
  paragraphHasUnpairedRun: boolean;
  /** Blocker-6 pending flag: a confirmed html-flow line left balanced
   *  floating raw remnant, and no later content line has pinned the seam
   *  yet. Persists across blank lines (every candidate emitted while set
   *  has the remnant as its last frozen child); cleared by the next
   *  non-blank line that starts OUTSIDE an html-flow run. */
  /* ^ P-seal, explicitly (two-model T3.2): of the four (P) conditions this
   *   is the genuinely retroactive one — the last root-level node the
   *   frozen prefix contributed can still be EXTENDED by later bytes
   *   (parse5's insertText appends to an existing trailing text node). */
  p5SealPending: boolean;
  /** A line since the last blank started with `<` at block indent — an html
   *  FLOW block is (approximately) running, and it only ends at a blank
   *  line. micromark does no inline parsing there: backtick runs are
   *  literal text, so code-span masking would hide REAL tags from the
   *  balance scan (under-block — fuzz counterexample: `</details>` followed
   *  by an unblanked `` `<div>` `` line). While set, masking is skipped —
   *  which can only over-block (safe direction). */
  /* ^ Renamed from `htmlFlowSinceBlank` (P4b-completion, commit 3): this
   *   is a DELIBERATE (M)-side conservative flag, not a proxy awaiting an
   *   exact answer. It over-fires on purpose — `mdBlock`'s type-7 member
   *   is entered by the approximate TYPE7_LINE_RE (exact §4.6 type 7 is
   *   cut), so a `<span title="a>b">` line is a type-7 block the member
   *   never sees, and this flag is what keeps its consumers safe there.
   *   It dies only if exact type 7 ever ships. */
  mayBeRawToMicromark: boolean;
  /** Offset of the first fence/math OPEN suppressed by `mayBeRawToMicromark`
   *  (Infinity = none). Whether the run really swallowed that line depends
   *  on container context the line scan cannot see (`<embed` inside a list
   *  item is a lazy paragraph line, and the glued `$$` a REAL math open —
   *  seed-20260757 under-block: the tracker's fence phase INVERTS from that
   *  line on, every later close reads as an open, and the corruption never
   *  resyncs). Candidates past this offset are rejected outright — sticky,
   *  pure over-block; candidates before it are untouched (the ambiguous
   *  region then re-parses inside the tail). The rolling hazard poison for
   *  ambiguous tag names stays, but it decays at the next decisive block
   *  start — this field is the phase-corruption backstop that does not. */
  phasePoisonedAt: number;
  /** Tag names of line-truncated opens (`<div` at EOL) counted into
   *  tagBalance but not yet confirmed by a later `>` — reverted at the next
   *  blank line (a tag cannot span one). See TRUNCATED_TAG_RE. */
  pendingTruncatedTags: string[];
  /** Line-truncated CLOSING tags (`</div` + EOL, no `>`) inside an html-flow
   *  run, waiting for a `>` on a later line of the same run. Unlike opens
   *  they are NOT counted up front: a close tag cannot carry attributes, so
   *  `para </style` (prose to micromark, still-open element to parse5 —
   *  RAWTEXT waits for the `>`) must not zero the balance (2026-08-19
   *  review P1 — the boundary crossed an open `<style>`). Confirmed and
   *  applied only when a later line of the run brings the `>` (parse5
   *  completes the end tag; micromark's block ends at the blank anyway);
   *  dropped unapplied at the blank (element stays counted — over-block).
   *  Paragraph-context truncated closes are never pended: a `>` at block
   *  indent on the next line is a blockquote to micromark, and the one
   *  shape that would complete the inline close (`</b\n    >`, a 4+-space
   *  lazy continuation) is not modelled — the element stays counted,
   *  over-block. */
  pendingTruncatedCloses: string[];
  /** An html-flow line ended inside a tag (`<div`, `</div`, `<br` — open,
   *  close or void, with or without attributes): parse5's tokenizer is
   *  still in that tag, so on the following lines everything up to the
   *  FIRST `>` is attribute garbage — `</div>` there does NOT close
   *  anything (oracle review of 2.4.4: `<div>\n<div>\n</div\n</div>` froze
   *  past the still-open outer div; pre-existing, 1-char slices). While
   *  set: a line without `>` gets no tag scan at all; the line with the
   *  `>` completes the pending close (if any), then only its text after
   *  that `>` is scanned. Cleared there and at the blank line. */
  pendingTag: {
    /** parse5's position inside the tag's attribute area at the end of the
     *  last scanned line (see TagAttrState). A quoted value left open
     *  swallows `>` and line endings; a `>` while `outside` ends the tag. */
    attr: TagAttrState;
    /** Indent of the line that entered the tag. A following line that
     *  DE-INDENTS below it may have left the container (a list item's html
     *  block ends there; hast-util-raw resets the tokenizer at the li/ul
     *  boundary, so a `<div>` on that line is a real start tag, not
     *  garbage) — or may still be the same html block (root-level
     *  `  </div\n</div>`, still garbage). Unknowable here → poison. */
    indent: number;
  } | null;
  /** The html-flow run since the last blank REALLY started as a micromark
   *  html block (type 6 / type 1 / a paragraph-not-interrupting type 7) —
   *  as opposed to `mayBeRawToMicromark`, which any `<tag` / `</tag` line
   *  start sets (over-approximation, fine for its over-blocking uses). Only
   *  in a real run are the bytes raw to parse5 across line endings; the
   *  cross-line-tag garbage model (`pendingTag`, pended closes) is
   *  gated on it — in a paragraph starting `</i` the next line's `<div>` /
   *  `<!--` are REAL blocks (oracle re-check of 2.4.4: gating on
   *  mayBeRawToMicromark swallowed them — a new under-block). Sticky to the
   *  blank; a type 6/1 start on a later line of a non-real run promotes it. */
  htmlFlowReal: boolean;
  /** The open-element stack, in order. `tagBalance` and `openTotal` are
   *  derived views kept in step with it, but the STACK is the truth: an end
   *  tag's effect depends on what sits BETWEEN it and its match, which a
   *  name→count bag cannot represent (see SCOPE_BARRIER_NAMES). */
  openStack: string[];
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** CommonMark list markers at block indent (bullet or ordered), incl. bare `-`. */
const LIST_MARKER_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** Definition-list description marker (micromark-extension-definition-list). */
const DEF_LIST_DD_RE = /^ {0,3}:[ \t]/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** Leading dollar RUN at block indent — math flow fences carry a LENGTH
 *  like code fences (`$$$$` opens a fence only ≥4 dollars can close;
 *  K=4 census counterexample), and the meta after the run may not contain
 *  `$` (a rest with any `$` is inline math / literal text, NOT a flow
 *  open). */
const MATH_RUN_RE = /^ {0,3}(\$\$+)/;
/** Opening/closing tags (name must be followed by attr/close syntax, which
 *  excludes autolinks like `<https://…>`), plus comment delimiters. */
const TAG_OR_COMMENT_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])([^>]*)>|<!--|-->|--!>/g;
// Empty comments whose closer OVERLAPS the opener (`<!-->`, `<!--->`):
// CommonMark 0.31 (html flow AND text) and parse5 all close them on the
// spot. A `<!--` match followed by `>`/`->` must not open a comment — the
// scan would then skip REAL markup up to the next stray `-->` (2026-08
// project-review P1: `<!-->\n<details>\n-->` froze past a parse5-open
// `<details>`, the v1.5.1 swallow class). Handled inline in the token
// scan and in `floatingResidue`, which share the state machine.
/** A tag START whose `>` has not arrived on this line — `<div` at EOL, or
 *  `<div class="a"` with attributes continuing on the next line. Counted as
 *  an open (probe-confirmed hazard) and remembered as PENDING: a tag can
 *  carry attributes across line endings but never across a blank line, so
 *  a pending open that reaches the paragraph's blank line without a `>`
 *  was prose (`if x<y then`) and its phantom open is reverted there. Any
 *  later `>` before that confirms it (kept open — over-block at worst).
 *  Without the revert the phantom open lived forever and the whole rest of
 *  the stream lost the splice, not just that paragraph (2026-08 project
 *  review, eng-parse-06). */
const TRUNCATED_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)([^>]*)$/;
/** Anchor for the truncated-tag check: the LAST `<` that starts a tag name
 *  (`<x` / `</x`). Anchoring on the last `<` of any kind missed `<div a=<`
 *  (attribute bytes may hold `<`; parse5 keeps the div open) — oracle
 *  re-check of r2, pre-existing. */
const TAG_START_LT_RE = /<\/?[A-Za-z]/g;
/** parse5 tokenizer position inside a tag's attribute area, tracked across
 *  line endings for `pendingTag` (2026-08-19 review r2 P1-2 / P2-3):
 *  `outside` = before/in an attribute name (a `"` here starts a NAME, not a
 *  value); `afterEq` = just past `=`; `unquoted` = in an unquoted value
 *  (whitespace ends it); `"` / `'` = inside a quoted value — `>` and line
 *  endings are value bytes there, only the matching quote leaves it. */
type TagAttrState = 'outside' | 'afterEq' | 'unquoted' | '"' | "'";
/** Advance the attribute-area state over `text[from, to)`; returns the
 *  index of the `>` that ENDS the tag, or -1 with the state carried in
 *  `out.state`. */
function scanTagAttrs(text: string, from: number, to: number, out: { state: TagAttrState }): number {
  let st = out.state;
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (st === '"' || st === "'") {
      if (c === st) st = 'outside';
      continue;
    }
    const ws = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
    if (st === 'afterEq') {
      if (ws) continue;
      if (c === '"' || c === "'") st = c;
      else if (c === '>') return i;
      else st = 'unquoted';
      continue;
    }
    if (st === 'unquoted') {
      if (ws) st = 'outside';
      else if (c === '>') return i;
      continue;
    }
    // outside
    if (c === '=') st = 'afterEq';
    else if (c === '>') return i;
  }
  out.state = st;
  return -1;
}
const BACKTICK_RUN_RE = /`+/g;

function computeIndent(text: string): number {
  let indent = 0;
  for (const ch of text) {
    if (ch === ' ') indent += 1;
    else if (ch === '\t') indent += 4 - (indent % 4);
    else break;
  }
  return indent;
}

/**
 * Blocker 4: can the (possibly partial) line ever match `^ {0,3}:[ \t]`
 * after future appends? Appends only extend the line rightward, so a line
 * is settled once its existing characters already contradict the pattern.
 */
function canBecomeDdLine(text: string, confirmed: boolean): boolean {
  let i = 0;
  while (i < text.length && text[i] === ' ') i += 1;
  if (i > 3) return false; // indent too deep, regardless of future appends
  if (i === text.length) return !confirmed; // only spaces so far — a partial line may still grow a `:`
  if (text[i] !== ':') return false;
  if (i + 1 === text.length) return !confirmed; // trailing `:` — a partial line may still grow the space
  return text[i + 1] === ' ' || text[i + 1] === '\t';
}

/**
 * Same-line code-span masking (module docs). Returns the masked text, or
 * null when masking is unsafe for this line (an unpaired run here or
 * earlier in the paragraph). Masked spans are replaced by spaces of equal
 * length so every offset stays valid.
 */
function maskIntraLineCodeSpans(text: string, carryOpen: boolean): { masked: string | null; unpaired: boolean } {
  BACKTICK_RUN_RE.lastIndex = 0;
  const runs: Array<{ index: number; length: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = BACKTICK_RUN_RE.exec(text)) !== null) runs.push({ index: m.index, length: m[0].length });
  if (runs.length === 0) return { masked: carryOpen ? null : text, unpaired: false };
  // Pair equal-length runs leftmost-first (micromark's rule, same line).
  const spans: Array<[number, number]> = [];
  let unpaired = false;
  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    let matched = -1;
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[j].length === opener.length) {
        matched = j;
        break;
      }
    }
    if (matched === -1) {
      unpaired = true;
      continue;
    }
    spans.push([opener.index, runs[matched].index + runs[matched].length]);
    i = matched; // consume through the closer
  }
  if (carryOpen || unpaired) return { masked: null, unpaired };
  if (spans.length === 0) return { masked: text, unpaired: false };
  let out = '';
  let cursor = 0;
  for (const [from, to] of spans) {
    out += text.slice(cursor, from) + ' '.repeat(to - from);
    cursor = to;
  }
  out += text.slice(cursor);
  return { masked: out, unpaired: false };
}

function freshCheckpoint(
  defListEnabled: boolean,
  mathFlow: boolean,
  referenceTaint: boolean
): FreezeScanCheckpointInternal {
  return {
    defListEnabled,
    mathFlow,
    referenceTaint,
    confirmedOffset: 0,
    candidates: [],
    defs: new Map(),
    footnoteDefs: new Map(),
    unresolvedRefs: [],
    tagBalance: new Map(),
    openTotal: 0,
    p5Tok: { kind: 'data' },
    openStack: [],
    mdBlock: { kind: 'none' },
    blankRun: 0,
    lastBlankStart: -1,
    hazardVerdict: false,
    prevLineBlank: true, // doc start counts as a block start
    prevLineWasText: false,
    prevLineWasValidDef: false,
    paragraphHasUnpairedRun: false,
    openBracket: null,
    mayBeRawToMicromark: false,
    p5SealPending: false,
    phasePoisonedAt: Infinity,
    pendingTruncatedTags: [],
    pendingTruncatedCloses: [],
    pendingTag: null,
    htmlFlowReal: false,
  };
}

/** Blocker-3 classification of a block-START line (raw text; markers are
 *  never inside code spans at block indent). Returns the new rolling
 *  verdict, or null when the line is ambiguous (verdict unchanged). */
function classifyBlockStart(text: string, indent: number, defListEnabled: boolean): boolean | null {
  if (indent >= 4) return true; // indented code / item continuation merges across blanks (A1)
  if (LIST_MARKER_RE.test(text) || FOOTNOTE_DEF_RE.test(text)) return true;
  if (defListEnabled && DEF_LIST_DD_RE.test(text)) return true;
  if (indent === 0) return false; // column-0 non-marker block terminates any list context
  return null; // indent 1–3 non-marker: ambiguous
}

export function computeFreezeBoundary(
  text: string,
  options: FreezeBoundaryOptions,
  resume?: FreezeScanCheckpoint | null
): FreezeScanResult {
  const mathFlow = options.mathFlow ?? true;
  const referenceTaint = options.referenceTaint ?? true;
  const prev = resume as FreezeScanCheckpointInternal | null | undefined;
  // A checkpoint encodes profile-dependent state (math phase, ref taint
  // tables) — resuming under a DIFFERENT profile would mix grammars, so
  // every switch participates in the invalidation check.
  const cp =
    prev &&
    prev.defListEnabled === options.defListEnabled &&
    prev.mathFlow === mathFlow &&
    prev.referenceTaint === referenceTaint &&
    prev.confirmedOffset <= text.length
      ? prev
      : freshCheckpoint(options.defListEnabled, mathFlow, referenceTaint);

  // ── advance the checkpoint over newly-CONFIRMED lines ──
  let start = cp.confirmedOffset;
  let tailLine: LineRec | null = null;
  while (start < text.length) {
    // Line endings are what micromark counts: `\n`, `\r\n` and a LONE `\r`
    // (2026-08-19 review r2 P1-5: splitting on `\n` only hid the fence /
    // math OPENER after `a\r` inside one scanner line, and a candidate
    // landed inside the open block). `end` is the LAST byte of the ending
    // (the `\n` of a CRLF), so `end + 1` is the next line start as before;
    // `lineText` excludes the ending. A lone `\r` as the very last byte is
    // NOT confirmed: the `\n` that may follow belongs to the same ending.
    let end = text.length;
    let textEnd = text.length;
    {
      const nl = text.indexOf('\n', start);
      const cr = text.indexOf('\r', start);
      if (cr !== -1 && (nl === -1 || cr < nl)) {
        textEnd = cr;
        end = text.charCodeAt(cr + 1) === 10 ? cr + 1 : cr;
      } else if (nl !== -1) {
        textEnd = nl;
        end = nl;
      }
    }
    const confirmed = end < text.length && !(end === text.length - 1 && text.charCodeAt(end) === 13);
    const lineText = text.slice(start, textEnd);
    const ln: LineRec = {
      start,
      end,
      text: lineText,
      blank: confirmed && isMdBlank(lineText),
      indent: computeIndent(lineText),
    };
    if (!confirmed) {
      // The partial line is never baked into the checkpoint: it emits no
      // candidates, and its tag/ref effects cannot reach candidates that
      // all precede it.
      tailLine = ln;
      break;
    }

    processConfirmedLine(cp, ln, text);
    cp.confirmedOffset = end + 1;
    start = end + 1;
  }

  // ── settle references (blocker 5 — referenceTaint.ts) ──
  const earliestUnresolved = settleRefsAndEarliestUnresolved(cp);

  // ── blocker 4: defList settled check (decided by the NEXT line) ──
  const defListSettled = (c: Candidate): boolean => {
    if (!options.defListEnabled || c.blankRun >= 2) return true;
    // Confirmed next lines settle candidates eagerly in processConfirmedLine;
    // only the newest candidate can still be pending here.
    if (c.defListSettled !== null) return c.defListSettled;
    if (tailLine) return !canBecomeDdLine(tailLine.text, false);
    return false; // no next line yet — a future `: desc` could still claim the block above
  };

  // ── pick the last surviving candidate ──
  // A retroactive construct on the UNCONFIRMED tail line suppresses every
  // candidate for this frame (see tailCarriesRetroactive). Checked here and
  // not in the scan so nothing about the partial line is ever baked in.
  const tailRetroactive = tailLine !== null && tailCarriesRetroactive(tailLine.text);
  let boundary = 0;
  for (let i = cp.candidates.length - 1; i >= 0 && !tailRetroactive; i--) {
    const c = cp.candidates[i];
    if (!c.htmlBalanced || c.hazard || c.seamRisk) continue;
    // Fence/math phase untrusted past a suppressed open (phasePoisonedAt
    // docs) — a boundary AT the poisoned line start is still safe: the
    // whole ambiguous region lands in the tail re-parse.
    if (c.offset > cp.phasePoisonedAt) continue;
    if (c.offset > earliestUnresolved) continue;
    if (!defListSettled(c)) continue;
    boundary = c.offset;
    break;
  }

  return { boundary, checkpoint: cp };
}

/**
 * The closing line that would end the fence / flow-math block still open at
 * the checkpoint, or `''` when nothing provably closable is open. The whole
 * decision is scanner-domain, so it lives here rather than in the consumer:
 * a poisoned fence/math phase (blocker 7) means the "open" flags cannot be
 * trusted and a wrong closer would OPEN a block, and only a column-0 opener
 * is provably top-level (`openIndent` docs). `phantomSuffixCloser` prepends
 * its own newline handling; the returned text is the bare closer run.
 */
export function pendingFenceCloser(checkpoint: FreezeScanCheckpoint): string {
  const cp = checkpoint as FreezeScanCheckpointInternal;
  if (cp.phasePoisonedAt !== Infinity) return '';
  if (cp.mdBlock.kind === 'fence' && cp.mdBlock.indent === 0) return cp.mdBlock.char.repeat(cp.mdBlock.len);
  if (cp.mdBlock.kind === 'math' && cp.mdBlock.indent === 0) return '$'.repeat(cp.mdBlock.len);
  return '';
}

/**
 * Blocker-6 residue: the bytes of a line that are neither tags nor comment
 * tokens/content — floating raw text — computed with the SAME comment state
 * machine as the balance scan (`commentOpenAtStart` carried in from the
 * previous line; `<!-->`/`<!--->` close on the spot whether or not a comment
 * is open; `--!>` never closes for CommonMark; a stray `-->` outside a
 * comment is text). Raw-construct bytes must already be masked by the caller.
 */
function floatingResidue(text: string, commentOpenAtStart: boolean): string {
  let out = '';
  let open = commentOpenAtStart;
  let last = 0; // start of the not-yet-emitted text run
  TAG_OR_COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_OR_COMMENT_RE.exec(text)) !== null) {
    if (m[0] === '<!--') {
      const next = text.slice(m.index + 4, m.index + 6);
      const overlapLen = next.startsWith('>') ? 5 : next === '->' ? 6 : 0;
      if (open) {
        if (overlapLen) {
          open = false;
          last = m.index + overlapLen;
          TAG_OR_COMMENT_RE.lastIndex = last;
        }
        continue;
      }
      out += text.slice(last, m.index);
      if (overlapLen) {
        last = m.index + overlapLen;
        TAG_OR_COMMENT_RE.lastIndex = last;
        continue;
      }
      open = true; // content until `-->` is dropped
      continue;
    }
    if (m[0] === '-->') {
      if (open) {
        open = false;
        last = m.index + 3;
      }
      continue; // stray `-->` stays in the text run
    }
    if (m[0] === '--!>') continue; // content (open) or text (closed) either way
    if (open) continue;
    out += text.slice(last, m.index); // a tag: emit the text before it, drop the tag
    last = m.index + m[0].length;
  }
  if (!open) out += text.slice(last);
  return out;
}

/** Bake one confirmed line into the checkpoint. */
function processConfirmedLine(cp: FreezeScanCheckpointInternal, ln: LineRec, text: string): void {
  // Blocker-4 eager settle: this line is the "next confirmed line" of the
  // newest candidate. The verdict uses the RAW line exactly like the old
  // lines-array lookback did (fence/math state deliberately not consulted).
  const newest = cp.candidates[cp.candidates.length - 1];
  if (newest && newest.defListSettled === null) {
    newest.defListSettled = ln.blank ? true : !canBecomeDdLine(ln.text, true);
  }
  const isBlockStart = cp.prevLineBlank;
  // Blocker-6 seam release: a confirmed non-blank line that starts OUTSIDE
  // any html-flow run AND emits a top-level hast node at its own position is
  // real content that will sit between the remnant and whatever streams in
  // later — the seam is pinned from the frozen side. Lines that emit NOTHING
  // there must NOT release: link/footnote definition lines produce no hast
  // node (def-SHAPED but invalid lines do emit a paragraph — not releasing
  // on them only over-blocks), and comment-only lines produce at most a
  // comment node whose seam-pinning power is unverified. (Lines INSIDE the
  // run keep the flag; the run's own blank keeps it so every candidate in
  // the trailing blank run stays rejected.)
  if (
    cp.p5SealPending &&
    !ln.blank &&
    !cp.mayBeRawToMicromark &&
    !(mdHtml25(cp.mdBlock) || cp.p5Tok.kind === 'comment' || cp.p5Tok.kind === 'bogus')
  ) {
    const defShapedLine = DEF_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text);
    const commentOnly =
      ln.text
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<!--[\s\S]*$/, ' ')
        .replace(/[ \t\r]/g, '') === '';
    if (!defShapedLine && !commentOnly) {
      cp.p5SealPending = false;
    }
  }
  /** Post-collapse (T3.4) this deliberately OVER-claims: parse5 pops the
   *  foreign root on a breakout tag, and no pop is modelled any more — the
   *  bag says "foreign" until the root's own end tag. Both consumers point
   *  the over-claim the safe way (self-closing tags stay counted; raw-text
   *  switches poison). */
  // T3.3 direction contract: every `tagBalance` read goes through a wrapper
  // whose NAME carries the safe direction of doubt. This one may OVER-claim
  // (saying "foreign" when parse5 left it keeps self-closing tags counted —
  // over-blocking); the table one below must UNDER-claim.
  const possiblyInsideForeign = (): boolean => FOREIGN_ROOT_NAMES.some((name) => (cp.tagBalance.get(name) ?? 0) > 0);
  /** A self-closing tag parse5 really closes on the spot. Post-collapse
   *  (two-model T3.4): ONLY the foreign roots themselves — foreign
   *  elements honour the flag in any context. Every other self-closing
   *  tag is counted OPEN: being exact needed the breakout and
   *  integration-point enumerations whose mis-claims were the F1/F2/F5
   *  family, and counting keeps `openTotal` at or above parse5's stack
   *  depth — the over-blocking side. The measured cost is that well-formed
   *  self-closed children (`<svg><circle/></svg>`) stay counted past the
   *  `</svg>` (its scope walk removes only the svg), which blocks freezing
   *  for the rest of the document — reported with the stage's diff. */
  const honoursSelfClosing = (tag: string): boolean => tag === 'svg' || tag === 'math';
  /** T3.3b, the third wrapper direction: whether the tokenizer SWITCHES
   *  for a raw-text element start tag near foreign content is unknowable
   *  to a name-count bag. OVER-claiming the switch opens the raw-text mask
   *  parse5 is not in — the mask suppresses the tag scan, so candidates
   *  get MORE likely to survive and the boundary RISES (measured:
   *  `<svg><title><div></title></svg>` is safe today only because the
   *  un-switched `<div>` sits on the open stack). UNDER-claiming keeps the
   *  mask shut where parse5 opens it — F2, the shipped under-block.
   *  Neither direction is safe, so the honest answer is a poison. */
  const foreignRawTextSwitchUnknowable = (): boolean => possiblyInsideForeign();
  const applyTag = (tag: string, closing: boolean): void => {
    // Inside a raw-text element only its own end tag is markup.
    if (inRawTextTok(cp.p5Tok)) {
      // "Script data double escaped": inside an escaped `<script>` a nested
      // `<script` start tag makes parse5 stop honouring `</script>` — the
      // first one only steps back to escaped, and the element runs on.
      // CommonMark has no such notion: a type-1 block ends at the first line
      // holding the literal closer. So the two grammars disagree about which
      // BYTES are raw, and no amount of extra modelling reconciles them —
      // the scanner would have to pick one and be wrong under the other.
      // That is exactly blocker 7's case, so it poisons (2026-08-21 soak
      // leg 1, seven of twelve shards; `<script>\n<!--<script>\n</script>\n
      // </script>` followed by a `$$` block).
      if (cp.p5Tok.kind === 'script' && cp.p5Tok.escaped && !closing && tag === 'script') {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
      if (!(closing && tag === rawTextElement(cp.p5Tok))) return;
      cp.p5Tok = { kind: 'data' };
    } else {
      if (!closing && RAW_TEXT_ELEMENTS.has(tag) && foreignRawTextSwitchUnknowable()) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      } else if (!closing && RAW_TEXT_ELEMENTS.has(tag)) {
        // Migration collision rule (P3a): entering raw text while another
        // non-data state is live would silently drop that state's blocking
        // effect — poison instead, which can only lower the boundary.
        if (cp.p5Tok.kind !== 'data') cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
        // openedInline: paragraph context, i.e. micromark html-TEXT rather
        // than an html block — the regime where a lifted element rewrites
        // its paragraph. Captured HERE (latched: the run state is reset
        // before the blank-line poison that reads this). Migration A row
        // 1: the member answers "block context" — NARROWER than the old
        // flag by the in-comment promotion artifact, and inert there: a
        // paragraph-inline 3-5 opener poisons document-wide, and tags
        // inside a comment never reach applyTag at all.
        const openedInline = cp.mdBlock.kind !== 'html';
        cp.p5Tok =
          tag === 'script'
            ? { kind: 'script', escaped: false, openedInline }
            : { kind: 'rawText', element: tag, openedInline };
        // PLAINTEXT never ends (`</plaintext>` is text too): nothing after
        // it can be modelled — poison from here on.
        if (tag === 'plaintext') cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
    }
    // Retroactive construct (see DOCUMENT_STRUCTURE_NAMES): parse5 erases
    // the tag and merges the text around it, changing hast BEFORE this
    // point. Poison from offset 0 — nothing in the document is freeze-safe
    // once one of these is confirmed, and the poison is monotone so it
    // stays that way. Sits past the raw-text guard on purpose: a `<body>`
    // inside `<script>` is text to parse5 too, and must not poison.
    if (DOCUMENT_STRUCTURE_NAMES.has(tag)) cp.phasePoisonedAt = 0;
    // `<template>` is the second kind of erasure. Its children go into a
    // content FRAGMENT (`hast-util-from-parse5` hangs them off `.content`,
    // not `.children`), and the sanitize pass then drops the element — so a
    // template block vanishes whole, children and all, and the text around
    // it merges. Inside a container the damage is worse: the direction
    // battery measured a list item swallowing the rest of the document
    // (`- a\n<template>\n<div>x</div>\n</template>` + blank + prose — the
    // later paragraphs land INSIDE the li, and a one-character append
    // rewrites the frozen region via lazy continuation; blockquote form
    // identical; 2026-08-24, scaled soak leg 2). The top-level form measured
    // stable, but "measured harmless" has been refuted three times this
    // week, and erasure merges reach backward (the F9 lesson) — so the
    // poison is document-wide, same as the names above. An earlier sweep
    // recorded template as "swept clean"; that sweep sampled shapes with
    // blank lines around the block, which is exactly the layout where the
    // merge stays invisible.
    if (tag === 'template' && !closing) cp.phasePoisonedAt = 0;
    if (closing) {
      // Walk down for the match, stopping at a scope barrier. No match in
      // scope means parse5 DISCARDS this end tag and the element stays open —
      // so the counts must not move either.
      let idx = -1;
      for (let i = cp.openStack.length - 1; i >= 0; i--) {
        if (cp.openStack[i] === tag) {
          idx = i;
          break;
        }
        if (SCOPE_BARRIER_NAMES.has(cp.openStack[i])) break;
      }
      if (idx === -1) return;
      // Remove ONLY the matched element. What parse5 does with the elements
      // above it depends on which end tag this is: a block name generates
      // implied end tags and pops through, while a formatting name runs the
      // adoption agency, which re-parents rather than popping. Modelling the
      // first would under-count the second — measured, it re-opened four
      // fixtures as fresh under-blocks. Leaving them counted over-blocks,
      // which is the side this scanner is allowed to be wrong on.
      cp.openStack.splice(idx, 1);
      const count = cp.tagBalance.get(tag) ?? 0;
      if (count > 0) {
        cp.tagBalance.set(tag, count - 1);
        cp.openTotal -= 1;
      }
    } else {
      cp.openStack.push(tag);
      cp.tagBalance.set(tag, (cp.tagBalance.get(tag) ?? 0) + 1);
      cp.openTotal += 1;
    }
  };

  /** A table part only re-routes parse5 when it appears OUTSIDE a table —
   *  which is what TABLE_PART_NAMES has always meant, and what the poison
   *  never checked: a well-formed `<table><tr><td>a</td></tr></table>` killed
   *  freezing for the whole rest of the document (measured: boundary 0 from
   *  the table onwards, against 43 for the same prose without it).
   *  `tagBalance` is the open-element model the straddle bail already trusts,
   *  so this adds no new assumption — and it is read only to SUPPRESS a
   *  poison, so a `<table>` the scanner failed to count leaves the old,
   *  over-blocking behaviour in place (2026-08-20 B1). Every call site sits
   *  BEFORE this tag's own `applyTag`, so a `<table><td>` on one line has
   *  the table counted by the time the part is judged. */
  // UNDER-claiming by contract: this wrapper suppresses a poison, so doubt
  // must resolve to "not inside a table" (poison fires). The bag can only
  // over-count opens, and an over-counted `table` here would suppress a
  // poison wrongly — which is why the read is fenced into a named wrapper.
  const definitelyInsideTable = (): boolean => (cp.tagBalance.get('table') ?? 0) > 0;
  // P-tree, explicitly (two-model T3.2): a stray table part leaves parse5's
  // template insertion-mode stack at a table mode — a Parser field a fresh
  // parser does not share, permanently. The line model cannot watch that
  // stack, so the P-tree dimension is expressed as this poison rather than
  // as a checkpoint field: sticky, document-shaping, and cheap to test.
  const strayTablePart = (tag: string): boolean => TABLE_PART_NAMES.has(tag) && !definitelyInsideTable();

  // A type 2-5 raw construct (comment/PI/decl/CDATA) open at the START of
  // this line makes the whole line html-block content — the construct's
  // block ends WITH the line carrying its terminator, so even that line's
  // remainder is raw text. Gates fence/math opens, masking, and def
  // registration below, alongside the tag-block flag (mayBeRawToMicromark).
  const commentOpenAtLineStart = commentEitherOpen(cp.mdBlock, cp.p5Tok);
  const rawOpenAtLineStart = mdHtml25(cp.mdBlock) || cp.p5Tok.kind === 'comment' || cp.p5Tok.kind === 'bogus';

  // --- fence state (interiors are candidate-free; paragraph resets) ---
  if (cp.mdBlock.kind === 'fence') {
    const close = FENCE_RE.exec(ln.text);
    if (
      close &&
      close[1][0] === cp.mdBlock.char &&
      close[1].length >= cp.mdBlock.len &&
      isMdBlank(ln.text.slice(close[0].length))
    ) {
      cp.mdBlock = { kind: 'none' };
    }
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.openBracket = null;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    return;
  }
  if (cp.mdBlock.kind !== 'math' && !rawOpenAtLineStart) {
    const open = FENCE_RE.exec(ln.text);
    // A backtick fence's info string may not contain a backtick —
    // ```a``` b is a PARAGRAPH with a code span, not a fence open (A5).
    const bogusInfo =
      open !== null && open[1][0] === '`' && ln.text.slice(ln.text.indexOf(open[1]) + open[1].length).includes('`');
    if (open && !bogusInfo && cp.mayBeRawToMicromark) {
      // Suppressed open — whether the html-flow run really swallows this
      // line is container-dependent (see phasePoisonedAt). Poison the phase
      // and fall through so the line stays tag-scanned as raw text.
      cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    } else if (open && !bogusInfo) {
      // The open line is a block start for blocker 3 (a column-0 fence
      // terminates a list context; an indented one is ambiguous/hazard).
      if (isBlockStart) {
        const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
        if (verdict !== null) cp.hazardVerdict = verdict;
      }
      cp.mdBlock = { kind: 'fence', char: open[1][0], len: open[1].length, indent: ln.indent };
      cp.blankRun = 0;
      cp.paragraphHasUnpairedRun = false;
      cp.openBracket = null;
      cp.prevLineBlank = false;
      cp.prevLineWasText = false;
      cp.prevLineWasValidDef = false;
      return;
    }
  }

  // --- $$ flow-math state (fence-like: no candidates, close at line start;
  // the closing run must be at least as long as the opening one, with
  // nothing but whitespace after) ---
  if (cp.mdBlock.kind === 'math') {
    const close = MATH_RUN_RE.exec(ln.text);
    if (close && close[1].length >= cp.mdBlock.len && isMdBlank(ln.text.slice(close[0].length))) {
      cp.mdBlock = { kind: 'none' };
    }
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.openBracket = null;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    return;
  }
  // Fence/math OPENS are gated on !mayBeRawToMicromark (matching the fence
  // branch above): inside an html flow run a ``` or $$ line is raw text —
  // entering fence state there would skip tag extraction on lines that
  // rehype-raw parses as REAL markup (fuzz counterexample: a fence glued
  // to `</details>` hiding a quoted `<div>`). Falling through to the
  // plain-text branch keeps those lines tag-scanned (over-block safe) —
  // but the suppression itself is only certainly right at top level, so it
  // ALSO poisons the phase (see phasePoisonedAt).
  // Under the scanner profile (mathFlow=false) `$$` is ordinary paragraph
  // text — no math state, no suppressed-open poison; the line falls through
  // to the plain-text path where its content stays comment/tag-scanned.
  const mathRun = cp.mathFlow && !rawOpenAtLineStart ? MATH_RUN_RE.exec(ln.text) : null;
  if (mathRun) {
    const rest = ln.text.slice(ln.text.indexOf(mathRun[1]) + mathRun[1].length);
    // A `$` anywhere in the rest disqualifies the flow open (meta may not
    // contain `$`): `$$x$$` is inline math, `$$x$` a plain paragraph —
    // both self-contained lines, no state either way.
    if (!rest.includes('$')) {
      if (cp.mayBeRawToMicromark) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      } else {
        if (isBlockStart) {
          const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
          if (verdict !== null) cp.hazardVerdict = verdict;
        }
        cp.mdBlock = { kind: 'math', len: mathRun[1].length, indent: ln.indent };
        cp.blankRun = 0;
        cp.paragraphHasUnpairedRun = false;
        cp.openBracket = null;
        cp.prevLineBlank = false;
        cp.prevLineWasText = false;
        cp.prevLineWasValidDef = false;
        return;
      }
    }
  }

  // --- blank line: candidate emission + paragraph reset ---
  if (ln.blank) {
    // Line-truncated tag opens that never got their `>` before this blank
    // were prose: revert their phantom opens BEFORE judging balance here.
    if (cp.pendingTruncatedTags.length > 0) {
      for (const tag of cp.pendingTruncatedTags) applyTag(tag, true);
      cp.pendingTruncatedTags = [];
    }
    // Truncated closes that never got their `>` stay UNAPPLIED (see the
    // field doc): the element remains counted — over-block, never under.
    cp.pendingTruncatedCloses = [];
    // Still inside a QUOTED attribute value at the blank: micromark ends the
    // html block here, but parse5's tokenizer stays in the value — the
    // paragraph text after the blank goes in as characters (not tokenized)
    // and the NEXT raw node's bytes are eaten up to the closing quote. Which
    // grammar wins where is not modelled: poison (over-block). `outside` /
    // unquoted at the blank keep the classic behaviour (the pending close is
    // dropped, the element stays counted).
    if (cp.pendingTag !== null && (cp.pendingTag.attr === '"' || cp.pendingTag.attr === "'")) {
      cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    }
    cp.pendingTag = null;
    // Same for a bogus comment left open: the block ended, the tokenizer
    // has not — poison and reset.
    if (cp.p5Tok.kind === 'bogus') {
      cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      cp.p5Tok = { kind: 'data' };
    }
    // Types 6/7 end AT this blank — the member clears before the candidate
    // is judged, exactly when the block ends. (Type 1 survives the blank;
    // 2-5 run to their terminators.)
    if (cp.mdBlock.kind === 'html' && cp.mdBlock.type >= 6) cp.mdBlock = { kind: 'none' };
    cp.blankRun += 1;
    cp.lastBlankStart = ln.start;
    cp.candidates.push({
      offset: Math.min(ln.end + 1, text.length),
      blankRun: cp.blankRun,
      // The html member covers types 1-5 in one check: an unterminated
      // type-1 block swallows this blank and everything after it as RAW
      // content (its tags are invisible to the balance scan — the raw-text
      // mask suppresses them — which is exactly why `openTotal` reads 0
      // and the candidate looked safe), and the 2-5 interiors are the
      // same construct to both grammars.
      htmlBalanced: cp.openTotal === 0 && cp.mdBlock.kind !== 'html' && (cp.p5Tok.kind as P5Tok['kind']) !== 'bogus',
      hazard: cp.hazardVerdict,
      seamRisk: cp.p5SealPending,
      defListSettled: null,
    });
    cp.paragraphHasUnpairedRun = false;
    cp.openBracket = null;
    // A type-1 block is the one html block a BLANK LINE does not end — its
    // only end condition is the literal closer, or end of document. While
    // one is open the run must survive the blank, or the scanner reads the
    // block's raw content as markup: `<script></script >` never closes
    // (CommonMark wants the literal `</script>`; the space makes it text),
    // so the ``` lines after the blank are raw text to micromark and a real
    // FENCE to the scanner — a candidate landed inside the html block
    // (2026-08-20 soak leg 2, third shape).
    if (!mdHtml(cp.mdBlock, 1)) {
      cp.mayBeRawToMicromark = false;
      cp.htmlFlowReal = false;
      // A RAWTEXT/RCDATA element still open ACROSS this blank has just had
      // its micromark block end under it: a type-6 run ends at the blank,
      // while parse5's raw-text state runs on to the literal end tag. From
      // here every line lives in both grammars at once — micromark opens
      // fresh blocks whose ELEMENT nodes hast-util-raw pushes straight into
      // the tree, while the same bytes are raw TEXT to parse5, so their end
      // tags never close anything. `<iframe>` + blank + `*b*\n<div>…</div>
      // \n</iframe>` left the div OPEN swallowing the rest of the document
      // while the scanner, suppressing every tag under the raw-text mask, called
      // it balanced (63-byte live under-block, direction battery,
      // 2026-08-24). Document-wide poison, not from-here-on: the element is
      // sanitize-stripped and its lifted children merge with neighbouring
      // text — the fuzz4 lesson, same day. Type-1 blocks are exempt because
      // a blank does NOT end them: there the two grammars agree the content
      // is raw, which is the case the guard above already keeps alive.
      // (inline-opened spans have their own poison at the opening line.)
      if (inRawTextTok(cp.p5Tok) && !cp.p5Tok.openedInline) {
        cp.phasePoisonedAt = 0;
      }
    }
    cp.prevLineBlank = true;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    return;
  }

  // --- plain text line ---
  // Blocker 3 rolling verdict (raw text; block markers sit at line start
  // where a code span cannot precede them).
  if (isBlockStart) {
    const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
    if (verdict !== null) cp.hazardVerdict = verdict;
  } else if (
    LIST_MARKER_RE.test(ln.text) ||
    FOOTNOTE_DEF_RE.test(ln.text) ||
    (cp.defListEnabled && DEF_LIST_DD_RE.test(ln.text)) ||
    ln.indent >= 4
  ) {
    // A marker line NOT sitting after a blank still begins a block: lists
    // interrupt paragraphs, and anything starts fresh after a just-closed
    // fence/math line. Without this, the verdict stays stale and a
    // candidate right after freezes HALF a loose list (fuzz-arbiter
    // counterexamples: paragraph + glued bullet, `$$` close + glued
    // ordered item). Inside an html flow run the marker is raw text and
    // no hazard exists — turning the verdict on anyway only over-blocks.
    //
    // indent >= 4 mirrors A1 at glued positions (seed-20260841): a
    // 4-indented line directly after a fence close starts an indented CODE
    // block that merges across later blanks — a stale verdict let a
    // candidate split it. A mid-paragraph indented line is only a lazy
    // continuation, so flagging it too is pure over-block (safe).
    cp.hazardVerdict = true;
  }

  // Masking is only valid where micromark parses INLINE content. A line
  // starting with a TAG at block indent (approximately) opens an html FLOW
  // block of type 1/6/7 — those run until a blank line with NO inline
  // parsing: backtick runs in it (and in its continuation lines) are
  // literal text, and masking them would hide REAL tags from the balance
  // scan. Sticky until the next blank, like the unpaired-run gate. `<!`/
  // `<?` starters (types 2-5) are NOT sticky — they end at their
  // terminator's line, which rawOpenAtLineStart already tracks; making
  // them sticky suppressed a REAL `$$` open right after `-->` and let a
  // candidate split the math block (fuzz counterexample).
  //
  // Tag names OUTSIDE the type-6 list are AMBIGUOUS: `<embed` (truncated,
  // name not in the list) fails type 7's lone-complete-tag condition and
  // is really a PARAGRAPH — where a glued `$$` is a REAL math open that
  // interrupts it. Suppressing that open put a candidate inside the math
  // (fuzz counterexample). Classifying type 7 exactly means parsing
  // attribute quoting, so ambiguous starters POISON the hazard verdict
  // instead: candidates near the run are rejected outright (pure
  // over-block), which is correct whichever construct micromark chooses.
  const tagStart = ln.indent <= 3 ? /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(mdTrimStart(ln.text)) : null;
  if (tagStart) {
    // Gate on `htmlFlowReal`, not on "did the run start here": the latter
    // reads `mayBeRawToMicromark`, which ANY `<tag` line start sets as an
    // over-approximation — `<embed` (not a type-6 name, not a complete
    // type-7 line) is a PARAGRAPH to micromark, yet it opened the run and so
    // hid the real type-1 block that followed it. What actually matters is
    // whether a real html block is already open: type 1 may interrupt a
    // paragraph, but a `<script>` nested inside an open type-6 block does
    // not start one. Read before the promotion below, which is this line's
    // own (2026-08-21 scaled soak, shard 0).
    const noRealBlockOpen = !cp.htmlFlowReal;
    cp.mayBeRawToMicromark = true;
    if (noRealBlockOpen && TYPE1_START_RE.test(mdTrimStart(ln.text))) cp.mdBlock = { kind: 'html', type: 1 };
    if (!TYPE6_NAMES.has(tagStart[1].toLowerCase())) cp.hazardVerdict = true;
    if (!cp.htmlFlowReal) {
      const t = mdTrimStart(ln.text);
      const t6 = TYPE6_START_RE.exec(t);
      const t7 = TYPE7_LINE_RE.exec(t);
      const realT6 = t6 !== null && TYPE6_NAMES.has(t6[1].toLowerCase());
      if (
        realT6 ||
        TYPE1_START_RE.test(t) ||
        // Type 7 cannot interrupt a paragraph, and excludes the raw-text
        // names (those are type 1 as start tags, paragraph as end tags).
        (t7 !== null && !cp.prevLineWasText && !TYPE1_NAMES.has(t7Name(t).toLowerCase()))
      ) {
        cp.htmlFlowReal = true;
        // Shadow member for the 6/7 run (type 1 wrote html{1} above; the
        // in-comment promotion artifact keeps the member it found). The
        // run flags stay the consumers' truth until each migrates.
        if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: realT6 ? 6 : 7 };
      }
    }
  }
  const inRawText = cp.mayBeRawToMicromark || rawOpenAtLineStart;
  // A type 2-5 html block (`<!--` / `<?` / `<!X` / `<![CDATA[`) STARTING on
  // this line at block indent. Not sticky (V9 — the block ends with its
  // terminator's line), and not `inRawText` unless the construct stays
  // open past EOL — but when it opens AND closes on this line, the bytes
  // after the closer are still this html block's raw content: floating
  // remnant with the blocker-6 tail-dependent seam (`<!-- c --> tail`
  // followed by a def line that a later append turns into a paragraph —
  // direction-battery counterexample surfaced by the overlapping-
  // terminator generator family, 2026-08). Feeds the blocker-6 check only.
  const rawFlowStart = ln.indent <= 3 && /^<(?:!--|\?|![A-Za-z]|!\[CDATA\[)/.test(mdTrimStart(ln.text));

  // Same-line code-span masking for HTML/ref/footnote extraction. A null
  // mask means "unsafe to mask here" — scan the raw text (over-blocking).
  const { masked, unpaired } = inRawText
    ? { masked: null, unpaired: false }
    : maskIntraLineCodeSpans(ln.text, cp.paragraphHasUnpairedRun);
  if (unpaired) cp.paragraphHasUnpairedRun = true;
  const scanText = masked ?? ln.text;

  // Blocker 5 (reference taint) — moved to referenceTaint.ts as a pure
  // move (two-model plan P2); the module doc carries the rationale.
  const { validLinkDef } = collectRefLine(cp, ln.start, ln.end, scanText, inRawText, isBlockStart);

  // Blocker 1: raw-block (types 3–5) state machine, then tag balance.
  // `rawSpans` records the byte ranges this line contributes to raw
  // constructs (interiors, openers, terminators) — blocker 6's remnant
  // check below must not mistake construct-consumed bytes for floating
  // text (fixture: the `?>` terminator line of a PI block).
  const rawSpans: Array<[number, number]> = [];
  let pos = 0;
  // parse5 divergence (2026-08 project-review P1): CommonMark ends a `<?`
  // block at `?>` and a `<![CDATA[` block at `]]>`, but rehype-raw's HTML
  // tokenizer sees BOTH as bogus comments that end at the FIRST `>`. Every
  // byte between that `>` and the CommonMark terminator is raw text to
  // micromark yet REAL markup to parse5 (a `<details>` there is an open
  // element that reparents later siblings). This line model cannot serve
  // two grammars at once, so the moment a construct's first `>` is not its
  // CommonMark terminator, the phase is poisoned from this line on (sticky
  // over-block — the whole divergent region re-parses inside the tail);
  // the micromark model is kept for the scan itself.
  const poisonRawDivergence = (): void => {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  };
  /** A `<?` / `<!DECL` / `<![CDATA[` opened PARAGRAPH-INLINE on this line
   *  (or at code indent). Set only when the opener is not at a position that
   *  could start an html block — the block forms really do run to their
   *  terminator, but the inline forms are html-TEXT attempts that any
   *  block-interrupting next line retracts to literal text. */
  let inlineRawOpenerIdx = -1;
  while (pos < scanText.length) {
    if (mdHtml(cp.mdBlock, 3)) {
      const c = scanText.indexOf('?>', pos);
      const gt = scanText.indexOf('>', pos);
      if (gt !== -1 && (c === -1 || gt !== c + 1)) poisonRawDivergence();
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 2]);
      cp.mdBlock = { kind: 'none' };
      pos = c + 2;
      continue;
    }
    if (mdHtml(cp.mdBlock, 5)) {
      const c = scanText.indexOf(']]>', pos);
      const gt = scanText.indexOf('>', pos);
      if (gt !== -1 && (c === -1 || gt !== c + 2)) poisonRawDivergence();
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 3]);
      cp.mdBlock = { kind: 'none' };
      pos = c + 3;
      continue;
    }
    // The two first-`>` machines are de-fused (P4b-completion commit 1):
    // md type 4 is micromark's declaration block, `bogus` is parse5's
    // bogus comment. Their terminators coincide today, but they are
    // different grammars' states and each branch closes only its own.
    if (mdHtml(cp.mdBlock, 4)) {
      const c = scanText.indexOf('>', pos);
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 1]);
      cp.mdBlock = { kind: 'none' };
      if (cp.p5Tok.kind === 'bogus') cp.p5Tok = { kind: 'data' };
      pos = c + 1;
      continue;
    }
    if (cp.p5Tok.kind === 'bogus') {
      const c = scanText.indexOf('>', pos);
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 1]);
      cp.p5Tok = { kind: 'data' };
      pos = c + 1;
      continue;
    }
    // Openers below are TEXT to BOTH grammars while an outer text-consuming
    // construct is open — micromark: a comment/type-1 block owns every line
    // up to and including its end line; parse5: comment / raw-text content
    // runs to its own terminator, and where the two disagree about the
    // terminator the divergence poisons have already fired. The old code
    // let them open PHANTOM constructs inside those regions (measured:
    // `<!--\n<?x` held commentOpen AND piOpen at once — blocking-only
    // artifacts, but artifacts a single MdBlock cannot and should not
    // represent).
    if (commentOpenAtLineStart || inRawTextTok(cp.p5Tok) || mdHtml(cp.mdBlock, 1)) break;
    const pi = scanText.indexOf('<?', pos);
    const cd = scanText.indexOf('<![CDATA[', pos);
    // `<!` + letter = declaration; `<!--` (third char '-') and
    // `<![CDATA[` (third char '[') never match this.
    const dm = scanText.slice(pos).search(/<![A-Za-z]/);
    const decl = dm === -1 ? -1 : pos + dm;
    // parse5 bogus comment openers — only where the bytes are raw to it (a
    // real html-flow run); in a paragraph `<!` / `</` are literal text that
    // never reaches the tokenizer. `<!` + letter is the declaration above
    // (same "until `>`" shape); `<!--` / `<![CDATA[` are their own constructs.
    // Migration A row 2 (P4b-completion): the question is "are these bytes
    // raw to parse5", and the exact answer is "an md html block is open" —
    // provably equal to the old run-flag read HERE: types 1/2 broke out of
    // the loop above, 3-5 were consumed by their own branches, and the
    // in-comment promotion artifact cannot reach this line (the comment
    // union breaks first). Types 6/7 are the member since commit 2.
    const bm =
      cp.mdBlock.kind === 'html' ? scanText.slice(pos).search(/<!(?!--|[A-Za-z]|\[CDATA\[)|<\/(?![A-Za-z])/) : -1;
    const bogus = bm === -1 ? -1 : pos + bm;
    const starts = [pi, cd, decl, bogus].filter((x) => x !== -1);
    if (starts.length === 0) break;
    const first = Math.min(...starts);
    if (first === bogus) {
      rawSpans.push([bogus, bogus + 2]);
      // Migration collision rule (P3a): a bogus opener while raw text is
      // open is TEXT to parse5 — the old model set a second flag anyway.
      // Poison instead of overwriting the raw-text state (only lowers).
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
      else cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      pos = bogus + 2;
    } else if (first === cd) {
      rawSpans.push([cd, cd + 9]);
      cp.mdBlock = { kind: 'html', type: 5 };
      if (!isMdBlank(scanText.slice(0, cd)) || ln.indent > 3) inlineRawOpenerIdx = cd;
      pos = cd + 9;
    } else if (first === pi) {
      if (scanText[pi + 2] === '>') {
        // `<?>` — the opener's `?` doubles as the closer's: micromark html
        // FLOW closes it on the spot (after `<?` it is already "at `?`,
        // searching for `>`") and parse5 closes its bogus comment at that
        // same `>`. Both agree → a closed 3-byte span, no state. In html
        // TEXT micromark wants a real `?>` after `<?` (paragraph-inline
        // `<?>` stays open to micromark, closed to parse5) — that
        // divergence is poisoned like the others.
        rawSpans.push([pi, pi + 3]);
        pos = pi + 3;
        if (!isMdBlank(scanText.slice(0, pi)) || ln.indent > 3) poisonRawDivergence();
        continue;
      }
      rawSpans.push([pi, pi + 2]);
      cp.mdBlock = { kind: 'html', type: 3 };
      if (!isMdBlank(scanText.slice(0, pi)) || ln.indent > 3) inlineRawOpenerIdx = pi;
      pos = pi + 2;
    } else {
      rawSpans.push([decl, decl + 2]);
      // `<!DOCTYPE` is the one declaration parse5 tokenizes as a real
      // DOCTYPE rather than a bogus comment, so it is consumed and erased
      // (retroactive — see DOCUMENT_STRUCTURE_NAMES). `<!ENTITY` and every
      // other `<!` + letter becomes a comment node and is position-stable.
      // Gated on block indent only, not on position within the line: an
      // INLINE `<!DOCTYPE>` in prose measured safe, but proving how far
      // parse5's insertion modes can reach back is not worth the precision,
      // so any doctype on a line that could open an html block poisons.
      // At indent >= 4 the line is indented CODE (or a lazy paragraph
      // continuation, where the doctype is html-text) — parse5 never sees
      // markup there, and poisoning cost a boundary of 62 → 0 on a plain
      // `    <!DOCTYPE html>` block. Backticked mentions are masked out
      // before this scan and never reach here at all.
      if (ln.indent <= 3 && /^doctype/i.test(scanText.slice(decl + 2))) cp.phasePoisonedAt = 0;
      cp.mdBlock = { kind: 'html', type: 4 };
      if (!isMdBlank(scanText.slice(0, decl)) || ln.indent > 3) inlineRawOpenerIdx = decl;
      pos = decl + 2;
    }
  }
  // Blocker 7, completed for the remaining inline raw constructs — and with
  // the DOCUMENT-WIDE poison, not the from-here-on one. Two stacked failure
  // modes, both measured 2026-08-24:
  //
  //  1. micromark's BLOCK scan can interrupt the paragraph at the next line,
  //     so the bytes this line model reads as construct interior are a fresh
  //     html block to micromark. `x <!D y` + newline + `<!DOCTYPE>`: type 4
  //     interrupts, parse5 erases the doctype — while this scanner read it as
  //     declaration interior, never ran its poison, and "closed" the
  //     declaration at the doctype's own `>` (30-byte live under-block).
  //  2. parse5 reads the whole cross-line construct as ONE bogus comment (to
  //     the first `>`), i.e. a node the sanitize pass REMOVES — and removing
  //     it merges the text nodes on either side. That merge reaches BACKWARD:
  //     in `see … linked\n\n[^a]: def\n<i>y</i> <?php …\n\n<!DOCTYPE html>…`
  //     the merged separator text sits at index 1 of the root, INSIDE a
  //     boundary at offset 24, forty bytes before the opener. A poison at the
  //     opener's own offset provably does not cover it. Erasure-by-sanitize
  //     is the DOCUMENT_STRUCTURE_NAMES semantics, and gets the same poison.
  //
  // (`<!--` has the same erasure shape but its own earlier machinery has kept
  // every measured variant safe — its poison is not widened here, and the
  // corpus carries the shapes that would catch it if that ever stops.)
  if (inlineRawOpenerIdx !== -1 && cp.mdBlock.kind === 'html' && cp.mdBlock.type >= 3) {
    cp.phasePoisonedAt = 0;
  }
  // Raw-construct bytes are data, not markup — mask them (offset-preserving)
  // and scan the REST of the line for tags. The old scan skipped the whole
  // line whenever a raw construct touched it, so a tag before a same-line
  // opener (`<details> <?php`) or after a terminator (`?><details>`) went
  // uncounted — an under-block past a parse5-open element (v2.4.0 review
  // P1/P4; the former was documented as an accepted edge, the latter not).
  let tagText = scanText;
  for (const [from, to] of rawSpans) {
    tagText = tagText.slice(0, from) + ' '.repeat(to - from) + tagText.slice(to);
  }
  // Inside a tag that started on an earlier line of this html-flow run (see
  // `pendingTag`): up to the first RAW `>` the bytes are attribute
  // garbage to parse5 — no tags, no comments, no truncation there.
  let skipTagScan = false;
  if (cp.pendingTag !== null) {
    // De-indent below the truncated line: possibly out of the container
    // (see `pendingTag.indent`) — over-block either way.
    if (ln.indent < cp.pendingTag.indent) poisonRawDivergence();
    // Walk the RAW line with parse5's attribute-area state: a `>` inside a
    // quoted value is a value byte (`<hr title="\n<p></div>` — r2 P1-2: the
    // first `>` used to end the tag and `</div>` closed the outer div), and
    // a value whose quotes pair on this line is ordinary (`<div\n
    // class="a">` — r2 P2-3: any quote before the `>` used to poison the
    // whole stream, freezing 0.4% of a document instead of 96%).
    const attrs = { state: cp.pendingTag.attr };
    const gt = scanTagAttrs(ln.text, 0, ln.text.length, attrs);
    if (gt === -1) {
      // Line ending: ends an unquoted value, is a byte inside a quoted one.
      scanTagAttrs('\n', 0, 1, attrs);
      cp.pendingTag = { attr: attrs.state, indent: cp.pendingTag.indent };
      skipTagScan = true;
    } else {
      // The `>` completes the pending truncated CLOSE (parse5 emits the end
      // tag there); a truncated OPEN was already counted at its line.
      for (const tag of cp.pendingTruncatedCloses) applyTag(tag, true);
      cp.pendingTruncatedCloses = [];
      cp.pendingTag = null;
      tagText = ' '.repeat(gt + 1) + tagText.slice(gt + 1);
    }
  }
  // Set when the tag scan itself found a tag that runs past the line end
  // (quoted attribute value left open): the anchor-on-last-`<` truncation
  // check below must not count it a second time.
  let tagHandledAsTruncated = false;
  if (!skipTagScan) {
    TAG_OR_COMMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastCommentOpenerIdx = -1;
    while ((m = TAG_OR_COMMENT_RE.exec(tagText)) !== null) {
      // Raw-text element content: comment tokens are text too; tags go
      // through applyTag, which admits only the element's own end tag.
      if (inRawTextTok(cp.p5Tok) && (m[0] === '<!--' || m[0] === '-->' || m[0] === '--!>')) {
        // A `<!--` inside `<script>` puts parse5 in "script data escaped",
        // which is where the two grammars stop agreeing — see the poison in
        // `applyTag`.
        if (cp.p5Tok.kind === 'script') {
          if (m[0] === '<!--') cp.p5Tok = { ...cp.p5Tok, escaped: true };
          // `-->` leaves the escaped state (the dash-dash state switches to
          // "script data" on `>`, HTML §13.2.5.24) — exact, and SAFE to be
          // exact about: a `<script` in PLAIN script data is text to
          // parse5 (no double escape), the element still ends at the first
          // literal closer, and micromark agrees — no divergence window
          // opens. The sticky-escaped bias this replaces poisoned
          // `<script><!--x--> <script>` shapes for nothing. `--!>` stays
          // escaped (`!` falls to anything-else in the dash-dash state).
          if (m[0] === '-->') cp.p5Tok = { ...cp.p5Tok, escaped: false };
        }
        continue;
      }
      if (m[0] === '<!--') {
        const next = tagText.slice(m.index + 4, m.index + 6);
        if (commentEitherOpen(cp.mdBlock, cp.p5Tok)) {
          // Inside an OPEN comment `<!--` is content — but the regex
          // consumed its `--`, which may be the start of the closer:
          // `<!-->` / `<!--->` carry a `-->` (closes for both grammars;
          // soak seed 20260759: `<!--\n\n<!-->\n<details>` left the
          // comment open and skipped the real `<details>`), `<!--!>` /
          // `<!---!>` carry a `--!>` (parse5-only closer → poison).
          if (next.startsWith('>') || next === '->') {
            cp.mdBlock = { kind: 'none' };
            if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
          } else if (next === '!>' || next === '-!') {
            // parse5-only closer inside the token: parse5 leaves the
            // comment, micromark does not — the relation poison.
            if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
            poisonRawDivergence();
          }
          continue;
        }
        if (next.startsWith('>') || next === '->') {
          // Empty comment with an overlapping closer (see the note above
          // TAG_OR_COMMENT_RE) — closed on the spot; the regex resumes after `<!--`,
          // where the leftover `>` / `->` matches nothing.
          continue;
        }
        // Inside an open type 6/7 block a `<!--` line is that block's
        // CONTENT — the member keeps the run's identity; parse5's comment
        // half lives on `p5Tok` (commit 1), and every comment read below
        // goes through the union.
        if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 2 };
        if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'comment' };
        lastCommentOpenerIdx = m.index;
        continue;
      }
      if (m[0] === '-->') {
        cp.mdBlock = { kind: 'none' };
        if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
        continue;
      }
      if (m[0] === '--!>') {
        // parse5 accepts `--!>` as a comment closer; CommonMark does not
        // (`<!--x--!>\n<details>\n-->` is one html block to micromark
        // whose `<details>` is a REAL open element to parse5). Same
        // two-grammar split as the raw-construct divergence above → poison
        // from this line, keep the micromark model (comment stays open).
        if (commentEitherOpen(cp.mdBlock, cp.p5Tok)) poisonRawDivergence();
        if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
        continue;
      }
      if (commentEitherOpen(cp.mdBlock, cp.p5Tok)) continue;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      if (strayTablePart(tag)) cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + m.index);
      let attrs = m[3] ?? '';
      // Migration A row 3: "may this tag continue across the line ending"
      // is a raw-stream question — an open md html block answers it. The
      // broadening over the old flag is types 3-5 interiors, and THAT is
      // safe only because a paragraph-inline 3-5 opener already poisons
      // document-wide (the F9 rule) — named dependency, do not remove one
      // without the other.
      if (cp.mdBlock.kind === 'html' && (!inRawTextTok(cp.p5Tok) || (closing && tag === rawTextElement(cp.p5Tok)))) {
        // The regex ends the tag at the first `>`, but in a real html-flow
        // run parse5 ends it at the first `>` OUTSIDE a quoted attribute
        // value (`</div a=">` eats the rest of the line and beyond — a
        // pre-existing under-block of the r2 P1-2 family, oracle review of
        // the batch). Walk the attribute area with parse5's state machine:
        // a later `>` moves the match end; no `>` on the line means the
        // tag continues on the next line — the truncated path below takes
        // it, with the quote state carried.
        const attrStart = m.index + 1 + (closing ? 1 : 0) + m[2].length;
        const st = { state: 'outside' as TagAttrState };
        const gt = scanTagAttrs(tagText, attrStart, tagText.length, st);
        if (gt === -1) {
          if (!VOID_TAGS.has(tag)) {
            if (closing) cp.pendingTruncatedCloses.push(tag);
            else applyTag(tag, false);
          }
          scanTagAttrs('\n', 0, 1, st);
          cp.pendingTag = { attr: st.state, indent: ln.indent };
          tagHandledAsTruncated = true;
          break;
        }
        if (gt + 1 !== m.index + m[0].length) {
          attrs = tagText.slice(attrStart, gt);
          TAG_OR_COMMENT_RE.lastIndex = gt + 1;
        }
      }
      // Paragraph context (micromark html-text / a non-real run): a CLOSING
      // tag is only `</name` + optional whitespace + `>` — `</div a="b">` is
      // literal text and parse5 never sees a close (oracle review of the r2
      // batch, pre-existing: `p <div> x </div a="b"> y` froze past the open
      // div). In a real html-flow run parse5 accepts end-tag attributes.
      if (closing && cp.mdBlock.kind !== 'html' && !/^\s*$/.test(attrs)) {
        // The match ran to the first `>`, swallowing whatever sat in the
        // "attributes". micromark does not: it backtracks the invalid
        // closing tag to literal text and re-scans from inside it, so
        // `</t <div a="">` is text `</t ` plus a REAL html-text `<div a="">`
        // that parse5 opens. Skipping the whole span left that div
        // uncounted — an under-block the direction battery caught once the
        // corpus reached the shape (2026-08-20 soak leg 2, minimised to
        // `</t <div a="">\n\r```\n```\n\n`, unstable under every future).
        // Rewinding past the NAME re-scans the swallowed bytes; the
        // documented `p <div> x </div a="b"> y` case is unaffected, its
        // attribute area holds no tag.
        TAG_OR_COMMENT_RE.lastIndex = m.index + 2 + m[2].length;
        continue;
      }
      const selfClosing = /\/\s*$/.test(attrs);
      if (VOID_TAGS.has(tag) || (selfClosing && honoursSelfClosing(tag))) continue;
      applyTag(tag, closing);
    }
    // A comment opener that is NOT the line's first token and fails to
    // close by end of line is PARAGRAPH-INLINE: micromark only recognizes
    // it as a comment if `-->` arrives before the paragraph ends, else the
    // `<!--` is literal text and everything this scan skipped as "comment
    // interior" until the next stray `-->` is REAL markup (seed-20260828
    // under-block: a real unclosed `<details>` went uncounted and the
    // boundary landed past it, where its raw-time element absorbs every
    // later sibling). Which way it resolves is paragraph-shape-dependent —
    // poison the candidates from the opener on (sticky, over-block), same
    // mechanism as the suppressed fence/math opens. Line-START openers are
    // html block type 2 (terminator semantics, tracked exactly) and raw/
    // flow-context openers follow parse5's comment state — neither poisons.
    // No `!inRawText` gate here, and the poison is document-wide — two
    // upgrades over the original, both bought by counterexamples:
    //
    //  - `inRawText` reads `mayBeRawToMicromark`, which ANY `<letter` line
    //    start sets. `<b>x</b> <!-- trailing…` is a PARAGRAPH (`b` is not a
    //    type-6 name), yet the `<b` start suppressed this poison entirely
    //    and the document froze at 173 of 200 (2026-08-24 scaled soak,
    //    direction battery). The line-start check below is the exact
    //    question the proxy was approximating.
    //  - a cross-line comment is a sanitize-REMOVED node, and removing it
    //    merges the text on either side — the merge reaches backward past
    //    the boundary, so an opener-offset poison has the same hole F9 had
    //    for `<?`/`<!`+letter. Same rule, same document-wide poison.
    if (commentEitherOpen(cp.mdBlock, cp.p5Tok) && lastCommentOpenerIdx !== -1) {
      if (!isMdBlank(tagText.slice(0, lastCommentOpenerIdx)) || ln.indent > 3) {
        cp.phasePoisonedAt = 0;
      }
    }
    // Tags whose `<` sits OUTSIDE every code-span mask but whose `>` sits
    // INSIDE one (`<div x="\`">b\``): micromark tries html-text at the `<`
    // before the later backtick can open a span, so the tag is REAL — but
    // the masked scan above never saw its `>` and counted nothing (v2.4.0
    // review, direction battery). Re-scan the raw line for exactly those
    // matches (raw-construct spans excluded — a `<b>` inside a PI is data).
    if (masked !== null && masked !== ln.text) {
      const inRaw = (i: number) => rawSpans.some(([from, to]) => i >= from && i < to);
      TAG_OR_COMMENT_RE.lastIndex = 0;
      let mr: RegExpExecArray | null;
      while ((mr = TAG_OR_COMMENT_RE.exec(ln.text)) !== null) {
        if (mr[0] === '<!--' || mr[0] === '-->' || mr[0] === '--!>') continue;
        const startMasked = masked[mr.index] !== ln.text[mr.index];
        const wholeVisible = masked.slice(mr.index, mr.index + mr[0].length) === mr[0];
        if (startMasked || wholeVisible || inRaw(mr.index) || commentEitherOpen(cp.mdBlock, cp.p5Tok)) continue;
        const closing = mr[1] === '/';
        const tag = mr[2].toLowerCase();
        if (strayTablePart(tag)) cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + mr.index);
        // Same html-text rule: a closing tag with attributes is text.
        if (closing && mr[3] !== undefined && !/^\s*$/.test(mr[3])) continue;
        const selfClosing = mr[3] !== undefined && /\/\s*$/.test(mr[3]);
        if (VOID_TAGS.has(tag) || (selfClosing && honoursSelfClosing(tag))) continue;
        applyTag(tag, closing);
      }
    }
    // A `>` anywhere on this line confirms every pending truncated open
    // (attributes may wrap; the tag really is a tag — keep it counted).
    // Checked on the RAW line: a `>` inside a masked code span may still be
    // the tag's own closer (`<div x="\`">b\``: micromark parses the tag
    // first, the span never forms) — v2.4.0 review R2(a).
    if (cp.pendingTruncatedTags.length > 0 && ln.text.includes('>')) {
      // A confirmed pending table-part open (`<td` + attributes wrapping)
      // is a real stray table part: poison from here (see TABLE_PART_NAMES).
      if (cp.pendingTruncatedTags.some((t) => strayTablePart(t))) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
      cp.pendingTruncatedTags = [];
    }
    // Line-truncated tag start — anchor on the LAST `<` of the line.
    if (!commentEitherOpen(cp.mdBlock, cp.p5Tok) && !tagHandledAsTruncated) {
      let lastLt = -1;
      TAG_START_LT_RE.lastIndex = 0;
      for (let ms = TAG_START_LT_RE.exec(tagText); ms !== null; ms = TAG_START_LT_RE.exec(tagText)) {
        lastLt = ms.index;
        TAG_START_LT_RE.lastIndex = ms.index + 1;
      }
      if (lastLt !== -1 && !tagText.includes('>', lastLt)) {
        const m2 = TRUNCATED_TAG_RE.exec(tagText.slice(lastLt));
        if (m2) {
          const closing = m2[1] === '/';
          const tag = m2[2].toLowerCase();
          // Table-part poison for a TRUNCATED shape only where it is markup
          // for sure (a real html-flow run); in paragraph context `compare
          // a<td b` may be prose — poison waits for the `>` that confirms the
          // pending open (r2 P3), otherwise the blank line reverts it.
          if (strayTablePart(tag) && cp.mdBlock.kind === 'html') {
            cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + lastLt);
          }
          // In a REAL html-flow run parse5 stays inside this tag across the
          // line ending — open, close or void alike (`<br` + `</div>` on the
          // next line: the `</div>` is garbage). See `pendingTag`.
          if (cp.mdBlock.kind === 'html') {
            // Where parse5 stands after this line's attribute bytes + the
            // line ending (m2[3] holds them; no `>` in there by construction).
            const attrs = { state: 'outside' as TagAttrState };
            scanTagAttrs(m2[3] + '\n', 0, m2[3].length + 1, attrs);
            cp.pendingTag = { attr: attrs.state, indent: ln.indent };
          }
          if (closing) {
            // Never counted on the spot (2026-08-19 review P1: `para </style`
            // zeroed the balance while `<style>` was still open in BOTH
            // grammars — the fuzz corpus had truncated opens only). In an
            // html-flow run the `>` may still arrive on a later line of the
            // run — pend it; in paragraph context a block-indent `>` is a
            // blockquote (the 4+-space continuation shape is not modelled:
            // over-block), so it is treated as prose: nothing.
            if (!VOID_TAGS.has(tag) && cp.mdBlock.kind === 'html') cp.pendingTruncatedCloses.push(tag);
          } else if (!VOID_TAGS.has(tag)) {
            applyTag(tag, closing);
            // Only a PARAGRAPH-line truncation can turn out to be prose. In an
            // html-flow run the bytes are raw: parse5 keeps tokenizing the
            // dangling `<div` into whatever follows the block (fuzz
            // counterexample: `</details>\n<div\n\n` shortened the seam
            // separator), so there the open stays counted, unrevertable.
            // Likewise when the RAW line has a `>` after its last `<`: the
            // masked-away `>` may be the tag's real closer — keep it counted
            // rather than reverting a real tag (R2(a)).
            const rawLastLt = ln.text.lastIndexOf('<');
            const rawTruncated = rawLastLt !== -1 && !ln.text.includes('>', rawLastLt);
            if (!closing && !inRawText && rawTruncated) cp.pendingTruncatedTags.push(tag);
          }
        }
      }
    }
  }

  // Blocker-6 detection: this line is html-flow content, tag balance is
  // fully settled after it, and — after masking construct-consumed bytes
  // (raw spans, comment content) and stripping tag/comment tokens —
  // non-whitespace remains: balanced FLOATING remnant that parse5 will
  // attach at the root with a tail-dependent seam. `inRawText` scopes this
  // to html-flow runs; interior remnant (openTotal > 0) is contained inside
  // an element and stays position-stable, so it does not set the flag.
  // Deliberately NOT gated on raw constructs being closed at line END: a
  // settle line can carry remnant AND open a multi-line comment/PI/decl/
  // CDATA (`remnant <!-- c`), and the terminator line's scan only covers
  // its own bytes — requiring closure here would hide that remnant forever
  // (the under-block direction; review counterexample with an arbiter-level
  // hast mismatch). Unterminated construct bytes are masked (rawSpans /
  // comment-token strip); their interior text may over-flag, which is safe.
  // Pending truncated opens are PHANTOMS until confirmed: for the seam
  // question they must not count as "an element is open" (an open element
  // contains the remnant; a phantom does not) — otherwise a rawFlowStart
  // line ending in a truncated `<div` skips this check and, when the
  // phantom is reverted at the blank line, nobody re-runs it (v2.4.0
  // review R2(b)). Treating them as closed here only over-flags.
  const effectiveOpen = cp.openTotal - cp.pendingTruncatedTags.length;
  if ((inRawText || rawFlowStart) && effectiveOpen <= 0) {
    // Raw-construct bytes are DELETED (not blanked) here: the residue is
    // judged on `length`, not `trim()` — whitespace-only floating text
    // (`<!-- c --> </s>` leaves ` `) is seam-dependent too (v2.4.0 review
    // P2), and blanking spans would fake such whitespace.
    let masked = '';
    let cursor = 0;
    for (const [from, to] of rawSpans) {
      masked += scanText.slice(cursor, from);
      cursor = to;
    }
    masked += scanText.slice(cursor);
    // Comment content spanning lines is not covered by rawSpans (comments
    // are tracked by the token scan, not the raw state machine), so the
    // residue is taken by the SAME token walk the balance scan uses — the
    // comment-open state carried in from the line start, overlapping
    // closers (`<!-->` closing an open comment) and all. Regex masking
    // (`<!--…-->`, `<!--…$`) got the overlap case wrong: it erased the
    // `<!-->` before the "cut at `-->`" step could see it, hiding the real
    // remnant after it (adversarial review of 5074c4b, blocker-6 seam).
    if (floatingResidue(masked, commentOpenAtLineStart).length > 0) {
      cp.p5SealPending = true;
    }
  }

  // The span reaches past this line ending. micromark and parse5 disagree
  // about where it ENDS — `</title a>` is literal paragraph text to
  // micromark (a closing tag takes no attributes) while parse5's RCDATA
  // tokenizer accepts it and closes the element — so from here the scanner
  // cannot model the span at all: it suppressed a `<div>` the real parse
  // leaves OPEN, which then grows with every append (2026-08-21 soak leg 2,
  // boundary 144 with the div at @86 extending to @161). Poison rather than
  // reject one candidate: the divergence outlives the span.
  if (inRawTextTok(cp.p5Tok) && cp.p5Tok.openedInline) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  }

  // CommonMark type-1 end condition: the line CONTAINS the closer string,
  // and that line still belongs to the block — so this runs last, after the
  // line has been scanned as raw flow. The next line starts fresh.
  if (mdHtml(cp.mdBlock, 1) && TYPE1_CLOSE_RE.test(ln.text)) {
    cp.mdBlock = { kind: 'none' };
    cp.mayBeRawToMicromark = false;
    cp.htmlFlowReal = false;
  }

  cp.blankRun = 0;
  cp.prevLineBlank = false;
  cp.prevLineWasText = true;
  // Def CHAINS (A2) are a link-definition affordance: one def line can be
  // followed directly by another. A FOOTNOTE def does NOT chain — its
  // unindented next line lazily continues the footnote BODY, so a
  // def-shaped line glued under it is literal body text and registering it
  // would be a ghost def (fuzz counterexample). Refs on that line stay
  // extracted (footnote bodies parse inline content).
  cp.prevLineWasValidDef = validLinkDef;
}
