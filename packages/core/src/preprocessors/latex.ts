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
 * 4. Escape pipes inside LaTeX to prevent GFM table interference
 * 5. Escape underscores inside `\text{...}` commands
 * 6. Convert single-dollar delimiters to double-dollar delimiters
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

/**
 * Split content into alternating text and protected segments.
 * Protected segments (isCode: true) are excluded from LaTeX processing:
 * - ``` multiline code blocks
 * - ` inline code
 * - HTML tags (e.g. <span>$</span> where $ should not be treated as LaTeX)
 */
function splitByProtectedRegions(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let inlineStart = -1;
  let multilineStart = -1;

  function pushProtected(start: number, end: number) {
    if (start > lastIndex) {
      segments.push({ text: content.substring(lastIndex, start), isCode: false });
    }
    segments.push({ text: content.substring(start, end), isCode: true });
    lastIndex = end;
  }

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    // Check for multiline code blocks
    if (char === '`' && i + 2 < content.length && content[i + 1] === '`' && content[i + 2] === '`') {
      if (multilineStart === -1) {
        // Cancel any pending inline code — ``` takes priority over `
        inlineStart = -1;
        multilineStart = i;
        i += 2;
      } else {
        pushProtected(multilineStart, i + 3);
        multilineStart = -1;
        i += 2;
      }
    }
    // Check for inline code (only if not in multiline)
    else if (char === '`' && multilineStart === -1) {
      if (inlineStart === -1) {
        inlineStart = i;
      } else {
        pushProtected(inlineStart, i + 1);
        inlineStart = -1;
      }
    }
    // Check for HTML tags (only if not in code block)
    else if (char === '<' && multilineStart === -1 && inlineStart === -1) {
      // Only match known HTML tags to avoid false positives with angle brackets
      // in markdown links (<Slides Demo>), math comparisons ($a < b$), etc.
      const rest = content.substring(i);
      const tagMatch = rest.match(
        /^<\/?(span|div|p|br|hr|img|a|em|strong|b|i|u|s|sub|sup|code|pre|table|tr|td|th|thead|tbody|tfoot|ul|ol|li|dl|dt|dd|h[1-6]|blockquote|details|summary|figure|figcaption|section|article|aside|nav|header|footer|main|mark|del|ins|small|abbr|cite|dfn|kbd|samp|var|ruby|rt|rp|bdo|wbr|input|button|select|textarea|label|fieldset|legend|output|iframe|video|audio|source|canvas|svg|math|time)(?:\s[^>]*)?\/?>/i
      );
      if (tagMatch) {
        pushProtected(i, i + tagMatch[0].length);
        i += tagMatch[0].length - 1; // -1 because loop does i++
      }
    }
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
const ESCAPE_TEXT_UNDERSCORES_REGEX = /\\text{([^}]*)}/g;
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

  for (let i = 0; i < currencyMatches.length; i++) {
    const match = currencyMatches[i];
    parts.push(text.substring(lastIndex, match.index));

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
      const previousNewContent = parts.join('');
      const previousLastLineContent = previousNewContent.split(/\r\n|\r|\n/g).pop();
      const wholeLineBeforeNextMatchWithoutCurrentDollar = previousLastLineContent + firstLineBeforeNextMatch;
      if (Array.from(wholeLineBeforeNextMatchWithoutCurrentDollar.matchAll(NO_ESCAPED_DOLLAR_REGEX)).length % 2 !== 0) {
        needEscape = false;
      }
    }

    parts.push(needEscape ? '\\$' : '$');
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
 * Escape unescaped underscores within \text{...} commands in LaTeX expressions.
 * For example, \text{node_domain} becomes \text{node\_domain},
 * but \text{node\_domain} remains \text{node\_domain}.
 *
 * @param text Input string that may contain LaTeX expressions
 * @returns String with unescaped underscores escaped within \text{...} commands
 * @modified from https://github.com/lobehub/lobe-ui/blob/master/src/hooks/useMarkdown/latex.ts
 */
function escapeTextUnderscores(text: string): string {
  return text.replaceAll(ESCAPE_TEXT_UNDERSCORES_REGEX, (_match, textContent: string) => {
    const escapedTextContent = textContent.replaceAll(/(?<!\\)_/g, '\\_');
    return `\\text{${escapedTextContent}}`;
  });
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
    text = escapeTextUnderscores(text);
    text = convertSingleToDoubleDollar(text);
    return text;
  });

  return result.join('');
}
