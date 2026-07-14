/**
 * Freeze-boundary detector for incremental (prefix-freeze) parsing.
 *
 * Production port of the "L4" rule validated by the measurement study in
 * `src/experiments/prefixFreeze/` (see its README for the ablation ladder,
 * the falsification results, and the intentional divergence note — the
 * shipped rule is strictly TIGHTER, pinned by detectorConsistency.test.ts).
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
 *    (`<div` at EOL, attributes wrapping) count as opens.
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
 * Footnote syntax is DETECTED here (fence-aware, mask-aware) but not
 * modeled: the caller bypasses splicing entirely while `hasFootnoteSyntax`
 * is set, because single-doc footnote numbering is parse-local.
 */

import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

export interface FreezeBoundaryOptions {
  /** Whether remark-definition-list is in the active plugin chain (config
   *  `extraSyntaxSupported` includes DEFINITION_LIST). Enables blockers 3b/4. */
  defListEnabled: boolean;
}

export interface FreezeScanResult {
  /** Largest freeze-safe boundary, or 0 when nothing can be frozen. */
  boundary: number;
  /** True when `[^` appears on a markdown TEXT line outside fences, math,
   *  and (provably intra-line) code spans. The caller bypasses splicing
   *  while this is true: single-doc footnote numbering is parse-local. */
  hasFootnoteSyntax: boolean;
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
  /** Index into the checkpoint's confirmed-lines array. */
  lineIndex: number;
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
  /** Start offset of the first line NOT yet baked into this checkpoint. */
  confirmedOffset: number;
  /** 1-based count guard: text.length the checkpoint was last advanced on. */
  lines: LineRec[];
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
  blankRun: number;
  lastBlankStart: number;
  hasFootnoteSyntax: boolean;
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
const MATH_FENCE_RE = /^ {0,3}\$\$/;
const MATH_CLOSE_RE = /^ {0,3}\$\$\s*$/;
/** Opening/closing tags (name must be followed by attr/close syntax, which
 *  excludes autolinks like `<https://…>`), plus comment delimiters. */
const TAG_OR_COMMENT_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])([^>]*)>|<!--|-->/g;
/** A tag START whose `>` has not arrived on this line — `<div` at EOL, or
 *  `<div class="a"` with attributes continuing on the next line. Counted as
 *  an open (probe-confirmed hazard); prose like `a<b` at EOL only costs
 *  freeze coverage, never correctness. */
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

function freshCheckpoint(defListEnabled: boolean): FreezeScanCheckpoint {
  return {
    defListEnabled,
    confirmedOffset: 0,
    lines: [],
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
    blankRun: 0,
    lastBlankStart: -1,
    hasFootnoteSyntax: false,
    hazardVerdict: false,
    prevLineBlank: true, // doc start counts as a block start
    prevLineWasText: false,
    prevLineWasValidDef: false,
    paragraphHasUnpairedRun: false,
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
  const cp =
    resume && resume.defListEnabled === options.defListEnabled && resume.confirmedOffset <= text.length
      ? resume
      : freshCheckpoint(options.defListEnabled);

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
      // all precede it. Only its footnote marker matters (monotone under
      // appends — the characters already exist). Fence/math interiors are
      // excluded by the current state.
      tailLine = ln;
      if (!cp.hasFootnoteSyntax && !cp.inFence && !cp.inMath && lineText.includes('[^')) {
        // Respect masking-safety: if the paragraph might carry an open code
        // span, treat `[^` as real (over-conservative, safe direction).
        const { masked } = maskIntraLineCodeSpans(lineText, cp.paragraphHasUnpairedRun);
        if ((masked ?? lineText).includes('[^')) cp.hasFootnoteSyntax = true;
      }
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

  // ── blocker 4: defList settled check (looks FORWARD from a candidate) ──
  const defListSettled = (c: Candidate): boolean => {
    if (!options.defListEnabled || c.blankRun >= 2) return true;
    for (let i = c.lineIndex + 1; i < cp.lines.length; i++) {
      const ln = cp.lines[i];
      if (ln.blank) return true; // a second blank makes the run ≥ 2 — the backward scan cannot cross it
      return !canBecomeDdLine(ln.text, true);
    }
    if (tailLine) return !canBecomeDdLine(tailLine.text, false);
    return false; // no next line yet — a future `: desc` could still claim the block above
  };

  // ── pick the last surviving candidate ──
  let boundary = 0;
  for (let i = cp.candidates.length - 1; i >= 0; i--) {
    const c = cp.candidates[i];
    if (!c.htmlBalanced || c.hazard) continue;
    if (c.offset > earliestUnresolved) continue;
    if (!defListSettled(c)) continue;
    boundary = c.offset;
    break;
  }

  return { boundary, hasFootnoteSyntax: cp.hasFootnoteSyntax, checkpoint: cp };
}

/** Bake one confirmed line into the checkpoint. */
function processConfirmedLine(cp: FreezeScanCheckpoint, ln: LineRec, text: string): void {
  cp.lines.push(ln);
  const isBlockStart = cp.prevLineBlank;
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
  if (!cp.inMath) {
    const open = FENCE_RE.exec(ln.text);
    // A backtick fence's info string may not contain a backtick —
    // ```a``` b is a PARAGRAPH with a code span, not a fence open (A5).
    const bogusInfo =
      open !== null && open[1][0] === '`' && ln.text.slice(ln.text.indexOf(open[1]) + open[1].length).includes('`');
    if (open && !bogusInfo) {
      // The open line is a block start for blocker 3 (a column-0 fence
      // terminates a list context; an indented one is ambiguous/hazard).
      if (isBlockStart) {
        const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
        if (verdict !== null) cp.hazardVerdict = verdict;
      }
      cp.inFence = true;
      cp.fenceChar = open[1][0];
      cp.fenceLen = open[1].length;
      cp.blankRun = 0;
      cp.paragraphHasUnpairedRun = false;
      cp.prevLineBlank = false;
      cp.prevLineWasText = false;
      cp.prevLineWasValidDef = false;
      return;
    }
  }

  // --- $$ flow-math state (fence-like: no candidates, close at line start) ---
  if (cp.inMath) {
    if (MATH_CLOSE_RE.test(ln.text)) cp.inMath = false;
    cp.blankRun = 0;
    cp.paragraphHasUnpairedRun = false;
    cp.prevLineBlank = false;
    cp.prevLineWasText = false;
    cp.prevLineWasValidDef = false;
    return;
  }
  if (MATH_FENCE_RE.test(ln.text)) {
    const rest = ln.text.slice(ln.text.indexOf('$$') + 2);
    if (!rest.includes('$$')) {
      if (isBlockStart) {
        const verdict = classifyBlockStart(ln.text, ln.indent, cp.defListEnabled);
        if (verdict !== null) cp.hazardVerdict = verdict;
      }
      cp.inMath = true;
      cp.blankRun = 0;
      cp.paragraphHasUnpairedRun = false;
      cp.prevLineBlank = false;
      cp.prevLineWasText = false;
      cp.prevLineWasValidDef = false;
      return;
    }
  }

  // --- blank line: candidate emission + paragraph reset ---
  if (ln.blank) {
    cp.blankRun += 1;
    cp.lastBlankStart = ln.start;
    cp.candidates.push({
      offset: Math.min(ln.end + 1, text.length),
      blankRun: cp.blankRun,
      htmlBalanced: cp.openTotal === 0 && !cp.commentOpen && !cp.piOpen && !cp.declOpen && !cp.cdataOpen,
      hazard: cp.hazardVerdict,
      lineIndex: cp.lines.length - 1,
    });
    cp.paragraphHasUnpairedRun = false;
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
  }

  // Same-line code-span masking for HTML/ref/footnote extraction. A null
  // mask means "unsafe to mask here" — scan the raw text (over-blocking).
  const { masked, unpaired } = maskIntraLineCodeSpans(ln.text, cp.paragraphHasUnpairedRun);
  if (unpaired) cp.paragraphHasUnpairedRun = true;
  const scanText = masked ?? ln.text;

  if (!cp.hasFootnoteSyntax && scanText.includes('[^')) cp.hasFootnoteSyntax = true;

  // Blocker 5: definitions (block-start or def-chain only — A2) and refs.
  const def = DEF_RE.exec(scanText);
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
  if (scanText.includes('[')) {
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(scanText)) !== null) {
      const follow = scanText[m.index + m[0].length];
      if (follow === '(' || follow === ':') continue; // inline link/image or definition
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
  const rawOpenAtStart = cp.piOpen || cp.declOpen || cp.cdataOpen;
  let pos = 0;
  while (pos < scanText.length) {
    if (cp.piOpen) {
      const c = scanText.indexOf('?>', pos);
      if (c === -1) break;
      cp.piOpen = false;
      pos = c + 2;
      continue;
    }
    if (cp.cdataOpen) {
      const c = scanText.indexOf(']]>', pos);
      if (c === -1) break;
      cp.cdataOpen = false;
      pos = c + 3;
      continue;
    }
    if (cp.declOpen) {
      const c = scanText.indexOf('>', pos);
      if (c === -1) break;
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
      cp.cdataOpen = true;
      pos = cd + 9;
    } else if (first === pi) {
      cp.piOpen = true;
      pos = pi + 2;
    } else {
      cp.declOpen = true;
      pos = decl + 2;
    }
  }
  const rawOpenAtEnd = cp.piOpen || cp.declOpen || cp.cdataOpen;
  // Tag scan is skipped while a raw construct spans this line — the content
  // is data, not markup. (A tag BEFORE a still-open opener on the same line
  // is missed — accepted edge.)
  if (!rawOpenAtStart && !rawOpenAtEnd) {
    TAG_OR_COMMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_OR_COMMENT_RE.exec(scanText)) !== null) {
      if (m[0] === '<!--') {
        cp.commentOpen = true;
        continue;
      }
      if (m[0] === '-->') {
        cp.commentOpen = false;
        continue;
      }
      if (cp.commentOpen) continue;
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const selfClosing = m[3] !== undefined && /\/\s*$/.test(m[3]);
      if (VOID_TAGS.has(tag) || selfClosing) continue;
      applyTag(tag, closing);
    }
    // Line-truncated tag start — anchor on the LAST `<` of the line.
    if (!cp.commentOpen) {
      const lastLt = scanText.lastIndexOf('<');
      if (lastLt !== -1 && !scanText.includes('>', lastLt)) {
        const m2 = TRUNCATED_TAG_RE.exec(scanText.slice(lastLt));
        if (m2) {
          const closing = m2[1] === '/';
          const tag = m2[2].toLowerCase();
          if (!VOID_TAGS.has(tag)) applyTag(tag, closing);
        }
      }
    }
  }

  cp.blankRun = 0;
  cp.prevLineBlank = false;
  cp.prevLineWasText = true;
  cp.prevLineWasValidDef = validDef;
}
