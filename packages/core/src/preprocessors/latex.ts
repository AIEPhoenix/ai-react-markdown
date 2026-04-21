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

/**
 * Is `pos` the start of a line with at most 3 spaces of leading indentation?
 *
 * CommonMark requires a fence opener/closer to sit at the beginning of a
 * line (optionally indented by up to 3 spaces). A 4-space indent turns the
 * line into an indented-code-block candidate instead, which we do not treat
 * as a fence at all.
 */
function isAtLineStart(content: string, pos: number): boolean {
  let i = pos - 1;
  let spaces = 0;
  while (i >= 0 && content[i] === ' ') {
    spaces++;
    if (spaces > 3) return false;
    i--;
  }
  return i < 0 || content[i] === '\n' || content[i] === '\r';
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
    if (content[i] === '`') {
      const runLen = getRepeatedMarkerLength(content, i, '`');
      if (runLen === n) return i;
      i += runLen;
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
 *   line* (≤3 space indent). Mid-line runs are never fence openers.
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
        if (runLen >= multilineFenceLength && isAtLineStart(content, i)) {
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
      if (runLen >= 3 && isAtLineStart(content, i)) {
        multilineStart = i;
        multilineFenceMarker = char;
        multilineFenceLength = runLen;
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
    let restBeforeNextMatchOrEnd = '';
    if (i < currencyMatches.length - 1) {
      const nextMatch = currencyMatches[i + 1];
      if (nextMatch.index - match.index > 1) {
        restBeforeNextMatchOrEnd = text.substring(match.index + 1, nextMatch.index);
      }
    } else {
      restBeforeNextMatchOrEnd = text.substring(match.index + 1);
    }
    const firstLineBeforeNextMatch = restBeforeNextMatchOrEnd.split(/\r\n|\r|\n/g)[0];
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
    if (
      text[i] === '$' &&
      i + 1 < text.length &&
      text[i + 1] === '$' &&
      !isEscapedByBackslashRun(text, i)
    ) {
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
  if (!str.includes('$') && !str.includes('\\[') && !str.includes('\\(')) return str;

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
