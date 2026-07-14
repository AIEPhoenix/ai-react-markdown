/**
 * EXPERIMENT — prefix-freeze boundary detector. Pure measurement code: not
 * imported by `src/index.tsx`, never bundled, no runtime behavior change.
 *
 * Context: `@ant-design/x-markdown-mini` achieves O(N) cumulative streaming
 * parse cost by freezing a "stable prefix" at the last blank-line boundary
 * outside fenced code and re-lexing only the tail. Its safety rests on three
 * properties our pipeline does NOT have: a forgiving lexer (marked), no
 * cross-segment semantics (footnotes are contractually excluded from that
 * library), and no raw-HTML reparenting (we run rehype-raw — see the v1.5.1
 * swallow fix, commit a8e89ec). This module asks: what boundary rule WOULD
 * be safe for our CommonMark/unified pipeline, and how much of the document
 * could it actually freeze?
 *
 * Tiers under test (an ablation ladder, not a strict subset chain):
 *
 *   L0  last blank line outside fenced code
 *       — the rule as CLAIMED by the x-markdown-mini blog post ("空行收尾").
 *   L1  last DOUBLE blank line outside fenced code
 *       — the rule x-markdown-mini actually ships (StreamingProcessor's
 *         `isBlank && prevBlank`).
 *   L2  L1 + blockers: unbalanced raw HTML container / unclosed HTML comment
 *       / unclosed `$$` flow math before the candidate.
 *       — the v1.5.1 lesson: an unclosed `<details>` makes rehype-raw
 *         reparent every later top-level sibling into it, so prefix TEXT
 *         stability does not imply prefix OUTPUT stability.
 *   L3  SINGLE blank line + L2's blockers + continuation-context blocker:
 *       the candidate must not sit inside a list / footnote-definition
 *       context, because CommonMark lists are NOT terminated by blank lines
 *       (even two) — later indented lines can retroactively extend a block
 *       that ended before the boundary.
 *       — hypothesis: once the hazards are blocked explicitly, the double
 *         blank requirement (which typical single-blank-separated LLM output
 *         almost never satisfies) can be dropped.
 *   L4  L3 + reference-taint blocker: every reference-style candidate in the
 *       prefix ([text][label], [text][], [text] shortcut, ![alt][label],
 *       [^footnote]) must already resolve against a SETTLED definition.
 *       micromark decides reference-ness at parse time, so a definition
 *       arriving later retargets earlier literal text (the same fact behind
 *       the phantom-def preparse constraint). A definition is "settled" once
 *       a blank line follows it — i.e. its own block can no longer grow.
 *       — L4 is the candidate production rule. The falsification harness in
 *         the test file is the arbiter: a violation there means the tier is
 *         unsafe as implemented.
 *
 * The detector is string-level and single-pass per snapshot. A production
 * implementation would keep incremental committed state (x-markdown-mini's
 * `committedLen`/`committedInFence` pattern); for measurement, rescanning
 * each snapshot keeps the code trivially auditable.
 *
 * Known approximations (APPROX markers below), all in the conservative
 * (over-blocking) direction except where noted:
 *  - inline code spans are not masked, so `` `<div>` `` or `` `[x]` `` in
 *    prose can trip the HTML/reference blockers (over-block).
 *  - HTML tags spanning multiple source lines are not recognized
 *    (under-block; rare in LLM output).
 *  - link-reference definitions with multi-line titles are treated as
 *    single-line (their continuation can escape the settled check).
 *  - only line-leading `$$` toggles flow math; inline `$$…$$` pairs on one
 *    line are treated as self-closing.
 */

export const FREEZE_TIERS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type FreezeTier = (typeof FREEZE_TIERS)[number];
/** Boundary per tier: source offset before which the tier claims stability. 0 = nothing freezable. */
export type FreezeBoundaries = Record<FreezeTier, number>;

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
/** Any link/footnote reference definition at block indent. */
const DEF_RE = /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_FENCE_RE = /^ {0,3}\$\$/;
/** Opening/closing tags (name must be followed by attr/close syntax, which excludes autolinks like `<https://…>`), plus comment delimiters. */
const TAG_OR_COMMENT_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])([^>]*)>|<!--|-->/g;
/** Bracketed inline candidate: link/image reference or shortcut. No nesting support (APPROX). */
const REF_RE = /!?\[((?:[^[\]\\]|\\.)*)\]/g;

type LineKind = 'text' | 'fence-open' | 'fence-inner' | 'math-open' | 'math-inner';

interface LineRec {
  start: number;
  end: number; // offset of the terminating \n, or text.length for the last line
  text: string;
  blank: boolean;
  indent: number; // leading whitespace width, tab = 4 (APPROX)
  kind: LineKind;
}

interface Candidate {
  /** Freeze boundary: start of the line after this blank line (or EOF). */
  offset: number;
  /** Consecutive blank lines (outside fences) ending at this line. */
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
  return label
    .trim()
    .replace(/[ \t\r\n]+/g, ' ')
    .toLowerCase();
}

/**
 * The continuation-context blocker (L3+). Walks upward from the candidate's
 * blank line classifying block-start lines:
 *  - list marker / footnote def at indent ≤ 3   → hazard (their content can
 *    be extended by later indented lines, across any number of blank lines)
 *  - non-marker block start at indent 0         → safe (a column-0 paragraph
 *    terminates any list context)
 *  - indent 1–3 non-marker, or indent ≥ 4       → ambiguous (could itself be
 *    list-item continuation / indented code inside an item) — keep walking
 * Fence/math interior lines are skipped; their OPEN line is classified like
 * a normal block start (a column-0 fence also terminates a list context).
 */
function hasContinuationHazard(lines: LineRec[], candidateLineIndex: number): boolean {
  for (let i = candidateLineIndex; i >= 0; i--) {
    const ln = lines[i];
    if (ln.blank || ln.kind === 'fence-inner' || ln.kind === 'math-inner') continue;
    const isBlockStart = i === 0 || lines[i - 1].blank;
    if (!isBlockStart) continue;
    if (ln.indent >= 4) continue;
    if (LIST_MARKER_RE.test(ln.text) || FOOTNOTE_DEF_RE.test(ln.text)) return true;
    if (ln.indent === 0) return false;
    // indent 1–3 non-marker: ambiguous — keep walking.
  }
  return false;
}

/**
 * Reference-taint pass (L4). Returns the earliest offset of a reference-style
 * candidate that does not resolve against a settled definition; Infinity when
 * every reference is settled. Fence/math interiors are masked.
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

  // A definition is settled once a blank line (outside fences) starts at or
  // after its line end — its block can no longer grow through appends.
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

/** Single-pass scan producing all five tier boundaries for a snapshot. */
export function detectFreezeBoundaries(text: string): FreezeBoundaries {
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
        // A line only counts as blank once its terminating newline exists.
        // The trailing partial line is UNCONFIRMED — the next chunk may
        // append content to it, so treating it as blank breaks monotonicity
        // (x-markdown-mini's scanner does treat EOF as a line boundary,
        // which lets a trailing "\n\n" commit prematurely — we deviate).
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

    // --- fence state (mirrors x-markdown-mini's scanner, plus length rule) ---
    if (inFence) {
      const close = FENCE_RE.exec(ln.text);
      if (close && close[1][0] === fenceChar && close[1].length >= fenceLen && ln.text.trim() === close[1]) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      ln.kind = 'fence-inner';
      blankRun = 0; // a blank inside a fence resets the run (x-mini: prevBlank = isBlank && !inFence)
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

    // --- $$ flow-math state (our pipeline runs remark-math; x-mini has no equivalent) ---
    if (inMath) {
      ln.kind = 'math-inner';
      if (ln.text.includes('$$')) inMath = false;
      // Blank lines INSIDE math still produce candidates (flagged inMath) so
      // L0/L1 faithfully reproduce the math-blind imported rules.
    } else if (MATH_FENCE_RE.test(ln.text)) {
      const rest = ln.text.slice(ln.text.indexOf('$$') + 2);
      if (!rest.includes('$$')) {
        inMath = true;
        ln.kind = 'math-open';
        blankRun = 0;
        continue;
      }
    }

    // --- raw HTML balance (only for plain text lines outside fences) ---
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

  const last = (pred: (c: Candidate) => boolean): number => {
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (pred(candidates[i])) return candidates[i].offset;
    }
    return 0;
  };

  const l2Preds = (c: Candidate): boolean => !c.inMath && c.htmlBalanced;
  const l3Preds = (c: Candidate): boolean => l2Preds(c) && !hasContinuationHazard(lines, c.lineIndex);

  const earliestUnresolved = earliestUnresolvedReference(lines, lastBlankStart);

  return {
    L0: last(() => true),
    L1: last((c) => c.blankRun >= 2),
    L2: last((c) => c.blankRun >= 2 && l2Preds(c)),
    L3: last(l3Preds),
    L4: last((c) => l3Preds(c) && c.offset <= earliestUnresolved),
  };
}
