/**
 * Freeze-boundary detector for incremental (prefix-freeze) parsing.
 *
 * Production port of the "L4" rule validated by the measurement study in
 * `src/experiments/prefixFreeze/` (see its README for the ablation ladder
 * and falsification results — that directory stays frozen as the record;
 * this module is the shipped implementation).
 *
 * The boundary is the largest source offset `b` such that, for ANY future
 * append to `text`, the markdown blocks that begin before `b` parse
 * byte-identically. Candidates are confirmed blank lines outside fenced
 * code; a candidate survives only if every blocker below clears:
 *
 * 1. **Raw-HTML balance** — an unclosed container tag (or `<!--` comment)
 *    before the candidate lets rehype-raw reparent later top-level siblings
 *    into it (the v1.5.1 swallow bug, commit a8e89ec). Tag balance is
 *    tracked outside fences; while any tag or comment is open, candidates
 *    are blocked.
 * 2. **`$$` flow math** — remark-math's flow math swallows blank lines and
 *    runs to EOF when unclosed (verified empirically), so candidates inside
 *    an open `$$` block are blocked.
 * 3. **Continuation context** — CommonMark lists and footnote definitions
 *    are NOT terminated by blank lines; later indented lines can extend a
 *    block that "ended" before the candidate. With the definition-list
 *    extension enabled, `: description` bodies behave the same way.
 * 4. **Definition-list term claim** (`options.defListEnabled`) — the
 *    micromark definition-list extension scans BACKWARD across exactly one
 *    blank line to claim a preceding paragraph as a `<dt>` (verified in
 *    micromark-extension-definition-list syntax.js: `blanklines >= 1`
 *    breaks the scan). A candidate whose blank run is 1 is therefore only
 *    safe once the next line is confirmed to never match `^ {0,3}:[ \t]`;
 *    runs of ≥ 2 blanks are immune.
 * 5. **Reference taint** — micromark decides reference-ness at parse time,
 *    so a later `[label]:` definition retargets earlier literal `[text]`
 *    (the same fact behind the phantom-def preparse constraint). Every
 *    reference-style candidate before the boundary must resolve against a
 *    SETTLED definition (one followed by a confirmed blank line — a def
 *    block cannot contain blank lines, so a blank after it proves the def
 *    can no longer grow). Labels are matched with micromark's own
 *    `normalizeIdentifier` (Unicode case folding — `toLowerCase` would
 *    accept fold-equal/lowercase-distinct pairs as resolved when micromark
 *    treats them as distinct, an unsafe direction).
 *
 * A line only counts as blank once its terminating newline exists: the
 * trailing partial line is UNCONFIRMED (the next chunk may append content
 * to it) and treating it as blank breaks boundary monotonicity.
 *
 * The scan is a single O(N) string pass per snapshot; at streaming call
 * rates this is negligible next to parsing (measured in the experiment).
 * An incremental committed-state scanner is possible future work.
 *
 * Footnotes are NOT handled here: the caller (advanceIncrementalParse G2)
 * bypasses incremental parsing entirely when the content contains `[^`,
 * because single-doc footnote numbering is parse-local.
 */

import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

export interface FreezeBoundaryOptions {
  /** Whether remark-definition-list is in the active plugin chain (config
   *  `extraSyntaxSupported` includes DEFINITION_LIST). Enables blockers 3b/4. */
  defListEnabled: boolean;
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
/** Opening/closing tags (name must be followed by attr/close syntax, which
 *  excludes autolinks like `<https://…>`), plus comment delimiters. */
const TAG_OR_COMMENT_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])([^>]*)>|<!--|-->/g;
/** A tag START whose `>` has not arrived on this line — `<div` at EOL, or
 *  `<div class="a"` with attributes continuing on the next line. CommonMark
 *  opens a type-6 html block for `<div` + EOL, and micromark's html-text
 *  allows a line ending inside attribute whitespace, so parse5 later sees
 *  the COMPLETE tag and the container swallows following siblings — the
 *  single-line regex above misses exactly this shape (caught by the
 *  splice-equivalence arbiter as 6 mismatching frames). Counted as an open
 *  tag; a false positive (prose like `a<b` at EOL) only costs freeze
 *  coverage, never correctness. */
const TRUNCATED_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)([^<>]*)$/;
/** Bracketed inline candidate: link/image reference or shortcut. No nesting
 *  support — plain prose brackets count as taint (conservative direction). */
const REF_RE = /!?\[((?:[^[\]\\]|\\.)*)\]/g;

type LineKind = 'text' | 'fence-open' | 'fence-inner' | 'math-open' | 'math-inner';

interface LineRec {
  start: number;
  end: number; // offset of the terminating \n, or text.length for the last line
  text: string;
  blank: boolean;
  indent: number; // leading whitespace width, tab = 4 (approximation)
  kind: LineKind;
}

interface Candidate {
  /** Freeze boundary: start of the line after this blank line. */
  offset: number;
  /** Consecutive confirmed blank lines (outside fences) ending at this line. */
  blankRun: number;
  /** Blank line sits inside an unclosed `$$` flow-math block. */
  inMath: boolean;
  /** No unbalanced HTML container / unclosed comment before this point. */
  htmlBalanced: boolean;
  lineIndex: number;
}

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
 * Blocker 3: walk upward from the candidate's blank line classifying
 * block-start lines:
 *  - list marker / footnote def (/ defList `: ` when enabled) at indent ≤ 3
 *    → hazard (their content can be extended by later indented lines,
 *    across any number of blank lines)
 *  - non-marker block start at indent 0 → safe (a column-0 paragraph
 *    terminates any list context)
 *  - indent 1–3 non-marker, or indent ≥ 4 → ambiguous (could itself be
 *    list-item continuation / indented code inside an item) — keep walking
 * Fence/math interior lines are skipped; their OPEN line is classified like
 * a normal block start (a column-0 fence also terminates a list context).
 */
function hasContinuationHazard(lines: LineRec[], candidateLineIndex: number, defListEnabled: boolean): boolean {
  for (let i = candidateLineIndex; i >= 0; i--) {
    const ln = lines[i];
    if (ln.blank || ln.kind === 'fence-inner' || ln.kind === 'math-inner') continue;
    const isBlockStart = i === 0 || lines[i - 1].blank;
    if (!isBlockStart) continue;
    if (ln.indent >= 4) continue;
    if (LIST_MARKER_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text)) return true;
    if (defListEnabled && DEF_LIST_DD_RE.test(ln.text)) return true;
    if (ln.indent === 0) return false;
    // indent 1–3 non-marker: ambiguous — keep walking.
  }
  return false;
}

/**
 * Blocker 4: can the (possibly partial) line ever match `^ {0,3}:[ \t]`
 * after future appends? Appends only extend the line rightward, so a line
 * is settled once its existing characters already contradict the pattern.
 */
function canBecomeDdLine(line: LineRec, confirmed: boolean): boolean {
  const text = line.text;
  let i = 0;
  while (i < text.length && text[i] === ' ') i += 1;
  if (i > 3) return false; // indent too deep, regardless of future appends
  if (i === text.length) return !confirmed; // only spaces so far — a partial line may still grow a `:`
  if (text[i] !== ':') return false;
  if (i + 1 === text.length) return !confirmed; // trailing `:` — a partial line may still grow the space
  return text[i + 1] === ' ' || text[i + 1] === '\t';
}

/**
 * Blocker 5: earliest offset of a reference-style candidate that does not
 * resolve against a settled definition; Infinity when every reference is
 * settled. Fence/math interiors are masked. Inline code spans are NOT
 * masked (over-blocking, safe direction).
 */
function earliestUnresolvedReference(lines: LineRec[], lastBlankStart: number): number {
  const defs = new Map<string, number>(); // normalized label → def line end offset
  const footnoteDefs = new Map<string, number>();

  for (const ln of lines) {
    if (ln.kind !== 'text' || ln.blank) continue;
    const def = DEF_RE.exec(ln.text);
    if (!def) continue;
    const label = def[1];
    if (label.startsWith('^')) {
      const key = normalizeLabel(label.slice(1));
      if (key && !footnoteDefs.has(key)) footnoteDefs.set(key, ln.end);
    } else {
      const key = normalizeLabel(label);
      if (key && !defs.has(key)) defs.set(key, ln.end);
    }
  }

  // A definition block cannot contain blank lines, so a confirmed blank at
  // or after its first line's end proves the definition can no longer grow
  // (multi-line titles included: they must precede any blank).
  const settled = (defEnd: number): boolean => lastBlankStart >= defEnd;

  let earliest = Infinity;
  for (const ln of lines) {
    if (ln.kind !== 'text' || ln.blank) continue;
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(ln.text)) !== null) {
      const follow = ln.text[m.index + m[0].length];
      if (follow === '(' || follow === ':') continue; // inline link/image or definition
      const inner = m[1];
      let label: string;
      let footnote = false;
      if (inner.startsWith('^')) {
        footnote = true;
        label = normalizeLabel(inner.slice(1));
      } else if (follow === '[') {
        const explicit = /^\[((?:[^[\]\\]|\\.)*)\]/.exec(ln.text.slice(m.index + m[0].length));
        label = normalizeLabel(explicit && explicit[1] ? explicit[1] : inner);
      } else {
        // Shortcut reference candidate. Plain prose brackets ("[sic]") land
        // here too — a future definition COULD retarget them, so they count.
        label = normalizeLabel(inner);
      }
      if (!label) continue;
      const table = footnote ? footnoteDefs : defs;
      const defEnd = table.get(label);
      if (defEnd === undefined || !settled(defEnd)) {
        earliest = Math.min(earliest, ln.start + m.index);
      }
    }
  }
  return earliest;
}

/**
 * Largest freeze-safe boundary for `text` under the active configuration,
 * or 0 when nothing can be frozen. Monotonic under appends: for any
 * `text2` extending `text`, every blocker at a surviving candidate is
 * computed from the (unchanged) lines above it — except the defList
 * settled check and reference settlement, which can only flip from
 * blocked to clear as more input arrives.
 */
export function computeFreezeBoundary(text: string, options: FreezeBoundaryOptions): number {
  const lines: LineRec[] = [];
  {
    let start = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end === -1) end = text.length;
      const lineText = text.slice(start, end);
      lines.push({
        start,
        end,
        text: lineText,
        // Blank only once the terminating newline exists (see module docs).
        blank: lineText.trim() === '' && end < text.length,
        indent: computeIndent(lineText),
        kind: 'text',
      });
      start = end + 1;
    }
  }

  const candidates: Candidate[] = [];
  const tagBalance = new Map<string, number>();
  let openTotal = 0;
  let commentOpen = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inMath = false;
  let blankRun = 0;
  let lastBlankStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    // --- fence state ---
    if (inFence) {
      const close = FENCE_RE.exec(ln.text);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen && ln.text.trim() === close[1]) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      ln.kind = 'fence-inner';
      blankRun = 0; // a blank inside a fence never seeds a candidate run
      continue;
    }
    if (!inMath) {
      const open = FENCE_RE.exec(ln.text);
      if (open) {
        inFence = true;
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        ln.kind = 'fence-open';
        blankRun = 0;
        continue;
      }
    }

    // --- $$ flow-math state ---
    if (inMath) {
      ln.kind = 'math-inner';
      if (ln.text.includes('$$')) inMath = false;
      // Blank lines INSIDE math still produce candidates (flagged inMath)
      // so the state machine can observe them; they are filtered below.
    } else if (MATH_FENCE_RE.test(ln.text)) {
      const rest = ln.text.slice(ln.text.indexOf('$$') + 2);
      if (!rest.includes('$$')) {
        inMath = true;
        ln.kind = 'math-open';
        blankRun = 0;
        continue;
      }
    }

    // --- raw HTML balance (plain text lines outside fences/math only) ---
    if (ln.kind === 'text' && !ln.blank) {
      TAG_OR_COMMENT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG_OR_COMMENT_RE.exec(ln.text)) !== null) {
        if (m[0] === '<!--') {
          commentOpen = true;
          continue;
        }
        if (m[0] === '-->') {
          commentOpen = false;
          continue;
        }
        if (commentOpen) continue;
        const closing = m[1] === '/';
        const tag = m[2].toLowerCase();
        const selfClosing = m[3] !== undefined && /\/\s*$/.test(m[3]);
        if (VOID_TAGS.has(tag) || selfClosing) continue;
        if (closing) {
          const count = tagBalance.get(tag) ?? 0;
          if (count > 0) {
            tagBalance.set(tag, count - 1);
            openTotal -= 1;
          }
        } else {
          tagBalance.set(tag, (tagBalance.get(tag) ?? 0) + 1);
          openTotal += 1;
        }
      }
      // Line-truncated tag start (see TRUNCATED_TAG_RE). Only meaningful
      // when the trailing `<…` was not consumed by a complete tag above —
      // anchor on the LAST `<` of the line.
      if (!commentOpen) {
        const lastLt = ln.text.lastIndexOf('<');
        if (lastLt !== -1 && !ln.text.includes('>', lastLt)) {
          const m2 = TRUNCATED_TAG_RE.exec(ln.text.slice(lastLt));
          if (m2) {
            const closing = m2[1] === '/';
            const tag = m2[2].toLowerCase();
            if (!VOID_TAGS.has(tag)) {
              if (closing) {
                const count = tagBalance.get(tag) ?? 0;
                if (count > 0) {
                  tagBalance.set(tag, count - 1);
                  openTotal -= 1;
                }
              } else {
                tagBalance.set(tag, (tagBalance.get(tag) ?? 0) + 1);
                openTotal += 1;
              }
            }
          }
        }
      }
    }

    // --- blank-run accounting + candidate emission ---
    if (ln.blank) {
      blankRun += 1;
      if (!inMath) lastBlankStart = ln.start;
      candidates.push({
        offset: Math.min(ln.end + 1, text.length),
        blankRun,
        inMath,
        htmlBalanced: openTotal === 0 && !commentOpen,
        lineIndex: i,
      });
    } else {
      blankRun = 0;
    }
  }

  const earliestUnresolved = earliestUnresolvedReference(lines, lastBlankStart);

  /** Blocker 4: candidate at one blank must wait until the next block's
   *  first line is confirmed unable to become a `: description` line. */
  const defListSettled = (c: Candidate): boolean => {
    if (!options.defListEnabled || c.blankRun >= 2) return true;
    for (let i = c.lineIndex + 1; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.blank) return true; // a second blank makes the run ≥ 2 — the backward scan cannot cross it
      const confirmed = ln.end < text.length;
      return !canBecomeDdLine(ln, confirmed);
    }
    return false; // no next line yet — a future `: desc` could still claim the block above
  };

  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    if (c.inMath || !c.htmlBalanced) continue;
    if (c.offset > earliestUnresolved) continue;
    if (!defListSettled(c)) continue;
    if (hasContinuationHazard(lines, c.lineIndex, options.defListEnabled)) continue;
    return c.offset;
  }
  return 0;
}
