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
 *    a fence/math open suppressed by `htmlFlowSinceBlank` (only certainly
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
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

/** CommonMark type-6 block tag names (micromark's own list), lowercase. */
const TYPE6_NAMES = new Set(htmlBlockNames);

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
  text: string;
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

interface UnresolvedRef {
  offset: number;
  label: string;
  footnote: boolean;
}

/** Mutable resume state. All fields describe the scan strictly BEFORE the
 *  first unconfirmed character (`confirmedOffset`). */
export interface FreezeScanCheckpoint {
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
  commentOpen: boolean;
  piOpen: boolean;
  declOpen: boolean;
  cdataOpen: boolean;
  inFence: boolean;
  fenceChar: string;
  fenceLen: number;
  inMath: boolean;
  /** Opening dollar-run length while inMath — the close run must match it. */
  mathFenceLen: number;
  /** Indent (0-3 spaces) of the line that opened the current fence/math
   *  block. Not a blocker input — read by `phantomSuffixCloser` to emit a
   *  closer at the SAME indent, which closes the block whether it sits at
   *  top level (≤3 spaces are allowed there) or inside a list item whose
   *  content indent the opener line already satisfies. */
  openIndent: number;
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
  paragraphHasUnpairedRun: boolean;
  /** Blocker-6 pending flag: a confirmed html-flow line left balanced
   *  floating raw remnant, and no later content line has pinned the seam
   *  yet. Persists across blank lines (every candidate emitted while set
   *  has the remnant as its last frozen child); cleared by the next
   *  non-blank line that starts OUTSIDE an html-flow run. */
  htmlSeamPending: boolean;
  /** A line since the last blank started with `<` at block indent — an html
   *  FLOW block is (approximately) running, and it only ends at a blank
   *  line. micromark does no inline parsing there: backtick runs are
   *  literal text, so code-span masking would hide REAL tags from the
   *  balance scan (under-block — fuzz counterexample: `</details>` followed
   *  by an unblanked `` `<div>` `` line). While set, masking is skipped —
   *  which can only over-block (safe direction). */
  htmlFlowSinceBlank: boolean;
  /** Offset of the first fence/math OPEN suppressed by `htmlFlowSinceBlank`
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
const FOOTNOTE_DEF_RE = /^ {0,3}\[\^[^\]]*\]:/;
/** Definition-list description marker (micromark-extension-definition-list). */
const DEF_LIST_DD_RE = /^ {0,3}:[ \t]/;
/** Any link/footnote reference definition at block indent. */
const DEF_RE = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:/;
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
const TRUNCATED_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)([^<>]*)$/;
/** Bracketed inline candidate: link/image reference or shortcut. No nesting
 *  support — plain prose brackets count as taint (conservative direction). */
const REF_RE = /!?\[((?:[^[\]\\]|\\.)*)\]/g;
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

function normalizeLabel(label: string): string {
  const collapsed = label.trim().replace(/[ \t\r\n]+/g, ' ');
  return collapsed ? normalizeIdentifier(collapsed) : '';
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

function freshCheckpoint(defListEnabled: boolean, mathFlow: boolean, referenceTaint: boolean): FreezeScanCheckpoint {
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
    commentOpen: false,
    piOpen: false,
    declOpen: false,
    cdataOpen: false,
    inFence: false,
    fenceChar: '',
    fenceLen: 0,
    inMath: false,
    mathFenceLen: 0,
    openIndent: 0,
    blankRun: 0,
    lastBlankStart: -1,
    hazardVerdict: false,
    prevLineBlank: true, // doc start counts as a block start
    prevLineWasText: false,
    prevLineWasValidDef: false,
    paragraphHasUnpairedRun: false,
    htmlFlowSinceBlank: false,
    htmlSeamPending: false,
    phasePoisonedAt: Infinity,
    pendingTruncatedTags: [],
  };
}

/**
 * Rest-of-line check for a link definition after `[label]:`: a non-empty
 * destination (angle-bracketed or a bare non-whitespace run), then nothing
 * or a title that CLOSES on this line with nothing after it. Everything
 * else — no destination, non-title garbage, garbage after a closed title
 * (`"t"a`), or a title left OPEN at EOL (its continuation line may append
 * garbage that invalidates the whole def: `"t\nt2"a`, K=4 census) — is
 * rejected: the line is (or may become) a paragraph whose `[label]` stays
 * a live ref. Rejecting a real def only over-blocks (refs stay tainted);
 * registering a ghost under-blocks. Multi-line titles therefore never
 * register — the documented A2 conservative edge.
 */
function isPlausibleLinkDefRest(rest: string): boolean {
  const t = rest.trim();
  if (t === '') return false; // destination-less
  const destEnd = linkDestinationEnd(t);
  if (destEnd === -1) return false; // micromark rejects the destination → paragraph
  const after = t.slice(destEnd).trim();
  if (after === '') return true;
  const opener = after[0];
  if (opener !== '"' && opener !== "'" && opener !== '(') return false;
  const closer = opener === '(' ? ')' : opener;
  // Find the UNESCAPED closing delimiter; the def is valid only when it
  // exists on this line and nothing but whitespace follows it.
  for (let i = 1; i < after.length; i++) {
    if (after[i] === '\\') {
      i += 1;
      continue;
    }
    if (after[i] === closer) return after.slice(i + 1).trim() === '';
  }
  return false; // title still open at EOL
}

/**
 * micromark's link-destination grammar (micromark-factory-destination),
 * applied to a trimmed def rest. Returns the index just past the
 * destination, or -1 when micromark would REJECT it — the def line is then
 * a paragraph whose `[label]` stays a live shortcut ref. Two forms:
 *   - `<…>`: any characters except line endings and UNESCAPED `<` / `>`
 *     (whitespace is legal); unclosed at EOL → reject. `<>` is valid.
 *   - bare: a non-empty run without whitespace or ASCII control characters;
 *     unescaped parentheses must balance, and a `)` at balance zero ENDS
 *     the destination (whatever follows must then be a title or nothing).
 * The old check accepted any `<…>` with a `>` somewhere and any bare run —
 * `[a]: <u<v>` / `[a]: /u(x` registered GHOST defs that released reference
 * taint early (2026-08 project-review P1; ghost defs are the unsafe
 * direction — see the def-registration comment in processConfirmedLine).
 */
function linkDestinationEnd(t: string): number {
  if (t.startsWith('<')) {
    for (let i = 1; i < t.length; i++) {
      const ch = t[i];
      // `enclosedEscape`: a backslash only escapes `<`, `>`, `\`; before
      // anything else it is a literal backslash and the next character is
      // judged on its own.
      if (ch === '\\' && (t[i + 1] === '<' || t[i + 1] === '>' || t[i + 1] === '\\')) {
        i += 1;
        continue;
      }
      if (ch === '>') return i + 1;
      if (ch === '<') return -1;
    }
    return -1; // unclosed angle destination
  }
  let balance = 0;
  let i = 0;
  for (; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (code === 0x20 || code === 0x09) break; // whitespace ends the run
    if (code < 0x20 || code === 0x7f) return -1; // ASCII control
    const ch = t[i];
    // `rawEscape`: only `(`, `)`, `\` are escapable; `\ ` is a literal
    // backslash followed by whitespace, which ENDS the run (review probe:
    // skipping any next char swallowed the space and registered a ghost).
    if (ch === '\\' && (t[i + 1] === '(' || t[i + 1] === ')' || t[i + 1] === '\\')) {
      i += 1;
      continue;
    }
    if (ch === '(') balance += 1;
    else if (ch === ')') {
      if (balance === 0) break; // ends the destination
      balance -= 1;
    }
  }
  if (balance !== 0 || i === 0) return -1;
  return i;
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
  // A checkpoint encodes profile-dependent state (math phase, ref taint
  // tables) — resuming under a DIFFERENT profile would mix grammars, so
  // every switch participates in the invalidation check.
  const cp =
    resume &&
    resume.defListEnabled === options.defListEnabled &&
    resume.mathFlow === mathFlow &&
    resume.referenceTaint === referenceTaint &&
    resume.confirmedOffset <= text.length
      ? resume
      : freshCheckpoint(options.defListEnabled, mathFlow, referenceTaint);

  // ── advance the checkpoint over newly-CONFIRMED lines ──
  let start = cp.confirmedOffset;
  let tailLine: LineRec | null = null;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const confirmed = end < text.length;
    const lineText = text.slice(start, end);
    const ln: LineRec = {
      start,
      end,
      text: lineText,
      blank: confirmed && lineText.trim() === '',
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

  // ── settle references (monotone: entries only ever leave) ──
  if (cp.unresolvedRefs.length > 0) {
    const settled = (defEnd: number): boolean => cp.lastBlankStart >= defEnd;
    cp.unresolvedRefs = cp.unresolvedRefs.filter((ref) => {
      const table = ref.footnote ? cp.footnoteDefs : cp.defs;
      const defEnd = table.get(ref.label);
      return defEnd === undefined || !settled(defEnd);
    });
  }
  let earliestUnresolved = Infinity;
  for (const ref of cp.unresolvedRefs) earliestUnresolved = Math.min(earliestUnresolved, ref.offset);

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
  let boundary = 0;
  for (let i = cp.candidates.length - 1; i >= 0; i--) {
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
function processConfirmedLine(cp: FreezeScanCheckpoint, ln: LineRec, text: string): void {
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
    cp.htmlSeamPending &&
    !ln.blank &&
    !cp.htmlFlowSinceBlank &&
    !(cp.commentOpen || cp.piOpen || cp.declOpen || cp.cdataOpen)
  ) {
    const defShapedLine = DEF_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text);
    const commentOnly =
      ln.text
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<!--[\s\S]*$/, ' ')
        .trim() === '';
    if (!defShapedLine && !commentOnly) {
      cp.htmlSeamPending = false;
    }
  }
  const applyTag = (tag: string, closing: boolean): void => {
    if (closing) {
      const count = cp.tagBalance.get(tag) ?? 0;
      if (count > 0) {
        cp.tagBalance.set(tag, count - 1);
        cp.openTotal -= 1;
      }
    } else {
      cp.tagBalance.set(tag, (cp.tagBalance.get(tag) ?? 0) + 1);
      cp.openTotal += 1;
    }
  };

  // A type 2-5 raw construct (comment/PI/decl/CDATA) open at the START of
  // this line makes the whole line html-block content — the construct's
  // block ends WITH the line carrying its terminator, so even that line's
  // remainder is raw text. Gates fence/math opens, masking, and def
  // registration below, alongside the tag-block flag (htmlFlowSinceBlank).
  const commentOpenAtLineStart = cp.commentOpen;
  const rawOpenAtLineStart = cp.commentOpen || cp.piOpen || cp.declOpen || cp.cdataOpen;

  // --- fence state (interiors are candidate-free; paragraph resets) ---
  if (cp.inFence) {
    const close = FENCE_RE.exec(ln.text);
    if (close && close[1][0] === cp.fenceChar && close[1].length >= cp.fenceLen && ln.text.trim() === close[1]) {
      cp.inFence = false;
      cp.fenceChar = '';
      cp.fenceLen = 0;
    }
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    return;
  }
  if (!cp.inMath && !rawOpenAtLineStart) {
    const open = FENCE_RE.exec(ln.text);
    // A backtick fence's info string may not contain a backtick —
    // ```a``` b is a PARAGRAPH with a code span, not a fence open (A5).
    const bogusInfo =
      open !== null && open[1][0] === '`' && ln.text.slice(ln.text.indexOf(open[1]) + open[1].length).includes('`');
    if (open && !bogusInfo && cp.htmlFlowSinceBlank) {
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
      cp.inFence = true;
      cp.fenceChar = open[1][0];
      cp.fenceLen = open[1].length;
      cp.openIndent = ln.indent;
      cp.blankRun = 0;
      cp.paragraphHasUnpairedRun = false;
      cp.prevLineBlank = false;
      cp.prevLineWasText = false;
      cp.prevLineWasValidDef = false;
      return;
    }
  }

  // --- $$ flow-math state (fence-like: no candidates, close at line start;
  // the closing run must be at least as long as the opening one, with
  // nothing but whitespace after) ---
  if (cp.inMath) {
    const close = MATH_RUN_RE.exec(ln.text);
    if (close && close[1].length >= cp.mathFenceLen && ln.text.trim() === close[1]) {
      cp.inMath = false;
      cp.mathFenceLen = 0;
    }
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    return;
  }
  // Fence/math OPENS are gated on !htmlFlowSinceBlank (matching the fence
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
      if (cp.htmlFlowSinceBlank) {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start);
      } else {
        if (isBlockStart) {
          const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
          if (verdict !== null) cp.hazardVerdict = verdict;
        }
        cp.inMath = true;
        cp.mathFenceLen = mathRun[1].length;
        cp.openIndent = ln.indent;
        cp.blankRun = 0;
        cp.paragraphHasUnpairedRun = false;
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
    cp.blankRun += 1;
    cp.lastBlankStart = ln.start;
    cp.candidates.push({
      offset: Math.min(ln.end + 1, text.length),
      blankRun: cp.blankRun,
      htmlBalanced: cp.openTotal === 0 && !cp.commentOpen && !cp.piOpen && !cp.declOpen && !cp.cdataOpen,
      hazard: cp.hazardVerdict,
      seamRisk: cp.htmlSeamPending,
      defListSettled: null,
    });
    cp.paragraphHasUnpairedRun = false;
    cp.htmlFlowSinceBlank = false;
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
  const tagStart = ln.indent <= 3 ? /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(ln.text.trimStart()) : null;
  if (tagStart) {
    cp.htmlFlowSinceBlank = true;
    if (!TYPE6_NAMES.has(tagStart[1].toLowerCase())) cp.hazardVerdict = true;
  }
  const inRawText = cp.htmlFlowSinceBlank || rawOpenAtLineStart;
  // A type 2-5 html block (`<!--` / `<?` / `<!X` / `<![CDATA[`) STARTING on
  // this line at block indent. Not sticky (V9 — the block ends with its
  // terminator's line), and not `inRawText` unless the construct stays
  // open past EOL — but when it opens AND closes on this line, the bytes
  // after the closer are still this html block's raw content: floating
  // remnant with the blocker-6 tail-dependent seam (`<!-- c --> tail`
  // followed by a def line that a later append turns into a paragraph —
  // direction-battery counterexample surfaced by the overlapping-
  // terminator generator family, 2026-08). Feeds the blocker-6 check only.
  const rawFlowStart = ln.indent <= 3 && /^<(?:!--|\?|![A-Za-z]|!\[CDATA\[)/.test(ln.text.trimStart());

  // Same-line code-span masking for HTML/ref/footnote extraction. A null
  // mask means "unsafe to mask here" — scan the raw text (over-blocking).
  const { masked, unpaired } = inRawText
    ? { masked: null, unpaired: false }
    : maskIntraLineCodeSpans(ln.text, cp.paragraphHasUnpairedRun);
  if (unpaired) cp.paragraphHasUnpairedRun = true;
  const scanText = masked ?? ln.text;

  // Blocker 5: definitions (block-start or def-chain only — A2) and refs.
  // Inside an html flow run a def-shaped line is RAW TEXT — micromark never
  // registers it. Registering a ghost def is the UNSAFE direction twice
  // over: it releases reference taint early AND makes the footnote replay
  // inject a definition the real parse does not have (fuzz-arbiter
  // counterexample). Refs stay extracted regardless: extra candidates only
  // over-taint.
  const defShaped = inRawText ? null : DEF_RE.exec(scanText);
  // micromark requires a NON-EMPTY destination followed by nothing but an
  // optional TITLE for a link definition. A bare `[label]:` line, or one
  // with non-title garbage after the destination (`[x]: /u[x]: /u` — K=4
  // census counterexamples), is a PARAGRAPH whose `[label]` stays a live
  // shortcut ref that a LATER real def can retarget. Rejecting a real def
  // here only over-blocks (refs stay tainted); registering a ghost
  // under-blocks. Footnote defs legitimately have empty bodies.
  const def =
    defShaped !== null &&
    (defShaped[1].startsWith('^') || isPlausibleLinkDefRest(scanText.slice(defShaped.index + defShaped[0].length)))
      ? defShaped
      : null;
  const defLineStart = isBlockStart || !cp.prevLineWasText || cp.prevLineWasValidDef;
  const validDef = def !== null && defLineStart;
  if (validDef) {
    const label = def![1];
    if (label.startsWith('^')) {
      const key = normalizeLabel(label.slice(1));
      if (key && !cp.footnoteDefs.has(key)) cp.footnoteDefs.set(key, ln.end);
    } else {
      const key = normalizeLabel(label);
      if (key && !cp.defs.has(key)) cp.defs.set(key, ln.end);
    }
  }
  // Blocker 5 collection is skipped entirely under referenceTaint=false
  // (the def-label scanner profile): definition IDENTITY is a block-level
  // fact independent of how inline references resolve, and taint would
  // collapse the boundary to the body's first citation while a def footer
  // streams (defs settle only after a trailing blank line).
  if (cp.referenceTaint && scanText.includes('[')) {
    // `[label]:` is only definition-shaped when THIS line registers it as a
    // def (the label bracket of validDef). On a paragraph CONTINUATION line
    // the same bytes are literal text where micromark still parses `[label]`
    // as a shortcut reference — skipping it there under-taints and lets a
    // later definition retarget frozen output (fuzz counterexample: a def
    // line glued under a paragraph). Extra candidates only over-taint.
    const defBracket = validDef ? def!.index + def![0].indexOf('[') : -1;
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(scanText)) !== null) {
      const follow = scanText[m.index + m[0].length];
      if (follow === '(') continue; // inline link/image
      if (follow === ':' && m.index === defBracket) continue; // the def's own label
      const inner = m[1];
      let label: string;
      let footnote = false;
      if (inner.startsWith('^')) {
        footnote = true;
        label = normalizeLabel(inner.slice(1));
      } else if (follow === '[') {
        const explicit = /^\[((?:[^[\]\\]|\\.)*)\]/.exec(scanText.slice(m.index + m[0].length));
        label = normalizeLabel(explicit && explicit[1] ? explicit[1] : inner);
      } else {
        // Shortcut reference candidate. Plain prose brackets ("[sic]") land
        // here too — a future definition COULD retarget them, so they count.
        label = normalizeLabel(inner);
      }
      if (!label) continue;
      cp.unresolvedRefs.push({ offset: ln.start + m.index, label, footnote });
    }
  }

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
  while (pos < scanText.length) {
    if (cp.piOpen) {
      const c = scanText.indexOf('?>', pos);
      const gt = scanText.indexOf('>', pos);
      if (gt !== -1 && (c === -1 || gt !== c + 1)) poisonRawDivergence();
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 2]);
      cp.piOpen = false;
      pos = c + 2;
      continue;
    }
    if (cp.cdataOpen) {
      const c = scanText.indexOf(']]>', pos);
      const gt = scanText.indexOf('>', pos);
      if (gt !== -1 && (c === -1 || gt !== c + 2)) poisonRawDivergence();
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 3]);
      cp.cdataOpen = false;
      pos = c + 3;
      continue;
    }
    if (cp.declOpen) {
      const c = scanText.indexOf('>', pos);
      if (c === -1) {
        rawSpans.push([pos, scanText.length]);
        break;
      }
      rawSpans.push([pos, c + 1]);
      cp.declOpen = false;
      pos = c + 1;
      continue;
    }
    const pi = scanText.indexOf('<?', pos);
    const cd = scanText.indexOf('<![CDATA[', pos);
    // `<!` + letter = declaration; `<!--` (third char '-') and
    // `<![CDATA[` (third char '[') never match this.
    const dm = scanText.slice(pos).search(/<![A-Za-z]/);
    const decl = dm === -1 ? -1 : pos + dm;
    const starts = [pi, cd, decl].filter((x) => x !== -1);
    if (starts.length === 0) break;
    const first = Math.min(...starts);
    if (first === cd) {
      rawSpans.push([cd, cd + 9]);
      cp.cdataOpen = true;
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
        if (scanText.slice(0, pi).trim() !== '' || ln.indent > 3) poisonRawDivergence();
        continue;
      }
      rawSpans.push([pi, pi + 2]);
      cp.piOpen = true;
      pos = pi + 2;
    } else {
      rawSpans.push([decl, decl + 2]);
      cp.declOpen = true;
      pos = decl + 2;
    }
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
  {
    TAG_OR_COMMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastCommentOpenerIdx = -1;
    while ((m = TAG_OR_COMMENT_RE.exec(tagText)) !== null) {
      if (m[0] === '<!--') {
        const next = tagText.slice(m.index + 4, m.index + 6);
        if (cp.commentOpen) {
          // Inside an OPEN comment `<!--` is content — but the regex
          // consumed its `--`, which may be the start of the closer:
          // `<!-->` / `<!--->` carry a `-->` (closes for both grammars;
          // soak seed 20260759: `<!--\n\n<!-->\n<details>` left the
          // comment open and skipped the real `<details>`), `<!--!>` /
          // `<!---!>` carry a `--!>` (parse5-only closer → poison).
          if (next.startsWith('>') || next === '->') cp.commentOpen = false;
          else if (next === '!>' || next === '-!') poisonRawDivergence();
          continue;
        }
        if (next.startsWith('>') || next === '->') {
          // Empty comment with an overlapping closer (see the note above
          // TAG_OR_COMMENT_RE) — closed on the spot; the regex resumes after `<!--`,
          // where the leftover `>` / `->` matches nothing.
          continue;
        }
        cp.commentOpen = true;
        lastCommentOpenerIdx = m.index;
        continue;
      }
      if (m[0] === '-->') {
        cp.commentOpen = false;
        continue;
      }
      if (m[0] === '--!>') {
        // parse5 accepts `--!>` as a comment closer; CommonMark does not
        // (`<!--x--!>\n<details>\n-->` is one html block to micromark
        // whose `<details>` is a REAL open element to parse5). Same
        // two-grammar split as the raw-construct divergence above → poison
        // from this line, keep the micromark model (comment stays open).
        if (cp.commentOpen) poisonRawDivergence();
        continue;
      }
      if (cp.commentOpen) continue;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const selfClosing = m[3] !== undefined && /\/\s*$/.test(m[3]);
      if (VOID_TAGS.has(tag) || selfClosing) continue;
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
    if (cp.commentOpen && lastCommentOpenerIdx !== -1 && !inRawText) {
      if (tagText.slice(0, lastCommentOpenerIdx).trim() !== '') {
        cp.phasePoisonedAt = Math.min(cp.phasePoisonedAt, ln.start + lastCommentOpenerIdx);
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
        if (startMasked || wholeVisible || inRaw(mr.index) || cp.commentOpen) continue;
        const closing = mr[1] === '/';
        const tag = mr[2].toLowerCase();
        const selfClosing = mr[3] !== undefined && /\/\s*$/.test(mr[3]);
        if (VOID_TAGS.has(tag) || selfClosing) continue;
        applyTag(tag, closing);
      }
    }
    // A `>` anywhere on this line confirms every pending truncated open
    // (attributes may wrap; the tag really is a tag — keep it counted).
    // Checked on the RAW line: a `>` inside a masked code span may still be
    // the tag's own closer (`<div x="\`">b\``: micromark parses the tag
    // first, the span never forms) — v2.4.0 review R2(a).
    if (cp.pendingTruncatedTags.length > 0 && ln.text.includes('>')) {
      cp.pendingTruncatedTags = [];
    }
    // Line-truncated tag start — anchor on the LAST `<` of the line.
    if (!cp.commentOpen) {
      const lastLt = tagText.lastIndexOf('<');
      if (lastLt !== -1 && !tagText.includes('>', lastLt)) {
        const m2 = TRUNCATED_TAG_RE.exec(tagText.slice(lastLt));
        if (m2) {
          const closing = m2[1] === '/';
          const tag = m2[2].toLowerCase();
          if (!VOID_TAGS.has(tag)) {
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
      cp.htmlSeamPending = true;
    }
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
  cp.prevLineWasValidDef = validDef && !def![1].startsWith('^');
}
