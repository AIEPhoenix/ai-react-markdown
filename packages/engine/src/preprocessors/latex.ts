/**
 * LaTeX preprocessing pipeline.
 *
 * Normalizes raw markdown so that LaTeX expressions survive the remark/rehype
 * rendering pipeline intact. The main entry point is {@link preprocessLaTeX},
 * which splits content into protected regions (code blocks, inline code, HTML
 * tags) and applies a sequence of transformations to the unprotected text:
 *
 * 1. Escape mhchem commands (`\ce`, `\pu`)
 * 2. Escape currency dollar signs (e.g. `$100`, `$1,000.50`)
 * 3. Convert bracket delimiters (`\[...\]`, `\(...\)`) to dollar delimiters
 * 4. Escape pipes inside closed LaTeX blocks to prevent GFM table interference
 * 5. Escape pipes inside unclosed LaTeX blocks (streaming partial content)
 * 6. Escape underscores inside `\text{...}` commands
 * 7. Convert single-dollar delimiters to double-dollar delimiters
 * 8. Truncate trailing unclosed LaTeX blocks (streaming protection)
 *
 * Thanks to the implementations from the following repositories:
 * - https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 * - https://github.com/danny-avila/LibreChat/blob/main/client/src/utils/latex.ts
 *
 * @module preprocessors/latex
 */

interface Segment {
  text: string;
  isCode: boolean;
}

type FenceMarker = '`' | '~';

function getRepeatedMarkerLength(content: string, start: number, marker: FenceMarker): number {
  let end = start;
  while (end < content.length && content[end] === marker) {
    end += 1;
  }
  return end - start;
}

/**
 * Sticky regex for matching known HTML tags at a specific position.
 * The `y` (sticky) flag anchors the match at `lastIndex`, avoiding the need
 * to create a substring for each `<` character encountered during scanning.
 */
const HTML_TAG_REGEX =
  /<\/?(span|div|p|br|hr|img|a|em|strong|b|i|u|s|sub|sup|code|pre|table|tr|td|th|thead|tbody|tfoot|ul|ol|li|dl|dt|dd|h[1-6]|blockquote|details|summary|figure|figcaption|section|article|aside|nav|header|footer|main|mark|del|ins|small|abbr|cite|dfn|kbd|samp|var|ruby|rt|rp|bdo|wbr|input|button|select|textarea|label|fieldset|legend|output|iframe|video|audio|source|canvas|svg|math|time)(?:\s[^>]*)?\/?>/iy;

/**
 * Tags whose inner text must be treated as literal (never processed as LaTeX).
 * For these, an opening tag triggers protection of the entire paired region
 * `<tag>...</tag>` rather than just the tag itself, so dollar signs and other
 * LaTeX-looking characters inside (e.g. `<code>$x^2$</code>`) survive untouched.
 */
const LITERAL_CONTENT_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'math', 'svg']);
const LITERAL_CONTENT_CLOSE_REGEX: Record<string, RegExp> = {
  code: /<\/code\s*>/gi,
  pre: /<\/pre\s*>/gi,
  kbd: /<\/kbd\s*>/gi,
  samp: /<\/samp\s*>/gi,
  math: /<\/math\s*>/gi,
  svg: /<\/svg\s*>/gi,
};

/** True when only spaces/tabs (and an optional `\r`) follow `pos` up to the
 *  next `\n` or EOF — CommonMark's closing-fence rule. Without it
 *  ` ``` not-a-closer ` closed the fence and inverted the open/close phase
 *  for the rest of the document (v2.4.1 review P2). */
function restOfLineIsBlank(content: string, pos: number): boolean {
  for (let i = pos; i < content.length; i++) {
    const c = content[i];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t' && c !== '\r') return false;
  }
  return true;
}

/** A backtick fence's info string may not contain a backtick — such a line
 *  is a paragraph (possibly holding code spans), not an opener. */
function lineHasBacktick(content: string, pos: number): boolean {
  for (let i = pos; i < content.length && content[i] !== '\n'; i++) {
    if (content[i] === '`') return true;
  }
  return false;
}

/**
 * The run at `pos` is the first non-blank thing on its line. Any amount of
 * leading indentation is accepted: CommonMark's 0–3 space limit is measured
 * RELATIVE to the enclosing container, and this text-level pass has no
 * container model — a fence nested two list levels deep sits at column 4+
 * (v2.4.2 review P1-3: `- a\n  - b\n    ~~~\n    price = $100\n    ~~~`
 * had its `$` rewritten). Accepting a deeper-indented fence can only
 * OVER-protect (an indented code block that happens to hold a fence line
 * is treated as one), which is the safe direction for a preprocessor.
 */
function lineIndentBefore(content: string, pos: number): number {
  let i = pos - 1;
  let indent = 0;
  while (i >= 0 && (content[i] === ' ' || content[i] === '\t')) {
    indent += content[i] === '\t' ? 4 : 1;
    i--;
  }
  return i < 0 || content[i] === '\n' || content[i] === '\r' ? indent : -1;
}

/**
 * Find the next run of *exactly* `n` consecutive backticks at or after
 * `start`. Runs of any other length are skipped over. Returns the start
 * index of the matching run, or `-1` if no such run exists.
 *
 * Used to locate the closing delimiter of a CommonMark inline code span:
 * the closer must be a backtick run of the *same* length as the opener.
 */
function findClosingBacktickRun(content: string, start: number, n: number): number {
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '`') {
      const runLen = getRepeatedMarkerLength(content, i, '`');
      if (runLen === n) return i;
      i += runLen;
    } else if (ch === '\n') {
      // A code span cannot cross a blank line (it ends the paragraph): two
      // lone backticks in different paragraphs are literal, and pairing
      // them would shield every `$…$` in between from conversion
      // (2026-08-19 review P2-2 — inline sibling of the v2.4.1 fence fix).
      // Only `\n`-terminated blank lines are recognized (a lone-`\r` blank
      // is not — conservative: the span still pairs there, both pipelines
      // agree, math between stays unconverted as before).
      let j = i + 1;
      while (j < content.length && (content[j] === ' ' || content[j] === '\t' || content[j] === '\r')) j += 1;
      if (j >= content.length || content[j] === '\n') return -1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return -1;
}

/**
 * Split content into alternating text and protected segments.
 * Protected segments (isCode: true) are excluded from LaTeX processing:
 * - fenced multiline code blocks: 3+ backticks or tildes at the *start of a
 *   line* (any indentation — container-relative limits are not modelled).
 *   Mid-line runs are never fence openers. INDENTED code blocks (4+ spaces
 *   after a blank line, outside any container) are NOT modelled: without a
 *   container model they cannot be told from a list item's continuation
 *   paragraph, and protecting them would silence math in nested lists.
 *   Known limitation — `$` inside an indented code block may be rewritten.
 * - inline code spans: a run of N backticks closed by another run of exactly
 *   N backticks. May span newlines. Multi-backtick forms (e.g. `` `` `x` ``)
 *   are supported so literal backtick characters can appear inside.
 * - HTML tags (e.g. `<span>$</span>` where `$` should not be treated as LaTeX).
 */
export function splitByProtectedRegions(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let multilineStart = -1;
  let multilineFenceMarker: FenceMarker | null = null;
  let multilineFenceLength = 0;
  let multilineFenceIndent = 0;

  function pushProtected(start: number, end: number) {
    if (start > lastIndex) {
      segments.push({ text: content.substring(lastIndex, start), isCode: false });
    }
    segments.push({ text: content.substring(start, end), isCode: true });
    lastIndex = end;
  }

  let i = 0;
  while (i < content.length) {
    const char = content[i];

    // Inside a fenced code block: only look for a closing fence line.
    if (multilineStart !== -1) {
      if (char === multilineFenceMarker) {
        const runLen = getRepeatedMarkerLength(content, i, multilineFenceMarker);
        // A closer may be indented at most 3 columns MORE than its opener
        // (CommonMark, container-relative): a `    ```` line inside a
        // column-0 fence is content, not a closer — accepting it closed the
        // block early and exposed its body (adversarial review of the
        // any-indent opener change).
        const closerIndent = lineIndentBefore(content, i);
        if (
          runLen >= multilineFenceLength &&
          closerIndent !== -1 &&
          closerIndent <= multilineFenceIndent + 3 &&
          restOfLineIsBlank(content, i + runLen)
        ) {
          pushProtected(multilineStart, i + runLen);
          multilineStart = -1;
          multilineFenceMarker = null;
          multilineFenceLength = 0;
          i += runLen;
          continue;
        }
        i += runLen;
        continue;
      }
      i += 1;
      continue;
    }

    // Outside code: check fence opener, inline code span, then HTML tag.
    if (char === '`' || char === '~') {
      const runLen = getRepeatedMarkerLength(content, i, char);

      // Fenced code block opener: ≥3 markers and at a valid line start.
      const openerIndent = lineIndentBefore(content, i);
      if (runLen >= 3 && openerIndent !== -1 && !(char === '`' && lineHasBacktick(content, i + runLen))) {
        multilineStart = i;
        multilineFenceMarker = char;
        multilineFenceLength = runLen;
        multilineFenceIndent = openerIndent;
        i += runLen;
        continue;
      }

      // Inline code span: only backticks (tildes are never inline delimiters).
      if (char === '`') {
        const closeIdx = findClosingBacktickRun(content, i + runLen, runLen);
        if (closeIdx !== -1) {
          pushProtected(i, closeIdx + runLen);
          i = closeIdx + runLen;
          continue;
        }
      }

      // Unmatched run — skip the whole run so we don't re-interpret its
      // individual backticks on subsequent iterations.
      i += runLen;
      continue;
    }

    if (char === '<') {
      // Only match known HTML tags to avoid false positives with angle brackets
      // in markdown links (<Slides Demo>), math comparisons ($a < b$), etc.
      // Use sticky regex to match at position i without creating a substring.
      HTML_TAG_REGEX.lastIndex = i;
      const tagMatch = HTML_TAG_REGEX.exec(content);
      if (tagMatch) {
        let endIndex = i + tagMatch[0].length;
        // For literal-content tags (code/pre/math/...), protect the paired
        // <tag>...</tag> region so inner `$` never enters LaTeX processing.
        const tagName = tagMatch[1].toLowerCase();
        const isOpeningPairedTag =
          content[i + 1] !== '/' && !tagMatch[0].endsWith('/>') && LITERAL_CONTENT_TAGS.has(tagName);
        if (isOpeningPairedTag) {
          const closeRegex = LITERAL_CONTENT_CLOSE_REGEX[tagName];
          closeRegex.lastIndex = endIndex;
          const closeMatch = closeRegex.exec(content);
          if (closeMatch) {
            endIndex = closeMatch.index + closeMatch[0].length;
          } else {
            // Streaming: closing tag hasn't arrived yet. Protect everything
            // to the end of input so inner `$` etc. aren't mutated before
            // the closer shows up in a later chunk.
            endIndex = content.length;
          }
        }
        pushProtected(i, endIndex);
        i = endIndex;
        continue;
      }
    }

    i += 1;
  }

  if (multilineStart !== -1) {
    pushProtected(multilineStart, content.length);
  }

  // Push remaining text
  if (lastIndex < content.length) {
    segments.push({ text: content.substring(lastIndex), isCode: false });
  }

  return segments;
}

/**
 * Escape mhchem commands in LaTeX expressions to ensure proper rendering.
 *
 * @param text Input string containing LaTeX expressions with mhchem commands
 * @returns String with escaped mhchem commands
 * @from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
function escapeMhchemCommands(text: string) {
  return text.replaceAll('$\\ce{', '$\\\\ce{').replaceAll('$\\pu{', '$\\\\pu{');
}

const CURRENCY_REGEX = /(?<![\\$])\$(?!\$)(?=\d+(?:,\d{3})*(?:\.\d+)?(?:[KMBkmb])?(?:\s|$|[^a-zA-Z\d]))/g;
const NO_ESCAPED_DOLLAR_REGEX = /(?<![\\$])\$(?!\$)/g;
// Match \[...\] and \(...\) as LaTeX delimiters, but exclude:
// - !\[...\] (markdown image)
// - \[...\]( (markdown link)
const DELIMITERS_REGEX = /(?<!!)\\\[([\S\s]*?[^\\])\\](?!\()|\\\((.*?)\\\)/g;
const ARRAY_COL_SPEC_OR_PIPE_REGEX = /(\\begin\{(?:array|tabular[x*]?)\}\{[^}]*\})|(?<!\\)\|/g;
// Display $$ allows multiline; inline $ forbids newlines (consistent with SINGLE_DOLLAR_REGEX)
const LATEX_BLOCK_REGEX = /\$\$([\S\s]*?)\$\$|(?<![\\$])\$(?!\$)((?:[^$\n]|\\\$)*?)(?<![\\`])\$(?!\$)/g;
const TEXT_COMMAND = '\\text{';
const SINGLE_DOLLAR_REGEX = /(?<![\\$])\$(?!\$)((?:[^$\n]|\\[$])+?)(?<!\\)(?<!`)\$(?!\$)/g;

/**
 * Escape currency dollar signs (e.g. $100, $1,000.50) so they are not
 * misinterpreted as LaTeX delimiters.
 *
 * The tricky part: a `$` followed by digits might still be inside a LaTeX
 * expression (e.g. `$8.29 \text{ B} \times 4$`). We detect this by checking
 * whether there is an odd number of unescaped `$` on the same line after the
 * current match — if so, the current `$` is a LaTeX opener, not currency.
 */
function escapeCurrencyDollarSigns(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  const currencyMatches = Array.from(text.matchAll(CURRENCY_REGEX));

  // Track the processed content of the current line incrementally
  // to avoid O(n²) from joining all parts on every match.
  let currentLineProcessed = '';

  for (let i = 0; i < currencyMatches.length; i++) {
    const match = currencyMatches[i];
    const segment = text.substring(lastIndex, match.index);
    parts.push(segment);

    // Update currentLineProcessed: keep only content after the last newline.
    const newlineIdx = Math.max(segment.lastIndexOf('\n'), segment.lastIndexOf('\r'));
    if (newlineIdx !== -1) {
      currentLineProcessed = segment.substring(newlineIdx + 1);
    } else {
      currentLineProcessed += segment;
    }

    let needEscape = true;
    // Only the FIRST line after this match matters below; bound the slice
    // by the next line ending instead of splitting the whole remainder into
    // a line array on every match — O(remainder) per frame on the hot path
    // for the last match (2026-08-19 review).
    const restStart = match.index + 1;
    const restEnd = i < currencyMatches.length - 1 ? currencyMatches[i + 1].index : text.length;
    let firstLineBeforeNextMatch = '';
    if (restEnd - restStart > 0) {
      let eol = restEnd;
      for (let k = restStart; k < restEnd; k++) {
        const c = text.charCodeAt(k);
        if (c === 10 /* \n */ || c === 13 /* \r */) {
          eol = k;
          break;
        }
      }
      firstLineBeforeNextMatch = text.substring(restStart, eol);
    }
    if (Array.from(firstLineBeforeNextMatch.matchAll(NO_ESCAPED_DOLLAR_REGEX)).length % 2 !== 0) {
      const wholeLineBeforeNextMatchWithoutCurrentDollar = currentLineProcessed + firstLineBeforeNextMatch;
      if (Array.from(wholeLineBeforeNextMatchWithoutCurrentDollar.matchAll(NO_ESCAPED_DOLLAR_REGEX)).length % 2 !== 0) {
        needEscape = false;
      }
    }

    const replacement = needEscape ? '\\$' : '$';
    parts.push(replacement);
    // Append to currentLineProcessed so subsequent parity checks on the same
    // line see the correct count of unescaped `$` (e.g. a left-as-`$` opener
    // that the next match's check must count).
    currentLineProcessed += replacement;
    lastIndex = match.index + 1;
  }
  parts.push(text.substring(lastIndex));
  return parts.join('');
}

/**
 * Convert LaTeX bracket delimiters to dollar sign delimiters.
 * Converts \[...\] to $$...$$ and \(...\) to $...$
 *
 * @param text Input string containing LaTeX expressions
 * @returns String with LaTeX bracket delimiters converted to dollar sign delimiters
 * @modified from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
function convertLatexDelimiters(text: string): string {
  return text.replaceAll(
    DELIMITERS_REGEX,
    (match: string, squareBracket: string | undefined, roundBracket: string | undefined): string => {
      if (squareBracket !== undefined) {
        return `$$${squareBracket}$$`;
      } else if (roundBracket !== undefined) {
        return `$${roundBracket}$`;
      }
      return match;
    }
  );
}

/**
 * Helper function: replace unescaped pipes with \vert in LaTeX math fragments
 * @from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
const replaceUnescapedPipes = (formula: string): string =>
  // Use \vert{} so the control sequence terminates before the next token.
  // Preserve `|` inside \begin{array}{...} / \begin{tabular}{...} column specifiers.
  formula.replaceAll(ARRAY_COL_SPEC_OR_PIPE_REGEX, (match, colSpec: string | undefined) =>
    colSpec !== undefined ? match : '\\vert{}'
  );
/**
 * Escape pipes in LaTeX expressions to prevent them from being interpreted as
 * column separators in markdown tables.
 *
 * @param text Input string containing LaTeX expressions
 * @returns String with pipes escaped in LaTeX expressions
 * @modified from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
function escapeLatexPipes(text: string): string {
  return text.replaceAll(LATEX_BLOCK_REGEX, (match, display, inline) => {
    if (display !== undefined) return `$$${replaceUnescapedPipes(display)}$$`;
    if (inline !== undefined) return `$${replaceUnescapedPipes(inline)}$`;
    return match;
  });
}

/**
 * Whether the character at position `pos` is escaped by the immediately
 * preceding backslash run. An even-count run (including zero) means the
 * `$` is unescaped; an odd count means it is escaped. Example: `\\$` has
 * two preceding backslashes — the `\` escapes the `\`, leaving `$` real.
 */
function isEscapedByBackslashRun(text: string, pos: number): boolean {
  let count = 0;
  let j = pos - 1;
  while (j >= 0 && text[j] === '\\') {
    count++;
    j--;
  }
  return count % 2 === 1;
}

/**
 * Find the start index of the trailing unclosed `$$` or `$` delimiter.
 *
 * Scans through all dollar-sign tokens tracking open/close state.
 * Returns the index of the last *opening* delimiter that was never closed,
 * or `-1` if every delimiter is paired.
 *
 * @param text  Input string to scan.
 * @param mode  `'both'` tracks `$$` and `$`; `'double-only'` tracks only `$$`.
 */
function findUnclosedDelimiterStart(text: string, mode: 'both' | 'double-only'): number {
  let unclosedStart = -1;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '$' && i + 1 < text.length && text[i + 1] === '$' && !isEscapedByBackslashRun(text, i)) {
      unclosedStart = unclosedStart === -1 ? i : -1;
      i += 2;
    } else if (
      mode === 'both' &&
      text[i] === '$' &&
      !isEscapedByBackslashRun(text, i) &&
      (i + 1 >= text.length || text[i + 1] !== '$')
    ) {
      unclosedStart = unclosedStart === -1 ? i : -1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return unclosedStart;
}

function escapeLatexPipesInUnclosed(text: string): string {
  const unclosedStart = findUnclosedDelimiterStart(text, 'both');
  if (unclosedStart === -1) return text;

  // Escape pipes only in the unclosed tail
  const before = text.substring(0, unclosedStart);
  const delimLen = text[unclosedStart + 1] === '$' ? 2 : 1;
  const delim = text.substring(unclosedStart, unclosedStart + delimLen);
  const tail = text.substring(unclosedStart + delimLen);
  return before + delim + replaceUnescapedPipes(tail);
}

/**
 * Truncate trailing unclosed `$$` blocks (streaming protection).
 *
 * During streaming, an unclosed `$$` at the start of a line triggers
 * remarkMath's `mathFlow` tokenizer, which treats all subsequent content
 * as part of a display math block until a closing `$$` fence is found.
 * Since the closing fence hasn't arrived yet, the entire remainder of the
 * document is swallowed into one giant math node — producing a wall of
 * red KaTeX error text.
 *
 * This function detects the trailing unclosed `$$` and removes it
 * (including any preceding whitespace/newlines) so that remarkMath never
 * sees the incomplete delimiter.  Once the closing delimiter arrives in
 * a later streaming chunk, the complete block will render normally.
 *
 * Only tracks `$$` — single `$` does not trigger mathFlow and is harmless
 * when `singleDollarTextMath` is `false`.
 */
function truncateUnclosedLatexBlock(text: string): string {
  const unclosedStart = findUnclosedDelimiterStart(text, 'double-only');
  if (unclosedStart === -1) return text;

  // Strip the unclosed $$ block and any trailing whitespace before it.
  return text.substring(0, unclosedStart).trimEnd();
}

/**
 * Escape unescaped underscores within `\text{...}` commands in LaTeX expressions.
 * For example, `\text{node_domain}` becomes `\text{node\_domain}`, but
 * `\text{node\_domain}` stays unchanged.
 *
 * The body scan is brace-aware: nested groups `\text{outer {inner}_x}`
 * are matched via a depth counter that respects `\{` / `\}` escapes and
 * the escape for `\\` itself, so the entire body (depth ≥ 0) is scanned
 * before we escape its underscores.  An unclosed `\text{` body (missing
 * closing brace, e.g. during streaming) is left untouched.
 *
 * @param text Input string that may contain LaTeX expressions
 * @returns String with unescaped underscores escaped within `\text{...}` commands
 */
function escapeTextUnderscores(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(TEXT_COMMAND, i);
    if (start === -1) {
      out += text.substring(i);
      return out;
    }

    out += text.substring(i, start);
    const bodyStart = start + TEXT_COMMAND.length;
    let depth = 1;
    let j = bodyStart;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '\\' && j + 1 < text.length) {
        // Skip the escaped character so `\{`, `\}`, `\\` don't affect depth.
        j += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }

    if (depth !== 0) {
      // Unclosed \text{ — leave the remainder as-is so a later streaming
      // chunk can complete it.
      out += text.substring(start);
      return out;
    }

    const body = text.substring(bodyStart, j);
    const escapedBody = body.replaceAll(/(?<!\\)_/g, '\\_');
    out += `\\text{${escapedBody}}`;
    i = j + 1; // past closing `}`
  }
  return out;
}

/**
 * Convert single dollar delimiters to double dollar delimiters.
 * e.g. $x^2$ → $$x^2$$
 */
function convertSingleToDoubleDollar(text: string): string {
  return text.replaceAll(SINGLE_DOLLAR_REGEX, (_match, content: string) => `$$${content}$$`);
}

/**
 * Main LaTeX preprocessor entry point.
 *
 * Splits the input into protected regions (code blocks, inline code, HTML tags)
 * and applies the full normalization pipeline to unprotected text segments.
 * Returns the input unchanged when no LaTeX-related characters (`$`, `\[`, `\(`)
 * are detected.
 *
 * @param str - Raw markdown string.
 * @returns The preprocessed string with normalized LaTeX delimiters.
 */
export function preprocessLaTeX(str: string): string {
  // Return early if no LaTeX patterns are found
  if (!hasLatexTrigger(str)) return str;

  // Step 1: split by code blocks
  const segments = splitByProtectedRegions(str);

  // Step 2: process each non-code segment through the LaTeX pipeline
  const result = segments.map((segment) => {
    if (segment.isCode) return segment.text;

    let text = segment.text;
    text = escapeMhchemCommands(text);
    text = escapeCurrencyDollarSigns(text);
    text = convertLatexDelimiters(text);
    text = escapeLatexPipes(text);
    text = escapeLatexPipesInUnclosed(text);
    text = escapeTextUnderscores(text);
    text = convertSingleToDoubleDollar(text);
    text = truncateUnclosedLatexBlock(text);
    return text;
  });

  return result.join('');
}

// ─── Incremental (append-aware) wrapper ─────────────────────────────────────
//
// `preprocessLaTeX` is O(n) per call and runs on every revealed frame during
// smooth streaming. The wrapper below freezes the transformed output of the
// settled prefix and re-processes only the active tail, byte-identical to
// `preprocessLaTeX(full)` at every step — INCLUDING the whole-string
// early-exit's quirks (that equivalence, not idealized semantics, is the
// contract; pinned by the replay/property suites in latex.incremental.test.ts).
//
// Safe-cut rules (oracle-amended design, 2026-08-05 review):
// - a cut sits at a LINE START (preceding char strictly `\n`; lone-`\r`
//   documents never cut and gracefully degrade to full reprocessing),
// - inside a TEXT segment of the active region's own split (never inside a
//   fence / inline span / protected tag region),
// - with no dangling backtick run between the last blank line and it (an
//   unmatched run can pair with a run arriving later and re-segment the
//   past — but a code span cannot cross a blank line, so a blank settles
//   every run before it),
// - with no LATENT html tag before it — a viable `<`+letter start whose `>`
//   has not arrived: HTML_TAG_REGEX admits newlines in attributes, so the
//   match window spans lines and only a `>` anywhere after the `<` settles
//   it permanently (B1 counterexample),
// - and, decided on the TRANSFORMED slice (raw-text checks are unsound both
//   ways because currency escaping rewrites the `$` token stream — B5):
//   quiescence — no tail-sensitive transform engaged at slice end.

/** The original whole-string early-exit predicate (shared verbatim). */
function hasLatexTrigger(str: string): boolean {
  return str.includes('$') || str.includes('\\[') || str.includes('\\(');
}

/** Does `text` contain an unclosed `\text{` body? Mirrors the escape-aware
 *  brace walk of `escapeTextUnderscores`'s unclosed branch. */
function hasUnclosedTextCommand(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(TEXT_COMMAND, i);
    if (start === -1) return false;
    let depth = 1;
    let j = start + TEXT_COMMAND.length;
    while (j < text.length && depth > 0) {
      const c = text[j];
      if (c === '\\' && j + 1 < text.length) {
        j += 2;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    if (depth !== 0) return true;
    i = j;
  }
  return false;
}

/** A convertible (non-image) `\[` still present after delimiter conversion —
 *  its `\]` has not arrived, so a later append changes this segment. */
const RESIDUAL_OPEN_BRACKET_RE = /(?<!!)\\\[/;

/** Segment whose first non-whitespace bytes are a `$$` — the only shape
 *  whose B3 seam flag can be set (see processSliceInstrumented). */
const LEADING_DOUBLE_DOLLAR_RE = /^\s*\$\$/;

interface InstrumentedSlice {
  out: string;
  /** No tail-sensitive transform engaged: safe to freeze this output. */
  quiescent: boolean;
  /** `truncateUnclosedLatexBlock` fired in the slice's FIRST segment with
   *  only whitespace before the `$$` opener — the original's `trimEnd`
   *  would cross the seam into the frozen output (B3). */
  truncatedAtSeamStart: boolean;
}

/** The exact per-segment pipeline of {@link preprocessLaTeX}, instrumented
 *  with quiescence flags (`probe: false` skips them — output only, plus the
 *  first segment's seam flag) and WITHOUT the whole-string early-exit (a slice
 *  must not re-decide the early-exit: `\text{a_b}` in a trigger-free slice
 *  still transforms when the FULL string carries a `$` elsewhere). */
function processSliceInstrumented(slice: string, probe = true): InstrumentedSlice {
  const segments = splitByProtectedRegions(slice);
  const parts: string[] = [];
  let quiescent = true;
  let truncatedAtSeamStart = false;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.isCode) {
      parts.push(segment.text);
      continue;
    }
    let text = segment.text;
    text = escapeMhchemCommands(text);
    text = escapeCurrencyDollarSigns(text);
    text = convertLatexDelimiters(text);
    if (probe && RESIDUAL_OPEN_BRACKET_RE.test(text)) quiescent = false;
    text = escapeLatexPipes(text);
    if (probe && findUnclosedDelimiterStart(text, 'both') !== -1) quiescent = false;
    text = escapeLatexPipesInUnclosed(text);
    if (probe && hasUnclosedTextCommand(text)) quiescent = false;
    text = escapeTextUnderscores(text);
    text = convertSingleToDoubleDollar(text);
    // The tail pass (`probe: false`) only needs the FIRST segment's flag,
    // and that flag needs the segment's first non-blank bytes to be a `$$`
    // opener — cheap to rule out before the O(segment) unclosed scan (plain
    // prose is one segment; this scan was the last ~20% over stateless).
    if (probe || (index === 0 && LEADING_DOUBLE_DOLLAR_RE.test(text))) {
      const unclosedDouble = findUnclosedDelimiterStart(text, 'double-only');
      if (unclosedDouble !== -1) {
        quiescent = false;
        if (index === 0 && text.slice(0, unclosedDouble).trim() === '') {
          truncatedAtSeamStart = true;
        }
      }
    }
    text = truncateUnclosedLatexBlock(text);
    parts.push(text);
  }
  return { out: parts.join(''), quiescent, truncatedAtSeamStart };
}

/** A raw line holding only spaces / tabs / CR — a CommonMark blank line. */
function isBlankRawLine(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 13) return false;
  }
  return true;
}

/**
 * Last raw-safe cut in `active`, or -1. Raw conditions only (line start
 * inside a text segment, no dangling backtick run before the last blank
 * line, no latent `<`); the transformed-output quiescence check happens on
 * the candidate slice afterwards.
 */
function findRawSafeCut(active: string): number {
  const segments = splitByProtectedRegions(active);
  let offset = 0;
  let lastCut = -1;
  let backtickHazard = false;
  let latentLt = false;
  for (const segment of segments) {
    if (segment.isCode) {
      // Protected regions contain no cuts; a matched tag/span/fence carries
      // no cross-append state. `>` inside one still discharges a latent `<`
      // (HTML_TAG_REGEX scans raw text, blind to our segmentation).
      if (segment.text.includes('>')) latentLt = false;
      offset += segment.text.length;
      continue;
    }
    const text = segment.text;
    // Whether the segment's first (possibly partial) line starts at a real
    // line start — only then may it count as a blank line below.
    let atLineStart = offset === 0 || active.charCodeAt(offset - 1) === 10;
    let lineStart = 0;
    while (lineStart <= text.length) {
      const nl = text.indexOf('\n', lineStart);
      const lineEnd = nl === -1 ? text.length : nl;
      // A dangling backtick run can only be re-segmented by a run arriving
      // later that PAIRS with it, and a code span cannot cross a blank line
      // (findClosingBacktickRun stops there; a mid-line run cannot become a
      // fence, which needs a line-start run of 3+). So a blank line settles
      // every backtick before it: the hazard latch releases and lines
      // after the blank are candidates again — instead of a lone backtick
      // freezing nothing for the rest of the stream (2026-08-19 review
      // P2-3; oracle-checked: the span search is the only segmentation
      // decision that looks past a finished line). The blank must be a
      // WHOLE raw line, exactly what findClosingBacktickRun stops at:
      // terminated by `\n` inside this segment, only spaces/tabs/CR, and
      // starting at a real line start — a segment's first partial line sits
      // after a protected span on the same line, and the remainder after
      // its last `\n` is the START of a line that continues in the next
      // segment (property-suite counterexample: an empty remainder released
      // the latch and a cut landed past a still-unpaired backtick).
      if (atLineStart && nl !== -1 && isBlankRawLine(text, lineStart, lineEnd)) backtickHazard = false;
      for (let i = lineStart; i < lineEnd; i++) {
        const ch = text[i];
        if (ch === '`') backtickHazard = true;
        else if (ch === '>') latentLt = false;
        else if (ch === '<') {
          const next = text[i + 1];
          if (next !== undefined && (next === '/' || /[A-Za-z]/.test(next))) latentLt = true;
        }
      }
      if (nl === -1) break;
      if (!backtickHazard && !latentLt) lastCut = offset + nl + 1;
      lineStart = nl + 1;
      atLineStart = true;
    }
    offset += text.length;
  }
  return lastCut;
}

/** Only attempt a freeze once the unfrozen region exceeds this many chars —
 *  below it the extra pipeline pass costs more than it saves. */
const DEFAULT_FREEZE_ATTEMPT_THRESHOLD = 512;

/**
 * Append-aware `preprocessLaTeX`: one instance per streaming lineage (the
 * component holds it like the smooth-stream controller). Byte-identical to
 * `preprocessLaTeX(full)` on every call; non-append input resets all state;
 * identical input replays the cached output (StrictMode/idempotence).
 *
 * @param options.freezeThreshold Active-region size below which no freeze
 *   is attempted. Tests pass `0` so SHORT pinned counterexamples actually
 *   exercise the freeze path instead of passing vacuously through the
 *   full-reprocess fallback.
 * @internal Wired by the renderer; not part of the public API.
 */
export function createIncrementalLatexPreprocessor(options?: {
  freezeThreshold?: number;
  /** Failure backoff (default on). Tests that rely on `freezeThreshold: 0`
   *  to attempt a freeze on EVERY call turn it off, so 1-char chunkings keep
   *  exercising the cut rules instead of skipping most attempts; backoff
   *  can only freeze LESS, so passing without it implies passing with it.
   *  @internal */
  backoff?: boolean;
  /** Test hook: called once per freeze ATTEMPT (a scan of the active
   *  region) with the region's length and how many source bytes the
   *  attempt froze (0 = failed), so the backoff bound and freeze progress
   *  can be pinned. @internal */
  onAttempt?: (info: { activeLength: number; frozenBytes: number }) => void;
}): (content: string) => string {
  const freezeThreshold = options?.freezeThreshold ?? DEFAULT_FREEZE_ATTEMPT_THRESHOLD;
  const onAttempt = options?.onAttempt;
  const backoff = options?.backoff ?? true;
  let prevSource = '';
  let prevOutput = '';
  let frozenSrcEnd = 0;
  let frozenOut = '';
  let triggered = false;
  // Failure backoff (2026-08-19 review P2-3): a candidate that is not
  // quiescent stays that way for as long as it is the candidate (its bytes
  // never change under append — an early stray `$` keeps parity odd for
  // every later slice), yet each frame paid a full active-region scan plus
  // a wasted candidate pass on top of the unavoidable tail pass (3× the
  // stateless cost on such documents). After a failed attempt the next one
  // waits until the active region has doubled; failed-attempt cost is then
  // a geometric series (≤ 4·O(n) over the whole stream). Freezing later
  // never changes output — every frame equals `preprocessLaTeX(full)`.
  let nextAttemptLen = 0;

  return function incrementalPreprocessLaTeX(source: string): string {
    if (source === prevSource) return prevOutput;
    const isAppend = source.length > prevSource.length && source.startsWith(prevSource);
    if (!isAppend) {
      frozenSrcEnd = 0;
      frozenOut = '';
      triggered = false;
      nextAttemptLen = 0;
    }
    if (!triggered) {
      // Monotone gate (B4): while the ACCUMULATED string has no trigger, the
      // original early-exits with the identity — freezing transformed output
      // in that regime would diverge the moment a later `$` arrives and the
      // full run starts transforming the prefix (`\text{a_b}` quirk). Only
      // the appended chunk plus one char of overlap needs checking (`\[` /
      // `\(` can straddle the seam).
      const checkFrom = isAppend ? Math.max(0, prevSource.length - 1) : 0;
      if (!hasLatexTrigger(source.slice(checkFrom))) {
        prevSource = source;
        prevOutput = source;
        return source;
      }
      triggered = true;
    }
    let active = source.slice(frozenSrcEnd);
    if (active.length > freezeThreshold && active.length >= nextAttemptLen) {
      const activeLength = active.length;
      let advanced = false;
      let frozenBytes = 0;
      const freeze = (cut: number, slice: InstrumentedSlice) => {
        frozenOut += slice.out;
        frozenSrcEnd += cut;
        active = source.slice(frozenSrcEnd);
        advanced = true;
        frozenBytes = cut;
      };
      const cut = findRawSafeCut(active);
      if (cut > 0) {
        const candidate = processSliceInstrumented(active.slice(0, cut));
        if (candidate.quiescent) freeze(cut, candidate);
      }
      // A shorter fallback cut (largest cut before the first non-quiescent
      // segment) was designed and rejected: quiescence is segment-granular
      // (plain prose is ONE segment) and, with the threshold, the unfrozen
      // prefix before trouble is < threshold bytes anyway — the backoff
      // alone brings a permanently-failing document to ≈ the stateless
      // cost (oracle review, 2026-08-19).
      nextAttemptLen = advanced || !backoff ? 0 : active.length * 2;
      onAttempt?.({ activeLength, frozenBytes });
    }
    // Tail pass: transforms only — its `quiescent` is never read, only the
    // first segment's B3 flag, so the per-segment probes are skipped (they
    // were ~40% on top of the stateless cost for a document whose freeze
    // never succeeds; the backoff had already removed the other 2×).
    const tail = processSliceInstrumented(active, false);
    // B3 seam correction: the original's segment-level `trimEnd` reaches
    // back across our cut when the truncated `$$` block's segment starts
    // with nothing but whitespace. Applied at COMPOSE time only — the
    // frozen output itself stays untrimmed, because the block will close
    // in a later append and the untrimmed bytes become correct again.
    const head = tail.truncatedAtSeamStart ? frozenOut.replace(/\s+$/, '') : frozenOut;
    const out = head + tail.out;
    prevSource = source;
    prevOutput = out;
    return out;
  };
}
