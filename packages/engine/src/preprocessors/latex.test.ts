import { describe, expect, test } from 'vitest';
import { preprocessLaTeX, splitByProtectedRegions } from './latex';

describe('preprocessLaTeX', () => {
  test('returns the same string if no LaTeX patterns are found', () => {
    const content = 'This is a test string without LaTeX or dollar signs';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('preserves existing LaTeX expressions', () => {
    const content = 'Inline $x^2 + y^2 = z^2$ and block $$E = mc^2$$';
    const expected = 'Inline $$x^2 + y^2 = z^2$$ and block $$E = mc^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('converts LaTeX delimiters', () => {
    const content = 'Brackets \\[x^2\\] and parentheses \\(y^2\\)';
    const expected = 'Brackets $$x^2$$ and parentheses $$y^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes mhchem commands', () => {
    const content = '$\\ce{H2O}$ and $\\pu{123 J}$';
    const expected = '$$\\\\ce{H2O}$$ and $$\\\\pu{123 J}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles complex mixed content', () => {
    const content = `
      LaTeX inline $x^2$ and block $$y^2$$
      Chemical $\\ce{H2O}$
      Brackets \\[z^2\\]
    `;
    const expected = `
      LaTeX inline $$x^2$$ and block $$y^2$$
      Chemical $$\\\\ce{H2O}$$
      Brackets $$z^2$$
    `;
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles empty string', () => {
    expect(preprocessLaTeX('')).toBe('');
  });

  test('preserves code blocks', () => {
    const content = '```\n$100\n```\nOutside $200';
    const expected = '```\n$100\n```\nOutside \\$200';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves LaTeX expressions with numbers', () => {
    const content = 'The equation is $f(x) = 2x + 3$ where x is a variable.';
    const expected = 'The equation is $$f(x) = 2x + 3$$ where x is a variable.';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves LaTeX expressions with special characters', () => {
    const content = 'The set is defined as $\\{x | x > 0\\}$.';
    const expected = 'The set is defined as $$\\{x \\vert{} x > 0\\}$$.';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves valid double dollar delimiters', () => {
    const content = 'This is valid: $$x^2 + y^2 = z^2$$';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('converts single dollar delimiters to double dollars', () => {
    const content = 'Inline math: $x^2 + y^2 = z^2$';
    const expected = 'Inline math: $$x^2 + y^2 = z^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('converts multiple single dollar expressions', () => {
    const content = 'First $a + b = c$ and second $x^2 + y^2 = z^2$';
    const expected = 'First $$a + b = c$$ and second $$x^2 + y^2 = z^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes currency dollar signs', () => {
    const content = 'Price is $50 and $100';
    const expected = 'Price is \\$50 and \\$100';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes currency with spaces', () => {
    const content = '$50 is $20 + $30';
    const expected = '\\$50 is \\$20 + \\$30';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not escape dollar signs not followed by digits', () => {
    const content = 'This $variable is not escaped';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('escapes currency with commas', () => {
    const content = 'The price is $1,000,000 for this item.';
    const expected = 'The price is \\$1,000,000 for this item.';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes currency with decimals', () => {
    const content = 'Total: $29.50 plus tax';
    const expected = 'Total: \\$29.50 plus tax';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('converts LaTeX expressions while escaping currency', () => {
    const content = 'LaTeX $x^2$ and price $50';
    const expected = 'LaTeX $$x^2$$ and price \\$50';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles Goldbach Conjecture example', () => {
    const content = '- **Goldbach Conjecture**: $2n = p + q$ (every even integer > 2)';
    const expected = '- **Goldbach Conjecture**: $$2n = p + q$$ (every even integer > 2)';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not escape already escaped dollar signs', () => {
    const content = 'Already escaped \\$50 and \\$100';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('does not convert already escaped single dollars', () => {
    const content = 'Escaped \\$x^2\\$ should not change';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('handles complex mixed content with currency', () => {
    const content = `Valid double $$y^2$$
Currency $100 and $200
Single dollar math $x^2 + y^2$
Chemical $\\ce{H2O}$
Valid brackets \\[z^2\\]`;
    const expected = `Valid double $$y^2$$
Currency \\$100 and \\$200
Single dollar math $$x^2 + y^2$$
Chemical $$\\\\ce{H2O}$$
Valid brackets $$z^2$$`;
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles multiple equations with currency', () => {
    const content = `- **Euler's Totient Function**: $\\phi(n) = n \\prod_{p|n} \\left(1 - \\frac{1}{p}\\right)$
- **Total Savings**: $500 + $200 + $150 = $850`;
    const expected = `- **Euler's Totient Function**: $$\\phi(n) = n \\prod_{p\\vert{}n} \\left(1 - \\frac{1}{p}\\right)$$
- **Total Savings**: \\$500 + \\$200 + \\$150 = \\$850`;
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles inline code blocks', () => {
    const content = 'Outside $x^2$ and inside code: `$100`';
    const expected = 'Outside $$x^2$$ and inside code: `$100`';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles multiline code blocks', () => {
    const content = '```\n$100\n$variable\n```\nOutside $x^2$';
    const expected = '```\n$100\n$variable\n```\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles tilde fenced code blocks', () => {
    const content = '~~~\n$100\n$variable\n~~~\nOutside $x^2$';
    const expected = '~~~\n$100\n$variable\n~~~\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles complex physics equations', () => {
    const content = `- **Schrödinger Equation**: $i\\hbar\\frac{\\partial}{\\partial t}|\\psi\\rangle = \\hat{H}|\\psi\\rangle$
- **Einstein Field Equations**: $G_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}$`;
    const expected = `- **Schrödinger Equation**: $$i\\hbar\\frac{\\partial}{\\partial t}\\vert{}\\psi\\rangle = \\hat{H}\\vert{}\\psi\\rangle$$
- **Einstein Field Equations**: $$G_{\\mu\\nu} = \\frac{8\\pi G}{c^4} T_{\\mu\\nu}$$`;
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles financial calculations with currency', () => {
    const content = `- **Simple Interest**: $A = P + Prt = $1,000 + ($1,000)(0.05)(2) = $1,100$
- **ROI**: $\\text{ROI} = \\frac{$1,200 - $1,000}{$1,000} \\times 100\\% = 20\\%$`;
    const expected = `- **Simple Interest**: $$A = P + Prt = \\$1,000 + (\\$1,000)(0.05)(2) = \\$1,100$$
- **ROI**: $$\\text{ROI} = \\frac{\\$1,200 - \\$1,000}{\\$1,000} \\times 100\\% = 20\\%$$`;
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not convert partial or malformed expressions', () => {
    const content = 'A single $ sign should not be converted';
    const expected = 'A single $ sign should not be converted';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles nested parentheses in LaTeX', () => {
    const content =
      'Matrix determinant: $\\det(A) = \\sum_{\\sigma \\in S_n} \\text{sgn}(\\sigma) \\prod_{i=1}^n a_{i,\\sigma(i)}$';
    const expected =
      'Matrix determinant: $$\\det(A) = \\sum_{\\sigma \\in S_n} \\text{sgn}(\\sigma) \\prod_{i=1}^n a_{i,\\sigma(i)}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves spacing in equations', () => {
    const content = 'Equation: $f(x) = 2x + 3$ where x is a variable.';
    const expected = 'Equation: $$f(x) = 2x + 3$$ where x is a variable.';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles LaTeX with newlines inside should not be converted', () => {
    const content = `This has $x
y$ which spans lines`;
    const expected = `This has $x
y$ which spans lines`;
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles multiple dollar signs in text', () => {
    const content = 'Price $100 then equation $x + y = z$ then another price $50';
    const expected = 'Price \\$100 then equation $$x + y = z$$ then another price \\$50';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles complex LaTeX with currency in same expression', () => {
    const content = 'Calculate $\\text{Total} = \\$500 + \\$200$';
    const expected = 'Calculate $$\\text{Total} = \\$500 + \\$200$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves already escaped dollars in LaTeX', () => {
    const content = 'The formula $f(x) = \\$2x$ represents cost';
    const expected = 'The formula $$f(x) = \\$2x$$ represents cost';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles adjacent LaTeX and currency', () => {
    const content = 'Formula $x^2$ costs $25';
    const expected = 'Formula $$x^2$$ costs \\$25';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles LaTeX with special characters and currency', () => {
    const content = 'Set $\\{x | x > \\$0\\}$ for positive prices';
    const expected = 'Set $$\\{x \\vert{} x > \\$0\\}$$ for positive prices';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not convert when closing dollar is preceded by backtick', () => {
    const content = 'The error "invalid $lookup namespace" occurs when using `$lookup` operator';
    const expected = 'The error "invalid $lookup namespace" occurs when using `$lookup` operator';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles mixed backtick and non-backtick cases', () => {
    const content = 'Use $x + y$ in math but `$lookup` in code';
    const expected = 'Use $$x + y$$ in math but `$lookup` in code';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes currency amounts without commas', () => {
    const content = 'The total amount invested is $1157.90 (existing amount) + $500 (new investment) = $1657.90.';
    const expected =
      'The total amount invested is \\$1157.90 (existing amount) + \\$500 (new investment) = \\$1657.90.';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles large currency amounts', () => {
    const content = 'You can win $1000000 or even $9999999.99!';
    const expected = 'You can win \\$1000000 or even \\$9999999.99!';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes currency with many decimal places', () => {
    const content = 'Bitcoin: $0.00001234, Gas: $3.999, Rate: $1.234567890';
    const expected = 'Bitcoin: \\$0.00001234, Gas: \\$3.999, Rate: \\$1.234567890';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes abbreviated currency notation', () => {
    const content = '$250k is 25% of $1M';
    const expected = '\\$250k is 25% of \\$1M';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles various abbreviated currency formats', () => {
    const content = 'Revenue: $5M to $10M, funding: $1.5B, price: $5K';
    const expected = 'Revenue: \\$5M to \\$10M, funding: \\$1.5B, price: \\$5K';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not escape dollar-number pattern when it is part of a LaTeX expression', () => {
    const content = '- 占用：$8.29 \\text{ B} \\times 4 \\text{ bytes} \\times 2 = \\mathbf{66.3 \\text{ GB}}$';
    const expected = '- 占用：$$8.29 \\text{ B} \\times 4 \\text{ bytes} \\times 2 = \\mathbf{66.3 \\text{ GB}}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Code block splitting edge cases ---

  test('does not duplicate content when stray backtick precedes a code block', () => {
    const content = 'text `start ```\ncode\n``` end` done $x^2$';
    const expected = 'text `start ```\ncode\n``` end` done $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not duplicate content with stray backtick and currency in code block', () => {
    const content = 'has ` backtick\n```\n$100\n```\nformula `var` and $x^2$';
    const expected = 'has ` backtick\n```\n$100\n```\nformula `var` and $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves mhchem inside inline code', () => {
    const content = 'Use `$\\ce{H2O}$` for water';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('preserves mhchem inside multiline code block', () => {
    const content = '```\n$\\ce{H2O}$\n```\nOutside $x^2$';
    const expected = '```\n$\\ce{H2O}$\n```\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles multiple code blocks with text between them', () => {
    const content = '`$a`  $x^2$  `$b`';
    const expected = '`$a`  $$x^2$$  `$b`';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles code block at the very start', () => {
    const content = '```\ncode\n```\n$x^2$';
    const expected = '```\ncode\n```\n$$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
    // Text glued to the closing run makes it NOT a closer (CommonMark): the
    // block stays open and the `$x^2$` is code, left untouched.
    expect(preprocessLaTeX('```\ncode\n```$x^2$')).toBe('```\ncode\n```$x^2$');
  });

  test('handles code block at the very end', () => {
    const content = '$x^2$```\ncode\n```';
    const expected = '$$x^2$$```\ncode\n```';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not protect mid-line ``` as a fence (CommonMark line-start rule)', () => {
    // Mid-line ``` is never a fence opener — at best it is an inline-code-span
    // opener of N=3 backticks. Without a matching closing run of exactly 3
    // backticks, the run stays literal and surrounding `$` / `$100` are
    // normalized like any other prose.
    const content = 'before ```\n$100\nno closing fence $x^2$';
    const expected = 'before ```\n\\$100\nno closing fence $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not protect mid-line ~~~ as a fence (CommonMark line-start rule)', () => {
    // `~` is never an inline-code-span delimiter either, so mid-line `~~~`
    // is just literal text and the prose is processed normally.
    const content = 'before ~~~\n$100\nno closing fence $x^2$';
    const expected = 'before ~~~\n\\$100\nno closing fence $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles fenced code blocks opened and closed with four backticks', () => {
    const content = '````ts\nconst price = $100\n````\nOutside $x^2$';
    const expected = '````ts\nconst price = $100\n````\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles fenced code blocks opened and closed with four tildes', () => {
    const content = '~~~~\n$100\n$variable\n~~~~\nOutside $x^2$';
    const expected = '~~~~\n$100\n$variable\n~~~~\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('allows a longer closing fence than the opening fence', () => {
    const content = '```\n$100\n````\nOutside $x^2$';
    const expected = '```\n$100\n````\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('treats a shorter closing fence as still unclosed', () => {
    const content = '````\n$100\n```\nOutside $x^2$';
    const expected = '````\n$100\n```\nOutside $x^2$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('v2.4.1 review P2: a fence line with trailing text is not a closer (CommonMark)', () => {
    // ` ``` not-a-closer ` stays inside the block; only the bare ``` closes it.
    const content = '```\n$b$\n``` not-a-closer\n$c$\n```\nOutside $x^2$';
    const expected = '```\n$b$\n``` not-a-closer\n$c$\n```\nOutside $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
    // Trailing spaces/tabs after the closer are fine.
    const spaced = '```\n$100\n```  \t\nOutside $x^2$';
    expect(preprocessLaTeX(spaced)).toBe('```\n$100\n```  \t\nOutside $$x^2$$');
    // A backtick fence whose info string holds a backtick is a paragraph,
    // not an opener — the next line is live text.
    const info = '``` js `x`\n$x^2$';
    expect(preprocessLaTeX(info)).toBe('``` js `x`\n$$x^2$$');
  });

  test('2026-08-19 review r2 P1-1: display `$$` delimiters honour `\\$` escapes', () => {
    // `\$` + `$` is not a display opener — it used to pair with the real
    // `$$` far below and rewrite every `|` of the table in between.
    const doc = 'Cost \\$$x$ each.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n$$\nE = mc^2\n$$\n';
    expect(preprocessLaTeX(doc)).toBe(doc);
    // `\$$` is not a closer either.
    expect(preprocessLaTeX('$$ a | b \\$$ c $$\n')).toBe('$$ a \\vert{} b \\$$ c $$\n');
    // Real display blocks still escape pipes.
    expect(preprocessLaTeX('$$\na | b\n$$\n')).toBe('$$\na \\vert{} b\n$$\n');
    // Same lexicon as findUnclosedDelimiterStart: `$$$$` is an EMPTY display
    // (the `|` after it is outside), an even backslash run does not escape.
    expect(preprocessLaTeX('a $$$$ |b')).toBe('a $$$$ |b');
    expect(preprocessLaTeX('a \\\\$$b|c$$ d')).toBe('a \\\\$$b\\vert{}c$$ d');
    expect(preprocessLaTeX('\\$$$x|y$$ z')).toBe('\\$$$x\\vert{}y$$ z');
  });

  test('2026-08-19 review P2-2: a code span cannot cross a blank line — lone backticks in different paragraphs stay literal', () => {
    // Two paragraphs each holding one stray backtick: CommonMark never pairs
    // them, so the math between them is live and converts.
    const content = 'Press the ` key to open.\n\nEuler: $e^{i\\pi} = -1$ inline.\n\nType ` again to close.\n';
    const expected = 'Press the ` key to open.\n\nEuler: $$e^{i\\pi} = -1$$ inline.\n\nType ` again to close.\n';
    expect(preprocessLaTeX(content)).toBe(expected);
    // Whitespace-only lines are blank too (spaces / tabs), under any line
    // ending — `\r\n` and a lone `\r` included (r2 P3).
    expect(preprocessLaTeX('a ` b\n \t\r\n$x$\n\nc ` d')).toBe('a ` b\n \t\r\n$$x$$\n\nc ` d');
    expect(preprocessLaTeX('a ` b\r\r$x$\r c ` d')).toBe('a ` b\r\r$$x$$\r c ` d');
    expect(preprocessLaTeX('a ` b\r\n\r\n$x$\r\nc ` d')).toBe('a ` b\r\n\r\n$$x$$\r\nc ` d');
    // A soft line break (single ending) still pairs.
    expect(preprocessLaTeX('a `code\r$x$ more` b')).toBe('a `code\r$x$ more` b');
    // A span that wraps a soft line break inside ONE paragraph still pairs
    // and still protects its content.
    expect(preprocessLaTeX('a `code\n$x$ more` b\n\n$y$')).toBe('a `code\n$x$ more` b\n\n$$y$$');
  });

  test('handles unclosed inline code backtick gracefully', () => {
    const content = 'text ` unclosed $x^2$';
    const expected = 'text ` unclosed $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Pipe escaping in LaTeX environments ---

  test('preserves pipes in array column specifiers', () => {
    const content = '$$\\begin{array}{cc|c} 1 & 0 & a \\end{array}$$';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('preserves pipes in tabular column specifiers', () => {
    const content = '$$\\begin{tabular}{|l|c|r|}a & b & c\\end{tabular}$$';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('preserves pipes in array while escaping pipes in math', () => {
    const content = '$$|x| + \\begin{array}{c|c} a & b \\end{array}$$';
    const expected = '$$\\vert{}x\\vert{} + \\begin{array}{c|c} a & b \\end{array}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves pipes in multiline array (not converted to double dollar)', () => {
    const content = `$$\\begin{array}{cc|c}
1 & 0 & a \\\\
0 & 1 & b
\\end{array}$$`;
    // Already double-dollar, pipes in column spec preserved
    expect(preprocessLaTeX(content)).toBe(content);
  });

  // --- Underscore escaping in \\text{} ---

  test('escapes underscores in \\text{} commands', () => {
    const content = '$\\text{node_domain}$';
    const expected = '$$\\text{node\\_domain}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not double-escape already escaped underscores in \\text{}', () => {
    const content = '$\\text{node\\_domain}$';
    const expected = '$$\\text{node\\_domain}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Adjacent and consecutive edge cases ---

  test('handles consecutive inline code blocks', () => {
    const content = '`$a` `$b` $x^2$';
    const expected = '`$a` `$b` $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles empty inline code', () => {
    const content = '`` $x^2$';
    const expected = '`` $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles text with only code blocks and no LaTeX', () => {
    const content = 'No math `code` here ```\nblock\n``` end';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('handles code block with language specifier', () => {
    const content = '```python\nx = $100\n```\nMath: $x^2$';
    const expected = '```python\nx = $100\n```\nMath: $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- HTML tag protection ---

  test('does not treat $ inside <span> as LaTeX delimiter', () => {
    const content = 'To split <span>$</span>100 in half, we calculate $100/2$';
    const expected = 'To split <span>$</span>100 in half, we calculate $$100/2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles <span>$</span> with adjacent LaTeX expression', () => {
    const content = 'Price is <span>$</span>100 and formula $x^2$';
    const expected = 'Price is <span>$</span>100 and formula $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles multiple <span>$</span> currency markers', () => {
    const content = '<span>$</span>50 is half of <span>$</span>100';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('handles self-closing HTML tags near LaTeX', () => {
    const content = 'Formula $x^2$ then <br/> and $y^2$';
    const expected = 'Formula $$x^2$$ then <br/> and $$y^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not treat Obsidian-style angle bracket links as HTML', () => {
    const content = '[Slides Demo](<Slides Demo>) and $x^2$';
    const expected = '[Slides Demo](<Slides Demo>) and $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not treat arbitrary angle brackets as HTML tags', () => {
    const content = 'See <Section A> for $x^2$ details';
    const expected = 'See <Section A> for $$x^2$$ details';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Paired literal-content HTML containers (issue: $ inside <code> etc.) ---

  test('does not rewrite $ inside <code>...</code>', () => {
    const content = 'inline <code>$x^2$</code> and real $y^2$';
    const expected = 'inline <code>$x^2$</code> and real $$y^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not escape currency $ inside <code>...</code>', () => {
    const content = 'see <code>$100</code> and math $z^2$';
    const expected = 'see <code>$100</code> and math $$z^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not rewrite $ inside <pre>...</pre>', () => {
    const content = '<pre>$x^2$</pre> but $y^2$';
    const expected = '<pre>$x^2$</pre> but $$y^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not rewrite $ inside <kbd>...</kbd>', () => {
    const content = 'press <kbd>$</kbd> then type $x^2$';
    const expected = 'press <kbd>$</kbd> then type $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not rewrite $ inside <samp>...</samp>', () => {
    const content = 'output <samp>$100</samp> vs math $x^2$';
    const expected = 'output <samp>$100</samp> vs math $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not rewrite $ inside <math>...</math>', () => {
    const content = '<math>$a$</math> and real $b$';
    const expected = '<math>$a$</math> and real $$b$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not rewrite $ inside <svg>...</svg>', () => {
    const content = '<svg><text>$100</text></svg> price is $50';
    const expected = '<svg><text>$100</text></svg> price is \\$50';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles case-insensitive literal-content tag matching', () => {
    const content = '<CODE>$x^2$</CODE> and $y^2$';
    const expected = '<CODE>$x^2$</CODE> and $$y^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not mutate $ inside an unclosed <code> during streaming', () => {
    // M3 contract: before the `</code>` closer streams in, protect the tail
    // so `$100` and `$x$` are never rewritten.
    const content = 'see <code>$100 and $x^2$';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('does not mutate a fenced-looking sequence inside an unclosed <pre>', () => {
    // Protect-to-end should also swallow code-fence lookalikes inside the
    // unclosed container so the scanner never mis-identifies them.
    const content = '<pre>```\n$50 inside pre\n```';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  // --- Markdown escaped brackets vs LaTeX delimiters ---

  test('does not convert escaped markdown image \\![...\\](url) as LaTeX', () => {
    const content = '\\![AltText\\|100x100\\](https://url/to/image.png)';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('does not convert escaped markdown link \\[...\\](url) as LaTeX', () => {
    const content = 'See \\[docs\\](https://example.com) for info';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('still converts real LaTeX \\[...\\] display math', () => {
    const content = 'Display: \\[x^2 + y^2 = z^2\\]';
    const expected = 'Display: $$x^2 + y^2 = z^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Cross-line pipe safety (Oracle review) ---

  test('does not cross-line pair $ signs for pipe escaping', () => {
    const content = 'variable $a and\nnew line with | pipe then $b formula';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('display math $$ still allows multiline with pipes', () => {
    const content = '$$x +\n| y |$$';
    const expected = '$$x +\n\\vert{} y \\vert{}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Unclosed LaTeX blocks (streaming) ---

  test('truncates unclosed $$ with pipes (streaming)', () => {
    const content = '$$|\\psi\\rangle = \\alpha|0\\rangle';
    expect(preprocessLaTeX(content)).toBe('');
  });

  test('truncates unclosed $$ with pipes after text (streaming)', () => {
    const content = 'before\n\n$$|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle';
    expect(preprocessLaTeX(content)).toBe('before');
  });

  test('escapes pipes in unclosed $ block (streaming inline)', () => {
    const content = '其中 $$\\vert{}0\\rangle$$ 和 $|1\\ran';
    const expected = '其中 $$\\vert{}0\\rangle$$ 和 $\\vert{}1\\ran';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not double-escape pipes in already closed blocks', () => {
    const content = '$$\\vert{}x\\vert{}$$ and $$|y|$$';
    const expected = '$$\\vert{}x\\vert{}$$ and $$\\vert{}y\\vert{}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does NOT truncate an unclosed $$ that sits mid-line', () => {
    // mathFlow is a leaf block: it only opens on a line whose first non-space
    // character starts the run. Verified against remark-math — this document
    // parses as paragraph/heading/paragraph with nothing swallowed, so
    // removing the tail would delete content to prevent nothing.
    const content = '$$|a|$$ then $$|b\\rangle';
    const expected = '$$\\vert{}a\\vert{}$$ then $$\\vert{}b\\rangle';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('preserves table pipes when no unclosed LaTeX block', () => {
    const content = '$$|x|$$\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const expected = '$$\\vert{}x\\vert{}$$\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Truncate unclosed LaTeX blocks (streaming mathFlow protection) ---

  test('truncates trailing unclosed $$ block to prevent mathFlow takeover', () => {
    const content = '写作：\n\n$$\\vert{}\\psi\\rangle = \\alpha\\vert{}0\\rangle';
    const expected = '写作：';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('truncates unclosed $$ after closed blocks (pre-escaped pipes)', () => {
    const content = '$$\\vert{}a\\vert{}$$\n\n$$\\vert{}b\\rangle';
    const expected = '$$\\vert{}a\\vert{}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not truncate when all $$ blocks are closed', () => {
    const content = '$$|x|$$\n\ntext\n\n$$|y|$$';
    const expected = '$$\\vert{}x\\vert{}$$\n\ntext\n\n$$\\vert{}y\\vert{}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not truncate unclosed single $ (no mathFlow risk)', () => {
    const content = '其中 $$\\vert{}0\\rangle$$ 和 $\\vert{}1\\ran';
    const expected = '其中 $$\\vert{}0\\rangle$$ 和 $\\vert{}1\\ran';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('does not truncate closed inline math', () => {
    const content = '其中 $|0\\rangle$ 和 $|1\\rangle$ 是计算基';
    const expected = '其中 $$\\vert{}0\\rangle$$ 和 $$\\vert{}1\\rangle$$ 是计算基';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Only a line-start $$ opens a math flow ---
  //
  // The predicate is positional because mathFlow's is: it opens on a line
  // whose first non-space character starts the run, indented at most three
  // spaces. Every expectation below was measured against remark-math on
  // 2026-09-01 by appending a heading and a paragraph and checking whether
  // they landed inside the math node.
  //
  // The bug this replaced: a finished document containing a price written
  // `$$100` lost everything after it. The currency rule escapes a single `$`
  // only, so the doubled one read as an opener, and the whole page after it
  // was removed to prevent a swallow that would never have happened.

  test('does not truncate a price written with a doubled dollar sign', () => {
    const content = 'The server costs $$100 per month.\n\n## Still here\n\nplain.';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('truncates a line-start $$ at zero indent', () => {
    const content = 'before\n\n$$\n\\frac{a}{b}\n\n## Swallowed\n\nplain.';
    expect(preprocessLaTeX(content)).toBe('before');
  });

  test('truncates a line-start $$ indented three spaces', () => {
    const content = 'before\n\n   $$\n\\frac{a}{b}\n\n## Swallowed';
    expect(preprocessLaTeX(content)).toBe('before');
  });

  test('does not truncate at four spaces — that is an indented code block', () => {
    const content = 'before\n\n    $$\n\\frac{a}{b}\n\n## Still here\n\nplain.';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('does not truncate after a tab — a tab is four columns', () => {
    const content = 'before\n\n\t$$\n\\frac{a}{b}\n\n## Still here\n\nplain.';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  // --- Escaped $$ should not trigger unclosed-block truncation (H3) ---

  test('does not truncate on escaped \\$$ currency followed by digits', () => {
    const content = 'Cost is \\$$100 and more content.';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('does not truncate on escaped \\$$ followed by more text', () => {
    const content = 'prefix \\$$ then trailing text';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('double backslash before $$ is treated as unescaped (even-count parity)', () => {
    // `\\$$...` means literal `\`, then a real `$$` delimiter — the parity
    // check still has to see it as a delimiter rather than as escaped.
    //
    // It is NOT truncated, because the delimiter is mid-line and mathFlow
    // cannot open there. What this test now pins is the parity reading alone;
    // the truncation half moved to the line-start cases below.
    const content = 'prefix \\\\$$unclosed block';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('triple backslash before $$ is treated as escaped (odd-count parity)', () => {
    // `\\\$$` = literal `\` + escaped `$$`. The `$$` is NOT a delimiter and
    // the content must not be truncated.
    const content = 'prefix \\\\\\$$100 continues';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  // --- Cross-segment unclosed $$ (H4) ---
  //
  // When a code block sits between an unclosed `$$` and its closer, each
  // preprocessing segment is processed independently. `truncateUnclosedLatexBlock`
  // therefore only sees per-segment state, so an unclosed `$$` *inside* the
  // pre-code segment gets truncated even if a closing `$$` exists after the
  // code fence. This asserts that contract and protects against regressions
  // that would leak partial math across segment boundaries.

  test('per-segment truncation: a mid-line unclosed $$ before a fence survives', () => {
    // Segments are still processed independently — that is what the next test
    // pins. This one no longer truncates, because `$$E = mc` is mid-line and
    // opens no math flow. Verified against remark-math: the document parses as
    // paragraph/code/paragraph with nothing swallowed.
    const content = 'before $$E = mc\n```\ncode\n```\nand $$after$$';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('per-segment truncation: closed $$ inside pre-code segment survives', () => {
    const content = '$$a$$ and more\n```\ncode\n```\nafter';
    const expected = '$$a$$ and more\n```\ncode\n```\nafter';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Multi-backtick inline code spans (CommonMark delimiter runs) ---
  //
  // CommonMark: a code span is opened by a run of N backticks and closed by a
  // run of *exactly* N backticks. The content between must NOT be rewritten —
  // it is literal. Runs of a different length inside are literal backticks,
  // not openers/closers. A run with no matching closer leaves the backticks
  // as prose (not a code span at all).

  test('protects a `` ``...`` `` code span that embeds a literal backtick', () => {
    // Valid CommonMark: open with 2 backticks, content is `$x` then close with
    // 2 backticks. The library must not rewrite the embedded `$x$` to `$$x$$`.
    const content = 'before `` `$x^2$` `` after $y^2$';
    const expected = 'before `` `$x^2$` `` after $$y^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('protects a triple-backtick inline code span mid-line', () => {
    // Two ``` runs on the same line form an inline code span of N=3. The
    // `$y$` between them must not be rewritten to `$$y$$`.
    const content = 'before ``` and $y$ then ``` after $z$';
    const expected = 'before ``` and $y$ then ``` after $$z$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('treats an unmatched mid-line ``` run as literal text', () => {
    // No matching run of exactly 3 backticks anywhere after — the backticks
    // stay literal and the prose is processed normally.
    const content = 'The token ``` should be shown, then $y$';
    const expected = 'The token ``` should be shown, then $$y$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('runs of unequal length do not close multi-backtick code spans', () => {
    // The opening run has length 2; the first run inside is length 3 and must
    // NOT close it. The closing match is the run of exactly 2 at the end.
    const content = 'pre `` a ``` b `` post $x^2$';
    const expected = 'pre `` a ``` b `` post $$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('inline code spans may span newlines and keep `$` inside literal', () => {
    // CommonMark allows newlines inside inline code spans; `$100` must not be
    // escaped to `\$100` because the code span still protects it.
    const content = 'see ``$100\nnext line`` and $y$';
    const expected = 'see ``$100\nnext line`` and $$y$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  // --- Brace-aware \text{...} underscore escaping ---

  test('escapes underscores inside \\text{} with nested {} groups', () => {
    // Regression for the old `[^}]*` regex: the nested `{inner}` caused the
    // body match to stop early, leaving `_x` unescaped.
    const content = '$\\text{outer {inner}_x}$';
    const expected = '$$\\text{outer {inner}\\_x}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('escapes underscores at every nesting depth inside \\text{}', () => {
    const content = '$\\text{a_b {c_d {e_f}}}$';
    const expected = '$$\\text{a\\_b {c\\_d {e\\_f}}}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('respects \\{ and \\} escapes when scanning \\text{} body', () => {
    // `\{` / `\}` inside the body must not shift the brace depth, so the real
    // matching `}` is the final one.
    const content = '$\\text{a\\{b_c\\}_d}$';
    const expected = '$$\\text{a\\{b\\_c\\}\\_d}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('leaves an unclosed \\text{ body untouched (streaming)', () => {
    // No closing brace yet — the preprocessor must not mangle a partial
    // body before a later streaming chunk completes it.
    const content = '$\\text{foo_bar and more';
    expect(preprocessLaTeX(content)).toBe(content);
  });

  test('handles multiple \\text{} occurrences, some with nested braces', () => {
    const content = '$\\text{a_1} + \\text{b {c}_2} = \\text{d_3}$';
    const expected = '$$\\text{a\\_1} + \\text{b {c}\\_2} = \\text{d\\_3}$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });
});

describe('preprocessLaTeX idempotence', () => {
  // Asserts f(f(x)) === f(x): applying the preprocessor to its own output
  // must be a no-op. Any regex change that over-eagerly re-converts a
  // stabilized form (e.g. turning `$$...$$` back into `$...$`, escaping a
  // `\$` twice, or mis-handling `\text{\_}`) will surface here, even if
  // none of the concrete input→expected pairs above happen to cover it.
  test.each([
    // --- basics ---
    'plain text without LaTeX',
    '',
    '   \n\n  ',
    // --- single/double dollar ---
    '$x^2 + y^2 = z^2$',
    '$$E = mc^2$$',
    'Inline $$a+b$$ and display $$c+d$$',
    // --- currency ---
    'Price is $100',
    'Total: $29.50 plus tax',
    '$250k is 25% of $1M',
    // --- escaped currency (already processed form) ---
    'Already escaped \\$50 and \\$100',
    // --- bracket delimiters ---
    '\\[x^2\\] and \\(y^2\\)',
    // --- mhchem ---
    '$\\ce{H2O}$ and $\\pu{123 J}$',
    // --- code protection ---
    '`$lookup` in code',
    '```\n$100\n```\nOutside $x^2$',
    'Mixed $$x$$ and `code with $100` text',
    // --- underscore in \text ---
    '$\\text{node_domain}$',
    '$\\text{node\\_domain}$',
    // --- pipes ---
    '$|x|$',
    '$$\\begin{array}{cc|c} 1 & 0 & a \\end{array}$$',
    '$$|x| + \\begin{array}{c|c} a & b \\end{array}$$',
    // --- HTML tag protection ---
    'Use <span>$</span>100 and $x^2$',
    'text <br/> and $y^2$',
    // --- currency inside LaTeX ---
    '$\\text{Total} = \\$500 + \\$200$',
    '- **Simple Interest**: $A = P + Prt = $1,000 + ($1,000)(0.05)(2) = $1,100$',
    // --- streaming partial (gets truncated) ---
    'writing: $$\\vert{}\\psi\\rangle = \\alpha\\vert{}0\\rangle',
    '$$|a|$$ then $$|b\\rangle',
    // --- CJK mixed ---
    '中文 $x^2$ 混合内容',
    '占用：$8.29 \\text{ B} \\times 4 \\text{ bytes} \\times 2 = \\mathbf{66.3 \\text{ GB}}$',
    // --- Multi-backtick code spans ---
    'before `` `$x^2$` `` after $y^2$',
    'pre ``` a $y$ then ``` post $z$',
    'see ``$100\nnext`` and $y$',
    // --- Brace-aware \text{} ---
    '$\\text{outer {inner}_x}$',
    '$\\text{a_b {c_d {e_f}}}$',
    '$\\text{a\\{b_c\\}_d}$',
    // --- Unmatched mid-line backtick runs stay literal ---
    'The token ``` should be shown, then $y$',
  ])('f(f(x)) === f(x) for: %s', (input) => {
    const once = preprocessLaTeX(input);
    const twice = preprocessLaTeX(once);
    expect(twice).toBe(once);
  });
});

describe('preprocessLaTeX streaming (incremental prefix)', () => {
  // Feeds growing prefixes of a representative streaming message through the
  // preprocessor. Asserts:
  //  - no prefix throws;
  //  - the final output is stable (once the full message is streamed, the
  //    result equals the one-shot result);
  //  - `f(f(prefix)) === f(prefix)` holds at every step (streaming idempotence).
  //
  // This codifies the contract the recent fixes target — the pipeline must
  // stay robust against partial/incomplete input at any token boundary.

  const STREAMING_MESSAGES = [
    // Mix: closed display math, inline math, currency, CJK, and a trailing
    // unclosed $$ that only closes at the very end.
    '## 费用说明\n\n单价为 $50,总计 \\$x^2 + y^2 = z^2\\$。\n\n公式:\n\n$$E = mc^2$$\n\n再看 $\\phi(n) = n$。\n\n未完: $$|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle$$',
    // Code block followed by math — tests cross-segment behavior under streaming.
    'Step 1:\n\n```ts\nconst price = $100;\n```\n\nThen $f(x) = x^2$ and \\[y = x^3\\].',
    // LaTeX bracket delimiters + backslash-escaped $$
    'Total: \\$$100 done. Formula \\[a^2 + b^2 = c^2\\] end.',
    // Literal-content HTML container that is opened mid-stream.
    'inline <code>$x^2$</code> then open <code>$y^2$ before closing</code> and $z^2$',
  ];

  test.each(STREAMING_MESSAGES)('streaming prefixes never throw — %#', (message) => {
    for (let i = 0; i <= message.length; i++) {
      const prefix = message.substring(0, i);
      expect(() => preprocessLaTeX(prefix)).not.toThrow();
    }
  });

  test.each(STREAMING_MESSAGES)('final streamed result equals one-shot result — %#', (message) => {
    const oneShot = preprocessLaTeX(message);
    // Simulate last chunk landing — final prefix is the full message.
    const streamedFinal = preprocessLaTeX(message);
    expect(streamedFinal).toBe(oneShot);
  });

  test.each(STREAMING_MESSAGES)('every streaming prefix is idempotent — %#', (message) => {
    // Step in reasonable increments so the test runs fast but still covers
    // boundary-crossing prefixes (every 4 chars of a typical stream chunk).
    const step = Math.max(1, Math.floor(message.length / 64));
    for (let i = 0; i <= message.length; i += step) {
      const prefix = message.substring(0, i);
      const once = preprocessLaTeX(prefix);
      const twice = preprocessLaTeX(once);
      expect(twice).toBe(once);
    }
  });

  test('streaming $$ block never leaks into the rest of the document before it closes', () => {
    // An unclosed $$ should always be truncated — never swallow subsequent
    // content. Once the closing $$ arrives, the full block is preserved.
    const full = 'before\n\n$$x^2 + y^2 = z^2$$\n\nafter';
    for (let i = 0; i < full.length; i++) {
      const prefix = full.substring(0, i);
      const out = preprocessLaTeX(prefix);
      // Invariant: output never contains a stray unclosed $$ block.
      const unclosed = /\$\$[\S\s]*?$/m.test(out) && (out.match(/\$\$/g)?.length ?? 0) % 2 !== 0;
      expect(unclosed).toBe(false);
    }
    // When the full message has streamed, the closed block is preserved.
    expect(preprocessLaTeX(full)).toBe(full);
  });
});

describe('splitByProtectedRegions', () => {
  test('returns single text segment for plain text', () => {
    expect(splitByProtectedRegions('hello world')).toEqual([{ kind: 'text', text: 'hello world' }]);
  });

  test('returns empty array for empty string', () => {
    expect(splitByProtectedRegions('')).toEqual([]);
  });

  test('identifies inline code as protected', () => {
    expect(splitByProtectedRegions('before `code` after')).toEqual([
      { kind: 'text', text: 'before ' },
      { kind: 'code', text: '`code`' },
      { kind: 'text', text: ' after' },
    ]);
  });

  test('identifies backtick fenced code block as protected', () => {
    expect(splitByProtectedRegions('before\n```\ncode\n```\nafter')).toEqual([
      { kind: 'text', text: 'before\n' },
      { kind: 'code', text: '```\ncode\n```' },
      { kind: 'text', text: '\nafter' },
    ]);
  });

  test('identifies tilde fenced code block as protected', () => {
    expect(splitByProtectedRegions('before\n~~~\ncode\n~~~\nafter')).toEqual([
      { kind: 'text', text: 'before\n' },
      { kind: 'code', text: '~~~\ncode\n~~~' },
      { kind: 'text', text: '\nafter' },
    ]);
  });

  test('identifies known HTML tags as protected', () => {
    expect(splitByProtectedRegions('text <span>$</span> more')).toEqual([
      { kind: 'text', text: 'text ' },
      { kind: 'tag', text: '<span>' },
      { kind: 'text', text: '$' },
      { kind: 'tag', text: '</span>' },
      { kind: 'text', text: ' more' },
    ]);
  });

  test('identifies HTML tag at position 0 (sticky regex regression)', () => {
    // Regression test for the sticky-regex approach: ensures we correctly
    // matched at position 0 (the `^` anchor was removed when switching to `/y`).
    expect(splitByProtectedRegions('<span>x</span>')).toEqual([
      { kind: 'tag', text: '<span>' },
      { kind: 'text', text: 'x' },
      { kind: 'tag', text: '</span>' },
    ]);
  });

  test('does not treat mid-line ``` as a fence opener (CommonMark)', () => {
    // `before \`\`\`` is mid-line; it is not a fence opener. It is only an
    // inline-code-span opener of N=3, but without a matching closing run of
    // exactly 3 backticks the whole sequence stays literal.
    expect(splitByProtectedRegions('before ```\ncode $100')).toEqual([{ kind: 'text', text: 'before ```\ncode $100' }]);
  });

  test('does not treat mid-line ~~~ as a fence opener (CommonMark)', () => {
    // `~` is never an inline-code-span delimiter; mid-line `~~~` is plain text.
    expect(splitByProtectedRegions('before ~~~\ncode $100')).toEqual([{ kind: 'text', text: 'before ~~~\ncode $100' }]);
  });

  test('does not treat unclosed inline backtick as protected', () => {
    expect(splitByProtectedRegions('text ` unclosed $x^2$')).toEqual([{ kind: 'text', text: 'text ` unclosed $x^2$' }]);
  });

  test('inline code span of length N swallows intervening ``` runs', () => {
    // The single backtick at pos 5 opens an inline code span of length 1. The
    // two mid-line ``` runs are of length 3 and therefore cannot close it;
    // the span keeps scanning until the matching single backtick before ` done`.
    expect(splitByProtectedRegions('text `start ```\ncode\n``` end` done')).toEqual([
      { kind: 'text', text: 'text ' },
      { kind: 'code', text: '`start ```\ncode\n``` end`' },
      { kind: 'text', text: ' done' },
    ]);
  });

  test('requires matching fence length to close (shorter fence stays open)', () => {
    expect(splitByProtectedRegions('````\ncode\n```\nmore')).toEqual([{ kind: 'code', text: '````\ncode\n```\nmore' }]);
  });

  test('allows longer fence to close shorter opening', () => {
    expect(splitByProtectedRegions('```\ncode\n````\nafter')).toEqual([
      { kind: 'code', text: '```\ncode\n````' },
      { kind: 'text', text: '\nafter' },
    ]);
  });

  test('does not treat non-HTML angle brackets as protected', () => {
    expect(splitByProtectedRegions('a < b and <Custom> tag')).toEqual([
      { kind: 'text', text: 'a < b and <Custom> tag' },
    ]);
  });

  test('handles multiple adjacent inline code blocks', () => {
    expect(splitByProtectedRegions('`a` `b` text')).toEqual([
      { kind: 'code', text: '`a`' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: '`b`' },
      { kind: 'text', text: ' text' },
    ]);
  });

  test('handles self-closing HTML tags', () => {
    expect(splitByProtectedRegions('text <br/> more')).toEqual([
      { kind: 'text', text: 'text ' },
      { kind: 'tag', text: '<br/>' },
      { kind: 'text', text: ' more' },
    ]);
  });

  test('handles code block with language specifier', () => {
    expect(splitByProtectedRegions('```python\nprint()\n```')).toEqual([
      { kind: 'code', text: '```python\nprint()\n```' },
    ]);
  });

  test('does not cross fence marker types (backtick open, tilde close)', () => {
    expect(splitByProtectedRegions('```\ncode\n~~~\nmore')).toEqual([{ kind: 'code', text: '```\ncode\n~~~\nmore' }]);
  });

  test('handles HTML tags with attributes', () => {
    expect(splitByProtectedRegions('text <span class="x">$</span> end')).toEqual([
      { kind: 'text', text: 'text ' },
      { kind: 'tag', text: '<span class="x">' },
      { kind: 'text', text: '$' },
      { kind: 'tag', text: '</span>' },
      { kind: 'text', text: ' end' },
    ]);
  });

  test('protects entire <code>...</code> including inner text', () => {
    expect(splitByProtectedRegions('pre <code>$x^2$</code> post')).toEqual([
      { kind: 'text', text: 'pre ' },
      { kind: 'literal', text: '<code>$x^2$</code>' },
      { kind: 'text', text: ' post' },
    ]);
  });

  test('protects entire <pre>...</pre> including inner text', () => {
    expect(splitByProtectedRegions('<pre>$100</pre> x')).toEqual([
      { kind: 'literal', text: '<pre>$100</pre>' },
      { kind: 'text', text: ' x' },
    ]);
  });

  test('protects entire <math>...</math> including inner text', () => {
    expect(splitByProtectedRegions('<math>$a$</math>')).toEqual([{ kind: 'literal', text: '<math>$a$</math>' }]);
  });

  test('protects <code> with attributes', () => {
    expect(splitByProtectedRegions('<code class="x">$y$</code>')).toEqual([
      { kind: 'literal', text: '<code class="x">$y$</code>' },
    ]);
  });

  test('case-insensitive match for <CODE>...</CODE>', () => {
    expect(splitByProtectedRegions('<CODE>$x$</CODE>')).toEqual([{ kind: 'literal', text: '<CODE>$x$</CODE>' }]);
  });

  test('unclosed <code> protects everything to end of input (streaming)', () => {
    // When the closer hasn't streamed in yet, protect the tail to avoid
    // mutating `$x$` before the `</code>` arrives in a later chunk.
    expect(splitByProtectedRegions('<code>$x$ tail')).toEqual([{ kind: 'literal', text: '<code>$x$ tail' }]);
  });

  test('self-closing <math/> is not treated as paired container', () => {
    expect(splitByProtectedRegions('<math/>$a$')).toEqual([
      { kind: 'tag', text: '<math/>' },
      { kind: 'text', text: '$a$' },
    ]);
  });

  // --- CommonMark delimiter-run correctness ---

  test('protects `` ``...`` `` multi-backtick code span containing literal backticks', () => {
    expect(splitByProtectedRegions('before `` `x` `` after')).toEqual([
      { kind: 'text', text: 'before ' },
      { kind: 'code', text: '`` `x` ``' },
      { kind: 'text', text: ' after' },
    ]);
  });

  test('protects an inline code span of length 3 delimited by mid-line ``` runs', () => {
    expect(splitByProtectedRegions('pre ``` a $x$ b ``` post')).toEqual([
      { kind: 'text', text: 'pre ' },
      { kind: 'code', text: '``` a $x$ b ```' },
      { kind: 'text', text: ' post' },
    ]);
  });

  test('skips backtick runs of the wrong length when matching a code-span closer', () => {
    // Opening run of 2; the mid run of 3 is NOT a valid closer, so the span
    // continues until the matching run of exactly 2.
    expect(splitByProtectedRegions('pre `` x ``` y `` post')).toEqual([
      { kind: 'text', text: 'pre ' },
      { kind: 'code', text: '`` x ``` y ``' },
      { kind: 'text', text: ' post' },
    ]);
  });

  test('treats an unmatched mid-line ``` run as literal (no code-span close)', () => {
    expect(splitByProtectedRegions('a ``` b then $x$')).toEqual([{ kind: 'text', text: 'a ``` b then $x$' }]);
  });

  test('requires fence closer to be at line start (≤3 space indent)', () => {
    // Opening fence is at line start. A run of 3 backticks mid-line inside the
    // block (`foo \`\`\` bar`) must NOT close the fence — only the run on its
    // own line does.
    expect(splitByProtectedRegions('```\nfoo ``` bar\n```\nafter')).toEqual([
      { kind: 'code', text: '```\nfoo ``` bar\n```' },
      { kind: 'text', text: '\nafter' },
    ]);
  });

  test('allows any indentation before a fence opener/closer (container-relative rule not modelled)', () => {
    expect(splitByProtectedRegions('text\n   ```\ncode\n   ```\nafter')).toEqual([
      { kind: 'text', text: 'text\n   ' },
      { kind: 'code', text: '```\ncode\n   ```' },
      { kind: 'text', text: '\nafter' },
    ]);
    // v2.4.2 review P1-3: a fence two list levels deep sits at column 4.
    const nested = '- a\n  - b\n    ~~~\n    price = $100 total\n    ~~~\n\n$x$';
    expect(preprocessLaTeX(nested)).toBe('- a\n  - b\n    ~~~\n    price = $100 total\n    ~~~\n\n$$x$$');
    const nestedTicks = '- a\n  - b\n    ```\n    price = $100 total\n    ```\n\n$x$';
    expect(preprocessLaTeX(nestedTicks)).toBe('- a\n  - b\n    ```\n    price = $100 total\n    ```\n\n$$x$$');
    // A tab-indented fence too.
    expect(preprocessLaTeX('\t~~~\n\t$100\n\t~~~\n$x$')).toBe('\t~~~\n\t$100\n\t~~~\n$$x$$');
  });

  test('a closer indented more than 3 columns past its opener is content, not a closer', () => {
    // A markdown tutorial: an outer column-0 fence showing a nested-list
    // fence at column 4. The inner ``` lines are CONTENT of the outer block.
    const doc = '```markdown\n- item\n    ```js\n    x\n    ```\nprice = $100 and $200 here\n```\n\nafter $x$ math\n';
    expect(preprocessLaTeX(doc)).toBe(
      '```markdown\n- item\n    ```js\n    x\n    ```\nprice = $100 and $200 here\n```\n\nafter $$x$$ math\n'
    );
    // …while a closer up to 3 columns deeper than its opener still closes.
    expect(preprocessLaTeX('```\n$100\n   ```\n$x$')).toBe('```\n$100\n   ```\n$$x$$');
  });

  test('KNOWN LIMITATION: indented code blocks are not protected (no container model)', () => {
    // Documented in the module header — a list continuation paragraph and
    // an indented code block are indistinguishable without a container
    // model, and protecting 4-space lines would silence math in nested
    // lists. Pinned so a future change is a conscious one.
    expect(preprocessLaTeX('para\n\n    $x$ and $100\n\nafter')).toBe('para\n\n    $$x$$ and \\$100\n\nafter');
  });
});
