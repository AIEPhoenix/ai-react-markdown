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
 *    a fence/math open suppressed inside an html-flow run (only certainly
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
 *  That discard has a SECOND consequence, on end tags that are never in the
 *  source at all (F19, 2026-08-27). `hast-util-raw` serialises the whole mdast
 *  before re-parsing, so every markdown construct contributes a real tag pair
 *  to parse5's input: `>` becomes `<blockquote>…</blockquote>`, `#` becomes
 *  `<h1>…</h1>`, `*a*` becomes `<em>…</em>`. A barrier still OPEN when one of
 *  those GENERATED end tags fires discards it by the same scope walk — and the
 *  host then leaks, re-nesting everything after it (`><table>\n</table>` +
 *  blank + prose puts the tail paragraph INSIDE the blockquote; `# h <table>`
 *  inside the h1). For a formatting name the leak is worse: the element stays
 *  in the active-formatting-elements list and is RECONSTRUCTED around all
 *  following content, which is a live shipped divergence — `*<object>*\n
 *  </object>` + blank + prose wraps the tail in a top-level `<em>` that the
 *  incremental path never produces (23 bytes, every incremental frame).
 *  The closing walk below cannot see this: the barrier's own raw tags are
 *  BALANCED, and the tag that gets discarded was never scanned. So the second
 *  consequence needs its own guard — `scopeBarrierStraddlesHost`.
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
/** Bytes parse5's DATA state acts on: `<` + letter / `!` / `/` / `?`.
 *  Everything else (a lone `<`, `< b`) is character data. Used by the
 *  `--!>` divergence-window check: a window containing none of these is
 *  text to BOTH grammars and may converge. */
const P5_MARKUP_RE = /<[!/?A-Za-z]/;
/** Type-6 start: `<`/`</` + name + (whitespace | `>` | `/>` | EOL). */
const TYPE6_START_RE = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t\r]|\/?>|$)/;
/** Type-1 start: an OPEN tag of a raw-text name + (whitespace | `>` | EOL). */
const TYPE1_START_RE = /^<(script|pre|style|textarea)(?:[ \t\r]|>|$)/i;
/** Type 1's end condition is a literal substring anywhere on the line —
 *  no attributes, no whitespace before `>` (CommonMark 4.6). */
const TYPE1_CLOSE_RE = /<\/(?:script|pre|style|textarea)>/i;
/** Type-7 start, EXACT (§4.6 condition 7 + the §2.2 tag grammar): the whole
 *  line is one complete OPEN tag or one complete CLOSING tag, followed by
 *  whitespace only. Attribute values follow the spec grammar — a QUOTED
 *  value may contain `>` (`<span title="a>b">` alone on a line IS a type-7
 *  block), an unquoted value may not (`<span title=a>b>` is a paragraph),
 *  an attribute name is `[A-Za-z_:][A-Za-z0-9:._-]*`, an empty unquoted
 *  value (`<a href=>`) invalidates the tag, and `/` self-closing must sit
 *  directly before the `>` — every shape measured against micromark before
 *  the approximate `[^>]*` test this replaces was retired (it both missed
 *  the quoted-`>` class, which the retired `mayBeRawToMicromark` flag
 *  existed to cover, and
 *  over-accepted attribute garbage on non-type-6 names).
 *
 *  Closing tags take NO attributes (`</span a="b">` is a paragraph, and
 *  treating it as html flow made the scanner apply a close parse5 never
 *  sees: `<span>\n\n</span a="b">\n\ntail` froze past a still-open span —
 *  oracle re-check of the r2 batch. Type 6 is unaffected — its names are
 *  recognized on `</name` + whitespace regardless of what follows.) */
const isSpaceTab = (c: number): boolean => c === 32 || c === 9;
const isAsciiAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAlnum = (c: number): boolean => isAsciiAlpha(c) || (c >= 48 && c <= 57);
/** completeAttributeName continuation set: alphanumeric, `-` `.` `:` `_`. */
const isAttrNameRest = (c: number): boolean => isAlnum(c) || c === 45 || c === 46 || c === 58 || c === 95;
/** completeAttributeValueUnquoted EXIT set (the value may not contain
 *  these; note `=` exits into completeAttributeNameAfter, which happily
 *  consumes another `=` — so `<foo a=b=c>` IS a complete tag to micromark,
 *  looser than the spec's written grammar, measured and matched here). */
const isUnquotedExit = (c: number): boolean =>
  Number.isNaN(c) || c === 34 || c === 39 || c === 47 || c === 60 || c === 61 || c === 62 || c === 96 || isSpaceTab(c);

/** The attribute area + `>` of a complete OPEN tag, transcribed state for
 *  state from micromark's html-flow complete path (nameBefore / name /
 *  nameAfter / valueBefore / valueQuoted(+After) / valueUnquoted / end).
 *  Returns the index just past the closing `>`, or -1 where micromark
 *  reaches `nok`. */
const completeOpenTagRest = (t: string, from: number): number => {
  let i = from;
  for (;;) {
    // completeAttributeNameBefore
    const c = t.charCodeAt(i);
    if (c === 47 /* / */) {
      i += 1;
      break; // → completeEnd
    }
    if (isSpaceTab(c)) {
      i += 1;
      continue;
    }
    if (!(c === 58 || c === 95 || isAsciiAlpha(c))) break; // → completeEnd
    i += 1; // completeAttributeName
    while (isAttrNameRest(t.charCodeAt(i))) i += 1;
    // completeAttributeNameAfter — also re-entered after an unquoted value,
    // which is what makes `=` chains legal.
    for (;;) {
      while (isSpaceTab(t.charCodeAt(i))) i += 1;
      if (t.charCodeAt(i) !== 61 /* = */) break; // → completeAttributeNameBefore
      i += 1; // completeAttributeValueBefore
      while (isSpaceTab(t.charCodeAt(i))) i += 1;
      const v = t.charCodeAt(i);
      if (Number.isNaN(v) || v === 60 || v === 61 || v === 62 || v === 96) return -1;
      if (v === 34 || v === 39) {
        // completeAttributeValueQuoted: anything but the marker or EOL.
        i += 1;
        while (t.charCodeAt(i) !== v) {
          if (i >= t.length) return -1;
          i += 1;
        }
        i += 1;
        // completeAttributeValueQuotedAfter: `/`, `>` or whitespace only.
        const a = t.charCodeAt(i);
        if (!(a === 47 || a === 62 || isSpaceTab(a))) return -1;
        break; // → completeAttributeNameBefore
      }
      // completeAttributeValueUnquoted (possibly empty: `<a b=/>` is
      // complete — the `/` exits straight through nameAfter to the end).
      while (!isUnquotedExit(t.charCodeAt(i))) i += 1;
      // → completeAttributeNameAfter(code) — loop.
    }
  }
  // completeEnd
  return t.charCodeAt(i) === 62 /* > */ ? i + 1 : -1;
};

/** Whether a line (leading indent stripped) meets §4.6 condition 7 — one
 *  complete open or closing tag, whitespace only after — EXACTLY as
 *  micromark decides it, including its tagName dispatch:
 *  - a type-6 NAME never reaches condition 7 (`<div a="b>">` is type 6,
 *    `</div>` too — realT6 at the call site agrees);
 *  - an OPEN raw-text name is type 1 — UNLESS the name is followed by `/`
 *    (`<style/>` is a complete type-7 tag, measured);
 *  - a CLOSING tag takes no attributes but its name is unrestricted:
 *    `</style>` alone on a line IS type 7 (the earlier "paragraph as end
 *    tags" note in Table A was wrong, and harmless only while
 *    the retired `mayBeRawToMicromark` flag blanket-covered every
 *    `<`-starting line).
 *  A lone `\r` is a LINE ENDING to micromark, not tag whitespace — the
 *  classification runs on the segment before it (the rest of the physical
 *  line is the block's first content either way). */
export const isType7Line = (line: string): boolean => {
  const cr = line.indexOf('\r');
  const t = cr === -1 ? line : line.slice(0, cr);
  if (t.charCodeAt(0) !== 60 /* < */) return false;
  let i = 1;
  const closing = t.charCodeAt(i) === 47;
  if (closing) i += 1;
  if (!isAsciiAlpha(t.charCodeAt(i))) return false;
  const nameStart = i;
  i += 1;
  while (isAlnum(t.charCodeAt(i)) || t.charCodeAt(i) === 45) i += 1;
  const c = t.charCodeAt(i); // NaN at end of line
  // tagName exit set (EOL / `/` / `>` / whitespace); anything else is nok.
  if (!(Number.isNaN(c) || c === 47 || c === 62 || isSpaceTab(c))) return false;
  const name = t.slice(nameStart, i).toLowerCase();
  if (!closing && c !== 47 && TYPE1_NAMES.has(name)) return false; // type 1
  if (TYPE6_NAMES.has(name)) return false; // type 6 (or its basicSelfClosing)
  if (closing) {
    // completeClosingTagAfter: whitespace, then completeEnd's `>`.
    while (isSpaceTab(t.charCodeAt(i))) i += 1;
    if (t.charCodeAt(i) !== 62) return false;
    i += 1;
  } else {
    i = completeOpenTagRest(t, i);
    if (i === -1) return false;
  }
  // completeAfter: whitespace only to the end of (micromark's) line.
  while (isSpaceTab(t.charCodeAt(i))) i += 1;
  return i >= t.length;
};

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
  /** Type 1, the one html block whose four names do NOT share a parse5
   *  answer: `script`/`style`/`textarea` are raw-text elements, `pre` is
   *  not (it is absent from `RAW_TEXT_ELEMENTS`, and parse5 tokenizes its
   *  content in the DATA state). `raw` carries that fact ON the member,
   *  taken from the name at the claim site — the consumer that needs it
   *  asks about PARSE5's grammar, not micromark's, and inferring it from
   *  `p5Tok` there would read a field the same line sets one phase later.
   *
   *  `indent` is the opener line's indent, and carries the same meaning it
   *  does on `fence`/`math` above: only a column-0 opener is provably
   *  top-level. An html block opened at indent 1-3 may be a list item's
   *  content (`- a` then `  <table>`), and the F19 guard reads it for
   *  exactly that — a barrier inside a container-HELD html block still
   *  straddles the item's generated end tag. */
  | { kind: 'html'; type: 1; raw: boolean; indent: number }
  /** The rest of the CommonMark html blocks. Types 2-5 end by their own
   *  terminators; types 6/7 end at the blank. Type 7 is entered by the
   *  EXACT §4.6 test (`isType7Line`) since the exact-type-7 stage — the
   *  attribute-quote hole the approximate test had (and the retired
   *  `mayBeRawToMicromark` flag covered) is
   *  closed, which is what let the remaining run-flag consumers migrate
   *  to the member. */
  | { kind: 'html'; type: 2 | 3 | 4 | 5 | 6 | 7; indent: number };

const mdHtml = (b: MdBlock, type: 1 | 2 | 3 | 4 | 5): boolean => b.kind === 'html' && b.type === type;
/** A type-1 block whose element is RAW TEXT to parse5 too — the state in
 *  which both grammars agree every byte up to the closer is content. The
 *  `pre` half of type 1 is deliberately excluded (F13). */
const mdType1RawText = (b: MdBlock): boolean => b.kind === 'html' && b.type === 1 && b.raw;
/** Types 2-5 open: the interiors both grammars agree are raw content. */
const mdHtml25 = (b: MdBlock): boolean => b.kind === 'html' && b.type >= 2 && b.type <= 5;

/** parse5 tokenizer macro-state at a LINE BOUNDARY (two-model P3a, T3.1).
 *  A PARTITION of {data, rawText, script, bogus} — measured before the
 *  design was frozen: the within-tag attribute position co-exists with any
 *  of these (`<iframe>\n</iframe a="`), so it is the separate `pendingTag`
 *  overlay, NOT a member. `openedInline` is captured AT OPEN (the old
 *  `rawTextInline` latch — the run state is reset before the poison that
 *  reads it, so a live read would lose the poison). Members are REPLACED,
 *  never mutated: checkpoints are shared mutable state, and a module-level
 *  token constant would alias across mounted documents. */
type P5Tok =
  | { kind: 'data' }
  /** RAWTEXT / RCDATA content: everything is text until `</element`. */
  | { kind: 'rawText'; element: string; openedInline: boolean }
  /** SCRIPT_DATA with the full escape ladder (P3b batch 1, the F6
   *  retirement): `escaped` = a `<!--` ran without its `-->`; `double` = a
   *  nested `<script` start tag arrived while escaped (implies `escaped`).
   *  While `double`, a `</script>` steps back to escaped and the ELEMENT
   *  STAYS OPEN (and stays counted on `openStack`); `-->` exits BOTH
   *  levels (double-escaped dash-dash on `>` goes straight to
   *  SCRIPT_DATA — parse5 tokenizer, verified in source). The old
   *  double-entry POISON is retired: the tangle sits identically in the
   *  prefix of every future parse, so candidates may release once the
   *  element truly closes — the splice side refuses these prefixes
   *  separately (rawTextRegionCrossesOut), because the element CROSSES
   *  micromark blocks and swallows their wrap separator. */
  | { kind: 'script'; escaped: boolean; double: boolean; openedInline: boolean }
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
  /** micromark's "content construct open" after the previous confirmed
   *  line — the EXACT interrupt input for §4.6 condition 7. micromark
   *  refuses type 7 while its CONTENT construct (paragraph or definition
   *  chain, including container-held paragraphs) is open; `prevLineWasText`
   *  ("any non-blank line") over-claims that, refusing after headings,
   *  thematic breaks, raw-construct terminator lines and fence closes —
   *  all measured as type-7-OPENING to micromark. The decision table at
   *  the end of the plain path derives this per line class; the one class
   *  a line model cannot settle (a pipe line: GFM table row, after which
   *  type 7 OPENS, vs pipe-bearing paragraph, after which it cannot) is
   *  poisoned at the refused tag line instead — see `tableMaybeOpen`. */
  prevLineOpenContent: boolean;
  /** A GFM table MAY be open: a pipe line was seen and every line since
   *  has been table-continuable. A table, once its header/delimiter pair
   *  formed, is continued by ANY non-blank line that is not another
   *  block-level structure — `| 1 | 2 |` then `see [a] prose` is TWO
   *  table rows to micromark, not a table and a paragraph (soak seed
   *  20283008: a tag line after such a pipe-less continuation row was
   *  refused as "after content" while micromark, whose table had just
   *  been broken by the html block, OPENED type 7 — the phantom closer
   *  then chased a math block that never existed). Sticky across
   *  content-class lines, cleared by every openContent=false class and
   *  at the usual reset points. Consumed only by the type-7 residual
   *  poison — over-claiming it only widens the poison (safe). */
  tableMaybeOpen: boolean;
  /** A CONTAINER may be open: a blockquote / list-item / footnote-def
   *  marker line was seen and every line since has been container-
   *  continuable. micromark's `tagName` carries a `!self.parser.lazy`
   *  exception the content model has no input for — a type-7-shaped line
   *  that LAZILY continues an open container opens a container-held html
   *  block (`> quoted` then `<x-y/>`), and a container whose last line was
   *  not a paragraph CLOSES instead, leaving the same line to open a
   *  top-level multi-line block (`> # h` then `<x-y/>`). Both readings say
   *  "opens" where `prevLineOpenContent` says "refused", and which one
   *  holds depends on container state a line model does not track (16 of
   *  21 container prefixes diverged, none poisoned — 2026-08-26 review).
   *  Sticky and reset exactly like `tableMaybeOpen`, and consumed by the
   *  same residual poison: over-claiming it only widens the poison. */
  containerMaybeOpen: boolean;
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
  /** A definition may still be OPEN: a def-shaped line was seen and no
   *  blank has ended it yet. A definition spans up to three lines (label,
   *  destination, title) and its title may wrap inside its quotes, and
   *  every line after the first emits NO hast node — so none of them can
   *  pin the blocker-6 seam, exactly like the def line itself. The seal
   *  release tested the line's own SHAPE, which caught only the first
   *  (soak 20289117, seed shard 17: `[b]: /b "t` + `w"` released the seam
   *  and the frozen remnant node went position-less to positioned under a
   *  `-->` future). Cleared at the blank, where a definition provably
   *  ends; read only by the seal release, where holding it over-blocks. */
  defBlockMaybeOpen: boolean;
  /** A FOOTNOTE definition may still be RESUMABLE: `[^…]:` was seen and no
   *  line since has definitively interrupted the block. Unlike a link
   *  definition (whose `defBlockMaybeOpen` a blank provably ends), a
   *  footnote body CONTINUES ACROSS blank lines via ≥4-indent lines — the
   *  list-item continuation rule — and a resumed body paragraph then takes
   *  LAZY continuation lines at ANY indent. None of those lines emits a
   *  top-level hast node (the body renders in the footer section), so none
   *  of them may release the blocker-6 seam. The seal release's first view
   *  classified a post-blank indented line as indented CODE and released a
   *  live seam (release-gate finding A, seed 20293003 — F16, the
   *  cross-blank sibling of F15); its second view kept an `indent >= 4`
   *  conjunct, which the lazy continuation refuted at indent 0 (F18, the
   *  adversarial review of the derived-release design). Armed by a
   *  footnote-def line; kept across blanks and every non-interrupting line;
   *  cleared by a confirmed non-blank BLOCK-START line at indent ≤ 3, the
   *  one shape no footnote body can resume past (blank above ⟹ not lazy).
   *  Read only by the seal release, where holding it over-blocks. */
  fnDefResumable: boolean;
  /** Offset of the first fence/math OPEN suppressed inside an html-flow
   *  run — the member gate since Migration B row 6 (Infinity = none). Whether the run really swallowed that line depends
   *  on container context the line scan cannot see (`<embed` inside a list
   *  item is a lazy paragraph line, and the glued `$$` a REAL math open —
   *  seed-20260757 under-block: the tracker's fence phase INVERTS from that
   *  line on, every later close reads as an open, and the corruption never
   *  resyncs). Candidates past this offset are rejected outright — sticky,
   *  pure over-block; candidates before it are untouched (the ambiguous
   *  region then re-parses inside the tail). This field is the sticky
   *  phase-corruption backstop (the old rolling hazard poison for
   *  "ambiguous tag names" retired with exact type 7). */
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
/** A line that OPENS a container holding content: a blockquote marker (a
 *  bare `>` counts — the quote is open either way) or a list marker WITH
 *  content on the same line. A BARE marker is excluded on purpose: an
 *  empty item holds no paragraph, so the next line at block indent is
 *  neither its content nor a lazy continuation, and the interrupt answer
 *  there is decided (the battery measures it as OPENING). Footnote
 *  definitions and def-list descriptions arm through their own regexes at
 *  the call site. Arms `containerMaybeOpen`. */
const CONTAINER_MARKER_RE = /^ {0,3}(?:>|(?:[-*+]|\d{1,9}[.)])[ \t]+\S)/;
/** Line classes for the content-tracking decision table (the type-7
 *  interrupt input). All run on the TRIMMED line (indent ≤ 3 — the ≥ 4
 *  case is decided before them). Measured against micromark 2026-08-25:
 *  type 7 OPENS after each class below, and after html-block lines and
 *  fence/math lines; it stays REFUSED after paragraph, definition,
 *  footnote-definition, list-item-with-content and blockquote lines. */
const ATX_HEADING_RE = /^#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK_RE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** A BARE list marker (`-` / `*` / `+` / `1.` alone): opens an EMPTY item
 *  and closes any content — micromark opens type 7 on the next line. */
const BARE_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)])[ \t]*$/;
/** Setext-underline shapes not already claimed above: `=+`, and `--`
 *  (a lone `-` is BARE_MARKER, three+ are THEMATIC — same false answer).
 *  These CONSUME an open paragraph into a heading (content closes); with
 *  no paragraph open they ARE a paragraph (content opens). */
const SETEXT_LEFTOVER_RE = /^(?:=+|--)[ \t]*$/;
/** Definition-list description marker (micromark-extension-definition-list). */
const DEF_LIST_DD_RE = /^ {0,3}:[ \t]/;
/** A whole line that is one closing tag and nothing else (`</div>`,
 *  `</x-y>`, `</br>`). Such a line emits NO node through rehype-raw's
 *  fragment context, so it cannot pin the blocker-6 seam. */
const CLOSE_TAG_ONLY_RE = /^[ \t]*<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t\r]*$/;
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
    prevLineOpenContent: false,
    tableMaybeOpen: false,
    containerMaybeOpen: false,
    paragraphHasUnpairedRun: false,
    openBracket: null,
    p5SealPending: false,
    defBlockMaybeOpen: false,
    fnDefResumable: false,
    phasePoisonedAt: Infinity,
    pendingTruncatedTags: [],
    pendingTruncatedCloses: [],
    pendingTag: null,
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
  // Migration B row 7, the CLEAR half (exact type 7): "starts OUTSIDE any
  // html-flow run" is the MEMBER's answer at line start — the retired
  // proxy also held the seam through `<embed x`-style paragraph lines,
  // which emit their paragraph node and pin the seam like any other
  // content line.
  if (
    cp.p5SealPending &&
    !ln.blank &&
    cp.mdBlock.kind !== 'html' &&
    !(cp.p5Tok.kind === 'comment' || cp.p5Tok.kind === 'bogus')
  ) {
    // The def clause is the LINE's own shape plus the sticky block flags: a
    // definition's destination and title lines are def CONTINUATIONS that
    // emit no node either, and a shape test cannot see them (see
    // `defBlockMaybeOpen`); below a RESUMABLE footnote definition every
    // line that is not the block's provable interruption belongs (or may
    // lazily belong) to its BODY and emits no top-level node — the ≥4-indent
    // continuation (F16), but also the LAZY continuation of a resumed body
    // paragraph at ANY indent (`[^a]: note` + blank + `    cont` +
    // `lazy tail` — F18, the adversarial-review refutation of the F16
    // indent conjunct: `lazy tail` sits at indent 0 and released a live
    // seam). The only line that provably interrupts the footnote is a
    // BLOCK-START line at ≤3 indent (blank above, so it cannot be lazy),
    // and that line releases on its own merits through the clauses below;
    // everything else keeps, indent-independent (see `fnDefResumable`).
    const defShapedLine =
      DEF_RE.test(ln.text) ||
      FOOTNOTE_DEF_RE.test(ln.text) ||
      cp.defBlockMaybeOpen ||
      (cp.fnDefResumable && !(isBlockStart && ln.indent <= 3));
    const commentOnly =
      ln.text
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<!--[\s\S]*$/, ' ')
        .replace(/[ \t\r]/g, '') === '';
    // A line that is ONLY a closing tag emits no node either, and the
    // predicate's other three clauses are all true of it — so `</div>`
    // released a seam it does not pin (`<!-- c --> remnant\n</div>` froze
    // 47 of 51 bytes; 2026-08-26 review M6). Through rehype-raw's fragment
    // context a stray closer produces nothing at the root, which is the
    // design's §2.1a RETRO measurement: the trailing root text node can
    // still grow. Whole-line only — `</div> trailing` leaves a text node
    // and pins the seam like any other content.
    const closeTagOnly = CLOSE_TAG_ONLY_RE.test(ln.text);
    if (!defShapedLine && !commentOnly && !closeTagOnly) {
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
      // "Script data double escaped" (F6, retired poison → exact ladder):
      // inside an escaped `<script>` a nested `<script` start tag makes
      // parse5 stop honouring `</script>` — the first one only steps back
      // to escaped, and the element runs on. CommonMark ends its type-1
      // block at the first literal closer line regardless, so the two
      // grammars diverge about which BYTES are raw for the length of the
      // window — during it the element stays counted (no release), and
      // the frozen-prefix consequences are the splice guard's job.
      if (cp.p5Tok.kind === 'script' && cp.p5Tok.escaped && !closing && tag === 'script') {
        cp.p5Tok = { ...cp.p5Tok, double: true };
      }
      if (!(closing && tag === rawTextElement(cp.p5Tok))) return;
      if (cp.p5Tok.kind === 'script' && cp.p5Tok.double) {
        // `</script>` while double-escaped: back to escaped, element open,
        // stack untouched — the early return skips the pop below.
        cp.p5Tok = { ...cp.p5Tok, double: false };
        return;
      }
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
            ? { kind: 'script', escaped: false, double: false, openedInline }
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
      //
      // LOAD-BEARING beyond the counts: the formElement latent divergence
      // (design §2.1 — parse5's form pointer survives an IMPLICIT close and
      // eats a later <form>) is guarded exactly by this rule keeping the
      // implicitly-closed form on `openStack`. Modelling implied end tags
      // here needs an explicit formElement guard shipped WITH it —
      // `formElementLatent.test.ts` is the tripwire.
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
  //
  // PENDING TRUNCATED opens are subtracted for that reason, the same
  // phantom argument the seam check makes with `effectiveOpen`: a
  // paragraph-line `compare a<table b` is prose, parse5 discards the
  // incomplete tag, and nothing is inside a table when a later `<td>` is
  // judged — yet the bag counted it and suppressed the poison
  // (`compare a<table b\n<td>x</td>\n</table>` froze 59 of 63 bytes;
  // 2026-08-26 review M5, the one wrapper whose implementation contradicted
  // its name). The `>` that CONFIRMS the open clears the pending list, so a
  // real table recovers the suppression on the spot.
  const definitelyInsideTable = (): boolean =>
    (cp.tagBalance.get('table') ?? 0) > cp.pendingTruncatedTags.filter((t) => t === 'table').length;
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
  // registration below, alongside the html-block member.
  const commentOpenAtLineStart = commentEitherOpen(cp.mdBlock, cp.p5Tok);
  // The two halves separately, for consumers that need the INTERSECTION
  // (floatingResidue) rather than the union — captured at line start like
  // the union itself.
  const bothCommentsOpenAtLineStart = mdHtml(cp.mdBlock, 2) && cp.p5Tok.kind === 'comment';
  // P3b batches 2/3, the divergence WINDOWS: micromark still inside its
  // comment (type 2) or PI/CDATA (type 3/5) block, parse5 already out
  // (`--!>` closed the comment; the construct's first `>` closed the
  // bogus comment). Window bytes are construct interior to one grammar
  // and live input to the other — safe exactly while parse5 reads them
  // as TEXT. The first line carrying a byte parse5 would act on poisons
  // the phase (sticky, over-block).
  const inDivergenceWindow =
    (mdHtml(cp.mdBlock, 2) && cp.p5Tok.kind !== 'comment') ||
    ((mdHtml(cp.mdBlock, 3) || mdHtml(cp.mdBlock, 5)) && cp.p5Tok.kind !== 'bogus');
  if (inDivergenceWindow && P5_MARKUP_RE.test(ln.text)) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  }
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
    cp.prevLineOpenContent = false;
    cp.tableMaybeOpen = false;
    cp.containerMaybeOpen = false;
    return;
  }
  if (cp.mdBlock.kind !== 'math' && !rawOpenAtLineStart) {
    const open = FENCE_RE.exec(ln.text);
    // A backtick fence's info string may not contain a backtick —
    // ```a``` b is a PARAGRAPH with a code span, not a fence open (A5).
    const bogusInfo =
      open !== null && open[1][0] === '`' && ln.text.slice(ln.text.indexOf(open[1]) + open[1].length).includes('`');
    if (open && !bogusInfo && cp.mdBlock.kind === 'html') {
      // Suppressed open (Migration B row 6, exact type 7): the gate is the
      // MEMBER — an html block open from previous lines owns this ``` line
      // as raw text. The retired proxy also suppressed after `<embed x`
      // paragraph openers, where the fence is REAL (fence interrupts a
      // paragraph) and suppression was the seed-20260757 phase-corruption
      // shape. The phasePoisonedAt backstop STAYS: the member itself is
      // container-blind (a run inside a list item can end at a de-indent
      // this line model cannot see), so whether the run really swallows
      // this line is still container-dependent. Poison the phase and fall
      // through so the line stays tag-scanned as raw text.
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
      cp.prevLineOpenContent = false;
      cp.tableMaybeOpen = false;
      cp.containerMaybeOpen = false;
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
    cp.prevLineOpenContent = false;
    cp.tableMaybeOpen = false;
    cp.containerMaybeOpen = false;
    return;
  }
  // Fence/math OPENS are gated on the html-block MEMBER (matching the
  // fence branch above): inside an html flow run a ``` or $$ line is raw text —
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
      if (cp.mdBlock.kind === 'html') {
        // Row 6, math half — same member gate, same kept backstop.
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
        cp.prevLineOpenContent = false;
        cp.tableMaybeOpen = false;
        cp.containerMaybeOpen = false;
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
    // Same for a bogus comment left open WITHOUT its md construct: the
    // block ended, the tokenizer has not — poison and reset. When an md
    // type 2-5 block is still open the two grammars CROSS the blank
    // together (`<?a\n\n?>` is one block and one bogus comment — batch 3
    // pairs the states, so the aligned crossing must not poison).
    if (cp.p5Tok.kind === 'bogus') {
      if (mdHtml25(cp.mdBlock)) {
        // aligned — both grammars still inside; state survives the blank.
      } else {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
        cp.p5Tok = { kind: 'data' };
      }
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
    // A definition cannot span a blank line — this is where one provably
    // ends, and the next content line pins the seam again.
    cp.defBlockMaybeOpen = false;
    cp.prevLineOpenContent = false;
    cp.tableMaybeOpen = false;
    cp.containerMaybeOpen = false;
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
  // Tag names OUTSIDE the type-6 list used to poison the rolling hazard
  // verdict ("ambiguous starters") because classifying type 7 needed
  // attribute-quote parsing. Type 7 IS exact now — the line either opens a
  // block (the member) or is a paragraph, both micromark's own answer — so
  // the blanket hazard is retired with the ambiguity (exact-type-7 stage;
  // the one undecidable interrupt class, pipe lines, has its own sticky
  // poison at the refused tag line).
  const tagStart = ln.indent <= 3 ? /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(mdTrimStart(ln.text)) : null;
  if (tagStart) {
    // Gate on the MEMBER, never on "did the run start here" — the retired
    // run flag was set by ANY `<tag` line start, an over-approximation:
    // `<embed` (not a type-6 name, not a complete
    // type-7 line) is a PARAGRAPH to micromark, yet it opened the run and
    // so hid the real type-1 block that followed it (2026-08-21 scaled
    // soak, shard 0). What matters is whether a real html block is already
    // open: type 1 may interrupt a paragraph, but a `<script>` nested
    // inside an open type-6 block does not start one. The member answers
    // MORE truly than the run flag it replaced (P4b-completion commit 6)
    // in one place — a type-1 line inside an open type 2-5 block
    // (`<?a\n<script>`): the flag was false there and a phantom type-1
    // opened inside the construct's content; the member is html{3-5} and
    // correctly refuses. Movements measured and pinned with this commit.
    const noRealBlockOpen = cp.mdBlock.kind !== 'html';
    const t1 = noRealBlockOpen ? TYPE1_START_RE.exec(mdTrimStart(ln.text)) : null;
    // `raw` is the parse5 half of the same line: three of the four type-1
    // names are raw-text elements, `pre` is not.
    if (t1) cp.mdBlock = { kind: 'html', type: 1, raw: RAW_TEXT_ELEMENTS.has(t1[1].toLowerCase()), indent: ln.indent };
    if (cp.mdBlock.kind !== 'html') {
      const t = mdTrimStart(ln.text);
      const t6 = TYPE6_START_RE.exec(t);
      const realT6 = t6 !== null && TYPE6_NAMES.has(t6[1].toLowerCase());
      const t1Line = TYPE1_START_RE.test(t);
      // The interrupt-SENSITIVE class: a line whose only reading as an html
      // block is condition 7. Types 1 and 6 may interrupt a paragraph, so
      // their answer never depends on what came before, and neither
      // undecidable-interrupt poison below applies to them.
      const type7Shaped = !realT6 && !t1Line && isType7Line(t);
      if (
        realT6 ||
        t1Line ||
        // Type 7 cannot interrupt CONTENT (micromark's paragraph/definition
        // construct — `prevLineOpenContent`, the exact interrupt input; the
        // old `prevLineWasText` gate refused after headings, terminator
        // lines and fence closes, where micromark measurably opens). The
        // classifier itself is exact too (isType7Line) — including closing
        // raw-text names (`</style>` alone is type 7, measured) and
        // quoted-`>` attribute values.
        (!cp.prevLineOpenContent && type7Shaped)
      ) {
        // The 6/7 member (type 1 wrote html{1} above; inside this branch
        // the member is provably 'none', the guard is shape only).
        if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: realT6 ? 6 : 7, indent: ln.indent };
      } else if (cp.prevLineOpenContent && cp.tableMaybeOpen && type7Shaped) {
        // The one interrupt class a line model cannot settle: after a GFM
        // TABLE row type 7 opens (a table is not content), after a
        // pipe-bearing PARAGRAPH line it cannot — and table-ness was
        // decided lines ago by a header/delimiter pair this scanner does
        // not model. The marker is STICKY (`tableMaybeOpen`), because a
        // table is continued by any non-blank non-structural line — the
        // pipe-less row `see prose` after `| 1 | 2 |` is still a row
        // (soak seed 20283008). Whichever way micromark went, the two
        // readings give this line to different grammars, so the phase is
        // poisoned from here — sticky over-block, the same treatment as
        // every other undecidable divergence.
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
      // The SECOND undecidable interrupt class, same shape as the pipe one
      // and outside the if/else because it applies to the claim as well as
      // to the refusal. micromark's `tagName` refuses type 7 on
      // `self.interrupt && !self.parser.lazy[line]` — the lazy half is an
      // input the content model does not have. While a container may be
      // open this line is either its LAZY continuation (micromark opens a
      // container-held block) or the line after the container closed
      // (micromark opens a TOP-LEVEL multi-line block); the content model
      // reads the container line as open content and refuses. Both
      // readings give the line to a different grammar than the scanner's,
      // so poison rather than answer — sticky over-block, and the marker
      // disarms at the blank, where the container provably ended and the
      // plain verdict is right again.
      if (type7Shaped && cp.containerMaybeOpen) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      }
    }
  }
  // Migration B is COMPLETE: exact type 7 shipped (classifier + interrupt
  // commits), rows 4/6/7 plus the truncated-open and seam-set sites read
  // the member, and `mayBeRawToMicromark` is deleted. The nonType6QuotedGt
  // corpus family keeps standing guard over the once-was-a-hole class.
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
  // Whether this line's bytes belong to an html block / raw construct in
  // either grammar — captured HERE (after the tag-start pre-scan classified
  // the line, before the raw-construct machine may close a 2-5 member
  // mid-line) for the content-tracking table at the end of the plain path:
  // html-block lines close micromark's content construct (type 7 opens
  // after a terminator line, measured), and a mid-line INLINE opener does
  // not make the line any less a paragraph.
  const htmlOwnedLine = cp.mdBlock.kind === 'html' || rawOpenAtLineStart || rawFlowStart;

  // Same-line code-span masking for HTML/ref/footnote extraction. A null
  // mask means "unsafe to mask here" — scan the raw text (over-blocking).
  // Migration B row 4 (exact type 7): masking is valid exactly where
  // micromark parses INLINE content, and that is now the member's answer —
  // an open html block (any type, the pre-scan classified THIS line
  // already), a 2-5 construct open at line start or STARTING here
  // (`rawFlowStart` — the flag never covered those, `<?` fails its regex),
  // or parse5-side raw content. The proxy this replaces also suppressed
  // masking on every line after a `<embed x`-style PARAGRAPH opener until
  // the next blank — lines micromark measurably parses inline, where a
  // backticked tag IS a code span parse5 never sees (the boundary rises
  // there are this stage's payoff, verified by engine probe and pinned).
  const maskingSuppressed = htmlOwnedLine || inRawTextTok(cp.p5Tok);
  const { masked, unpaired } = maskingSuppressed
    ? { masked: null, unpaired: false }
    : maskIntraLineCodeSpans(ln.text, cp.paragraphHasUnpairedRun);
  if (unpaired) cp.paragraphHasUnpairedRun = true;
  const scanText = masked ?? ln.text;

  // Blocker 5 (reference taint) — moved to referenceTaint.ts as a pure
  // move (two-model plan P2); the module doc carries the rationale.
  // Migration B row 5 (P4b-completion): the def gate goes EXACT — "is a
  // def-shaped line raw to micromark" is answered by the member (an open
  // md html block) plus the parse5-side masks. The narrowing over the old
  // proxy is safe for a reason that must stay written down: the second
  // gate inside collectRefLine is `defLineStart`, and `prevLineWasText`
  // is set at the end of EVERY non-blank line — so on every narrowed
  // shape (a type-7-hole run line, a def line glued under a closed 2-5
  // block) the def is a paragraph-continuation line and stays
  // unregistered. Loosen `defLineStart` and this migration's safety
  // argument goes with it.
  // Deliberately NOT `htmlOwnedLine`: that one adds `rawFlowStart`, which
  // this gate has no use for. A line that STARTS a 2-5 construct begins
  // `<!--` / `<?` / `<!X` / `<![CDATA[` at block indent, and a def line
  // begins `[` (DEF_RE / FOOTNOTE_DEF_RE) — the two are mutually exclusive
  // at line start, so adding the term could not change a single verdict.
  // The asymmetry is intentional, not an oversight (2026-08-26 review).
  const defRawToMicromark = cp.mdBlock.kind === 'html' || rawOpenAtLineStart || inRawTextTok(cp.p5Tok);
  const { validLinkDef } = collectRefLine(cp, ln.start, ln.end, scanText, defRawToMicromark, isBlockStart);

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
    if (mdHtml(cp.mdBlock, 3) || mdHtml(cp.mdBlock, 5)) {
      // P3b batch 3: micromark's type 3/5 block runs to `?>` / `]]>`;
      // parse5's BOGUS COMMENT (the p5 half of these constructs, tracked
      // on `p5Tok` since this batch) ends at the FIRST `>`. When the two
      // disagree, the window between parse5's `>` and micromark's
      // terminator is construct interior to one grammar and live input to
      // the other — poisoned ONLY if it can hold bytes parse5 acts on
      // (P5_MARKUP_RE), same rule as the `--!>` window. In window mode
      // (p5 already out) the bytes are parse5 TEXT: no rawSpans, so the
      // blocker-6 residue sees the remnant they become.
      const isPi = mdHtml(cp.mdBlock, 3);
      const term = isPi ? '?>' : ']]>';
      const c = scanText.indexOf(term, pos);
      const mdEnd = c === -1 ? scanText.length : c + term.length;
      if (cp.p5Tok.kind === 'bogus') {
        const gt = scanText.indexOf('>', pos);
        if (gt !== -1 && (c === -1 || gt !== c + term.length - 1)) {
          // parse5 closes here; the window to micromark's terminator (or
          // EOL — later window lines are checked at line start).
          cp.p5Tok = { kind: 'data' };
          rawSpans.push([pos, gt + 1]);
          if (P5_MARKUP_RE.test(scanText.slice(gt + 1, c === -1 ? scanText.length : c))) {
            poisonRawDivergence();
          }
        } else {
          rawSpans.push([pos, mdEnd]);
          if (c !== -1) cp.p5Tok = { kind: 'data' };
        }
      }
      // (p5 out already: window-mode bytes stay unmasked on purpose.)
      if (c === -1) break;
      cp.mdBlock = { kind: 'none' };
      pos = mdEnd;
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
    // up to and including its end line; parse5: comment / RAW-TEXT content
    // runs to its own terminator, and where the two disagree about the
    // terminator the divergence poisons have already fired. The old code
    // let them open PHANTOM constructs inside those regions (measured:
    // `<!--\n<?x` held commentOpen AND piOpen at once — blocking-only
    // artifacts, but artifacts a single MdBlock cannot and should not
    // represent).
    //
    // The type-1 term asks the PARSE5 half (`mdType1RawText`), not "is a
    // type-1 block open": `pre` is a type-1 name that parse5 tokenizes in
    // the DATA state, so `<?x` inside `<pre>` really opens a bogus comment
    // that eats the `>` of the `</pre>` line and leaves the element open
    // (F13 — 20 divergent frames on `<pre>\n<?x\n</pre>` + tail; before the
    // gate existed the phantom opener's own first-`>` poison covered it by
    // accident, and the gate removed both).
    if (commentOpenAtLineStart || inRawTextTok(cp.p5Tok) || mdType1RawText(cp.mdBlock)) {
      // An INLINE-opened raw-text region is the one masked context whose
      // parse5 state is unknowable from here: micromark called the opener
      // paragraph text, and parse5's tokenizer may have CLOSED the region
      // already (`</iframe a>` — attributes make it literal text to
      // micromark and a real end tag to parse5's RCDATA/RAWTEXT states).
      // The from-here-on poison at the region's opening line covers
      // forward damage, but a RETROACTIVE construct inside the masked
      // bytes (`<!DOCTYPE …>`, document-structure tags, `<template>`)
      // erases and merges BACKWARD past candidates emitted long before the
      // region opened — this scan breaking here is exactly what kept the
      // doctype's own document-wide poison from firing (release-gate
      // finding B, seed 20293004 — F17). Whether parse5 really saw the
      // construct cannot be decided; poison document-wide, the erasure
      // standard.
      //
      // Block-opened regions were exempt here until F20 (2026-08-27), on the
      // stated ground that "their close is tracked exactly, attribute-bearing
      // end tags included". That is true of PARSE5's close and false of
      // micromark's, and the mask's third term asks micromark. `</script/>`
      // is a valid end tag to parse5 — the `/` is a bogus self-closing flag —
      // while CommonMark's type-1 end condition wants the LITERAL `</script>`,
      // so the block runs on and `mdType1RawText` keeps masking a region
      // parse5 has already left. `maskUnbacked` below is that desync.
      if (
        inRawTextTok(cp.p5Tok) &&
        cp.p5Tok.openedInline &&
        (tailCarriesRetroactive(ln.text) || /<template(?![a-z0-9-])/i.test(ln.text))
      ) {
        cp.phasePoisonedAt = 0;
      }
      // The block-opened half is F20, guarded at the END of the line instead
      // (`maskUnbacked`): the desync it tests is a property of the line's
      // SETTLED state, and `mdBlock` is not settled here — a legitimate
      // `</script>` line still reads as type-1 open at this point in the scan.
      break;
    }
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
      // Claim the member only OUTSIDE a 6/7 run — inside one, micromark
      // opens nothing (the run owns every byte to the blank) and the old
      // unconditional write LOST the run's identity: `</t>` opened a
      // type-7 run, `<![CDATA[…]]>` overwrote the member and closed it at
      // `]]>`, and the `$$` after was mistaken for a REAL math open — the
      // phantom closer then broke output-neutrality (soak seed 20282500,
      // fuzz shard 0; latent behind the run flag until its deletion).
      // Same rule as `<!--` since P4b commit 1: the parse5 half lives on
      // the overlay regardless (`<![CDATA[` in fragment html is a bogus
      // comment to the first `>` — rev2 #4, measured).
      if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 5, indent: ln.indent };
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
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
      // Member only outside a 6/7 run (see the CDATA branch).
      if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 3, indent: ln.indent };
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
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
      // Member only outside a 6/7 run (see the CDATA branch).
      if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 4, indent: ln.indent };
      // md type 4 and the p5 bogus comment share their first-`>` end, so
      // no window can open — the pairing is still tracked for honesty.
      if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'bogus' };
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
  //
  // `type >= 3` also matches the 6/7 members, and has since the member
  // overwrite rule tightened (96901ff): a mid-line `<?…?>` or `<!X…>`
  // INSIDE an open type 6/7 run no longer takes the member, so the run's
  // own 6/7 survives to this test and the opener poisons document-wide.
  // That is KEPT deliberately, not an accident of the member surviving —
  // the run case is the same sanitize-erasure shape as the paragraph one,
  // and narrowing the predicate back to 3-5 would raise boundaries for
  // pure freeze-rate gain (2026-08-26 review min-1: measured, and declined
  // on the risk side of that trade).
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
          // `-->` leaves the escape ladder ENTIRELY: the single- and
          // double-escaped dash-dash states both switch to "script data"
          // on `>` (HTML §13.2.5.24/§13.2.5.30, verified in parse5's
          // tokenizer). `--!>` stays escaped (`!` falls to anything-else
          // in the dash-dash states).
          if (m[0] === '-->') cp.p5Tok = { ...cp.p5Tok, escaped: false, double: false };
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
            // Close ONLY the comment member: with the union, an unguarded
            // clear here nukes whatever else holds the member — measured
            // regression: a stray closer while a type-1 block held html{1}
            // released every later candidate (soak leg 2, seed 20280501).
            if (mdHtml(cp.mdBlock, 2)) cp.mdBlock = { kind: 'none' };
            if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
          } else if (next === '!>' || next === '-!') {
            // parse5-only closer inside the token: parse5 leaves the
            // comment, micromark does not. P3b batch 2: the divergence
            // WINDOW (from here to micromark's `-->`) is markup to parse5
            // and comment content to micromark — poison only if markup
            // bytes can appear in it on this line; later window lines are
            // checked at line start. A markup-free window is text to both
            // grammars and converges at `-->`.
            if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
            if (mdHtml(cp.mdBlock, 2) && P5_MARKUP_RE.test(tagText.slice(m.index + m[0].length))) {
              poisonRawDivergence();
            }
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
        if (cp.mdBlock.kind === 'none') cp.mdBlock = { kind: 'html', type: 2, indent: ln.indent };
        if (cp.p5Tok.kind === 'data') cp.p5Tok = { kind: 'comment' };
        lastCommentOpenerIdx = m.index;
        continue;
      }
      if (m[0] === '-->') {
        // A STRAY `-->` (no comment open) is text to both grammars: the
        // old per-field `commentOpen = false` was a no-op there, and the
        // union must keep it one — an unguarded member clear released a
        // type-1 block's html{1} (soak leg 2, seed 20280501, `</script/>`
        // false closer upstream; regression pinned).
        if (mdHtml(cp.mdBlock, 2)) cp.mdBlock = { kind: 'none' };
        if (cp.p5Tok.kind === 'comment') cp.p5Tok = { kind: 'data' };
        continue;
      }
      if (m[0] === '--!>') {
        // parse5 accepts `--!>` as a comment closer; CommonMark does not
        // (`<!--x--!>\n<details>\n-->` is one html block to micromark
        // whose `<details>` is a REAL open element to parse5). P3b
        // batch 2 retires the unconditional poison: parse5's comment
        // CLOSES here, micromark's block runs on to `-->`, and the
        // window between them diverges only if it holds bytes parse5
        // would act on — `P5_MARKUP_RE` on the line remainder here, and
        // per line at the line-start check while the relation stays
        // split (md html{2} open, p5 out of comment). A markup-free
        // window is parse5 TEXT inside micromark's block: the grammars
        // converge at `-->` and the block's output is a text remnant the
        // blocker-6 seam machinery owns (floatingResidue runs on the
        // INTERSECTION of the two comment states for exactly this).
        // A p5-ONLY comment closing here (inside a type 6/7 run) never
        // diverged from micromark at all — no poison either.
        if (mdHtml(cp.mdBlock, 2) && P5_MARKUP_RE.test(tagText.slice(m.index + m[0].length))) {
          poisonRawDivergence();
        }
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
            // Migration B, truncated-open revertibility (exact type 7):
            // "paragraph-line truncation" is the member's complement. The
            // retired proxy kept `<embed x`-style PARAGRAPH truncations
            // counted forever; they are prose candidates like any other
            // paragraph truncation and revert at the blank.
            if (!closing && !(htmlOwnedLine || inRawTextTok(cp.p5Tok)) && rawTruncated) {
              cp.pendingTruncatedTags.push(tag);
            }
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
  // Migration B row 7, the SET half (exact type 7): floating raw remnant
  // arises from RAW bytes — html-block content in either grammar
  // (`htmlOwnedLine` covers the member, line-start 2-5 state and
  // `rawFlowStart`; the p5 raw-text kinds ride along for completeness).
  // A `<embed x`-style paragraph line's text becomes a position-stable
  // paragraph node, never seam-owned remnant — the retired proxy set the
  // flag there anyway.
  if ((htmlOwnedLine || inRawTextTok(cp.p5Tok)) && effectiveOpen <= 0) {
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
    // Comment state for the residue = the INTERSECTION of the two
    // grammars' comment states (P3b batch 2 / oracle rev2 #5): bytes are
    // construct interior only if BOTH grammars are inside a comment. In
    // the `--!>` window (md open, p5 closed) the bytes are parse5 TEXT —
    // real remnant with a tail-dependent seam; a p5-only comment inside a
    // type 6/7 run over-flags, which is the safe direction.
    if (floatingResidue(masked, bothCommentsOpenAtLineStart).length > 0) {
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
    // The type-1 block ends here for micromark — if parse5's raw-text
    // element SURVIVES this close (the double-escape held it open), the
    // element will swallow later md blocks and their wrap separators as
    // its own text, and sanitize stripping it then merges the survivors
    // BACKWARD past any earlier boundary (the F9/F11 erasure class — the
    // 20282605/10/11 direction-battery counterexamples: `<script>\n
    // <!--<script>\n</script>\n<div>d</div>\n</script>` froze at 56 and
    // a one-character append changed the frozen region's children).
    // Document-wide poison, the erasure standard; a tangle that resolves
    // on ONE line never reaches this branch with the element open, so
    // the single-line recovery (and the `-->` exact exit) survive.
    if (inRawTextTok(cp.p5Tok)) cp.phasePoisonedAt = 0;
  }

  cp.blankRun = 0;
  cp.prevLineBlank = false;
  cp.prevLineWasText = true;
  // ── content tracking: the decision table for `prevLineOpenContent` ──
  // Derives micromark's "content construct open" per line class, measured
  // 2026-08-25 (see the field doc). The DIRECTION stakes: claiming "open"
  // where micromark closed under-claims the html{7} member (the class the
  // run flag used to blanket — masking/bogus-tracking then miss real raw
  // bytes, blocked only by a DECAYING hazard verdict); claiming "closed"
  // where micromark kept content open over-claims the member and can
  // shadow a REAL type-1 open behind a phantom type-7 run. Neither side is
  // conservative, which is why the table is exact per class and the one
  // undecidable class (pipe lines) is poisoned at the consuming gate.
  {
    const tt = mdTrimStart(ln.text);
    let openContent: boolean;
    if (htmlOwnedLine) {
      // html-block content in either grammar — closes/never opens content.
      openContent = false;
    } else if (ln.indent >= 4) {
      // A ≥4-indent line is a LAZY CONTINUATION when content is open
      // (stays open) and INDENTED CODE when it is not (stays closed).
      openContent = cp.prevLineOpenContent;
    } else if (ATX_HEADING_RE.test(tt) || THEMATIC_BREAK_RE.test(tt)) {
      openContent = false;
    } else if (BARE_MARKER_RE.test(tt)) {
      // An EMPTY list item cannot interrupt a paragraph (CommonMark §5.2),
      // so while content is open micromark reads the marker line as a LAZY
      // CONTINUATION and content stays open — a blanket `false` here
      // OVER-claimed. It agreed for a lone `-` by accident: that is also a
      // valid setext underline, which closes content under both readings,
      // and the accident is now written down rather than relied on. At a
      // block start `prevLineOpenContent` is false anyway, which is what
      // the single-line battery rows pin.
      openContent = tt[0] === '-' ? false : cp.prevLineOpenContent;
    } else if (SETEXT_LEFTOVER_RE.test(tt)) {
      // `=+` / `--`: a setext underline when a paragraph is open (content
      // CONSUMED into a heading), a paragraph of its own when not — EXCEPT
      // inside a table, where the same bytes are just another ROW and the
      // table (with the content it holds) runs on. Flipping to false there
      // disarmed `tableMaybeOpen`, the next content line lost the marker,
      // and a later refused tag line went unpoisoned (2026-08-26 review
      // M3(a): a `<br/>` line after a `--` row froze 89 of 93 bytes while
      // micromark held a real html block inside the frozen region).
      openContent = cp.tableMaybeOpen && cp.prevLineOpenContent ? true : !cp.prevLineOpenContent;
    } else {
      // Paragraph, definition, footnote definition, list item content,
      // blockquote line — all leave content open for interrupt purposes
      // (each measured as type-7-REFUSING).
      openContent = true;
    }
    cp.prevLineOpenContent = openContent;
    // Table tracking (see the field doc): a pipe line arms it; any
    // content-class line carries it; every block-structure line (the
    // openContent=false classes) breaks the table and disarms it.
    // The arming half asks whether this line could be a table ROW at all —
    // a `|` inside an html comment or any other html-owned line is not a
    // cell separator, and arming from one poisoned documents holding no
    // table (2026-08-26 review min-2). Over-claiming the marker only
    // widens the poison, so the narrowing is the precision half: it RAISES
    // boundaries, attributed per sample in the commit that landed it.
    cp.tableMaybeOpen = (!htmlOwnedLine && ln.text.includes('|')) || (cp.tableMaybeOpen && openContent);
    // Container tracking, the same sticky shape: a container-marker line
    // arms it, any content-class line carries it (a lazy continuation and
    // an indented item line are both content), every block-structure line
    // breaks the container and disarms it. Both halves take `openContent`,
    // because the marker shapes overlap the structure ones — `- - -` is a
    // thematic break, not a list item, and the table above is what says so.
    const containerMarker =
      CONTAINER_MARKER_RE.test(ln.text) ||
      FOOTNOTE_DEF_RE.test(ln.text) ||
      (cp.defListEnabled && DEF_LIST_DD_RE.test(ln.text));
    cp.containerMaybeOpen = openContent && (containerMarker || cp.containerMaybeOpen);
  }
  // Def CHAINS (A2) are a link-definition affordance: one def line can be
  // followed directly by another. A FOOTNOTE def does NOT chain — its
  // unindented next line lazily continues the footnote BODY, so a
  // def-shaped line glued under it is literal body text and registering it
  // would be a ghost def (fuzz counterexample). Refs on that line stay
  // extracted (footnote bodies parse inline content).
  cp.prevLineWasValidDef = validLinkDef;
  // Sticky to the next blank: from a def-shaped line on, every line may be
  // that definition's destination or (wrapped) title, none of which emits a
  // node the blocker-6 seam can hang on. Carrying it across ordinary
  // paragraph lines too only delays the release to the blank — over-block.
  cp.defBlockMaybeOpen = cp.defBlockMaybeOpen || DEF_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text);
  // Footnote-def resumability (F16): armed by the def line itself; a
  // non-blank BLOCK-START line at indent ≤ 3 definitively interrupts the
  // footnote block (no body line can resume past it), everything else —
  // lazy continuations (not block starts), ≥4-indent continuations, and the
  // blanks that never reach this function's non-blank tail — carries it.
  if (FOOTNOTE_DEF_RE.test(ln.text)) cp.fnDefResumable = true;
  else if (isBlockStart && ln.indent <= 3) cp.fnDefResumable = false;
  // F19, the barrier's second consequence (see SCOPE_BARRIER_NAMES): a barrier
  // left open at the end of a line whose content is HELD by a markdown
  // construct will swallow that construct's generated end tag. The scanner
  // cannot enumerate generated elements — it never sees them — so it answers
  // the only question that decides the case: is anything generated open around
  // this barrier? No, in exactly one position: an html BLOCK, whose raw text
  // becomes a root-level node with no wrapper. Every other position (a
  // container marker line, a heading line, a paragraph's inline html) has at
  // least one generated element around it, and which one is unknowable here.
  // "Top-level" takes the reading `pendingFenceCloser` already gives it: only
  // a column-0 opener is provably top-level, since an html block opened at
  // indent 1-3 may be a list item's own content (`- a` then `  <table>`, the
  // one family cell the block-vs-inline test alone left UNDER).
  //
  // Direction: writes the poison only, so both ways of being wrong LOWER the
  // boundary — an over-claimed barrier on the bag widens it, and so does
  // calling a top-level host non-top-level. `ln.start`, not 0: the re-nesting
  // reaches forward only (measured — every node before the host is unchanged).
  //
  // The accepted cost is the shapes where the barrier closes on a LATER line
  // inside the same host and never straddles anything (`> <table>\n> </table>`,
  // and the paragraph-inline `<table>` that parse5 foster-parents out of its
  // own way). Sparing those needs a per-host "did this construct end here"
  // model — a second grammar, for the shapes this one is already blind to.
  //
  // PENDING TRUNCATED opens are subtracted, the `effectiveOpen` argument: a
  // line-truncated `compare a<td b` leaves parse5's tokenizer INSIDE the tag,
  // so no element is open yet and no generated end tag can be discarded. This
  // is the one reading here that fires the poison LESS, and it is sound
  // because it only DEFERS: if a later line brings the `>`, the pending list
  // is cleared with the name still on `openStack`, and the check fires on that
  // line — still ahead of the blank where the paragraph's `</p>` is emitted.
  const isBarrier = (name: string): boolean => SCOPE_BARRIER_NAMES.has(name);
  const topLevelHtmlBlock = cp.mdBlock.kind === 'html' && cp.mdBlock.indent === 0;
  const confirmedBarriers = cp.openStack.filter(isBarrier).length - cp.pendingTruncatedTags.filter(isBarrier).length;
  if (!topLevelHtmlBlock && confirmedBarriers > 0) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
  }
  // F20 — the raw-text mask outliving the grammar that justifies it.
  //
  // The tag scan is suppressed while `mdType1RawText(cp.mdBlock)` holds, and
  // that member's contract is "the state in which BOTH grammars agree every
  // byte up to the closer is content". `</script/>` breaks the agreement: the
  // `/` is a bogus self-closing flag parse5 ignores, so the element closes for
  // parse5, while CommonMark's type-1 end condition wants the LITERAL
  // `</script>` and the block runs on. From there the mask hides tags parse5
  // really acts on — `<script>` + `</script/>` + `<pre>` + `</3` + `</pre>`
  // froze 39 of 41 bytes while the bogus comment ate the `>` of the `</pre>`
  // line and left the `pre` open swallowing the tail (100% of engaged frames
  // diverged on three of six configs; pre-existing through db9f091). F17 fixed
  // the inline-opened case and exempted this one because "their close is
  // tracked exactly" — true of parse5's close, false of micromark's.
  //
  // Settled state only, which is why this sits at the end of the line and not
  // in the scan loop: mid-scan a legitimate `</script>` line still reads as
  // type-1 open, and testing there poisoned F13's own fixture.
  //
  // Forward damage (the tags the scan is not counting) takes the from-here
  // poison; backward damage takes the document-wide one on the same erasure
  // standard as the inline branch — a doctype inside the masked bytes merges
  // text across candidates emitted long before the region opened.
  const maskUnbacked = mdType1RawText(cp.mdBlock) && !inRawTextTok(cp.p5Tok);
  if (maskUnbacked) {
    cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
    if (tailCarriesRetroactive(ln.text) || /<template(?![a-z0-9-])/i.test(ln.text)) {
      cp.phasePoisonedAt = 0;
    }
  }
}
