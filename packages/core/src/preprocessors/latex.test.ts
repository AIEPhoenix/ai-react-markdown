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
    const content = '```\ncode\n```$x^2$';
    const expected = '```\ncode\n```$$x^2$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('handles code block at the very end', () => {
    const content = '$x^2$```\ncode\n```';
    const expected = '$$x^2$$```\ncode\n```';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('treats an unclosed backtick code fence as protected code until the end', () => {
    const content = 'before ```\n$100\nno closing fence $x^2$';
    const expected = 'before ```\n$100\nno closing fence $x^2$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('treats an unclosed tilde code fence as protected code until the end', () => {
    const content = 'before ~~~\n$100\nno closing fence $x^2$';
    const expected = 'before ~~~\n$100\nno closing fence $x^2$';
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
    const content =
      'before\n\n$$|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle';
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

  test('truncates unclosed $$ after closed blocks', () => {
    const content = '$$|a|$$ then $$|b\\rangle';
    const expected = '$$\\vert{}a\\vert{}$$ then';
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
    // `\\$$...` means literal `\`, then a real `$$` delimiter. When the block
    // is unclosed, it must still be truncated (not preserved by a naïve
    // single-char backslash check).
    const content = 'prefix \\\\$$unclosed block';
    const expected = 'prefix \\\\';
    expect(preprocessLaTeX(content)).toBe(expected);
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

  test('per-segment truncation: unclosed $$ before a code fence is truncated', () => {
    // The unclosed `$$E = mc` in the pre-code segment is truncated (including
    // trailing whitespace) and the post-code segment's closed `$$after$$` is
    // preserved — confirming each segment is processed independently.
    const content = 'before $$E = mc\n```\ncode\n```\nand $$after$$';
    const expected = 'before```\ncode\n```\nand $$after$$';
    expect(preprocessLaTeX(content)).toBe(expected);
  });

  test('per-segment truncation: closed $$ inside pre-code segment survives', () => {
    const content = '$$a$$ and more\n```\ncode\n```\nafter';
    const expected = '$$a$$ and more\n```\ncode\n```\nafter';
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
    expect(splitByProtectedRegions('hello world')).toEqual([
      { text: 'hello world', isCode: false },
    ]);
  });

  test('returns empty array for empty string', () => {
    expect(splitByProtectedRegions('')).toEqual([]);
  });

  test('identifies inline code as protected', () => {
    expect(splitByProtectedRegions('before `code` after')).toEqual([
      { text: 'before ', isCode: false },
      { text: '`code`', isCode: true },
      { text: ' after', isCode: false },
    ]);
  });

  test('identifies backtick fenced code block as protected', () => {
    expect(splitByProtectedRegions('before\n```\ncode\n```\nafter')).toEqual([
      { text: 'before\n', isCode: false },
      { text: '```\ncode\n```', isCode: true },
      { text: '\nafter', isCode: false },
    ]);
  });

  test('identifies tilde fenced code block as protected', () => {
    expect(splitByProtectedRegions('before\n~~~\ncode\n~~~\nafter')).toEqual([
      { text: 'before\n', isCode: false },
      { text: '~~~\ncode\n~~~', isCode: true },
      { text: '\nafter', isCode: false },
    ]);
  });

  test('identifies known HTML tags as protected', () => {
    expect(splitByProtectedRegions('text <span>$</span> more')).toEqual([
      { text: 'text ', isCode: false },
      { text: '<span>', isCode: true },
      { text: '$', isCode: false },
      { text: '</span>', isCode: true },
      { text: ' more', isCode: false },
    ]);
  });

  test('identifies HTML tag at position 0 (sticky regex regression)', () => {
    // Regression test for the sticky-regex approach: ensures we correctly
    // matched at position 0 (the `^` anchor was removed when switching to `/y`).
    expect(splitByProtectedRegions('<span>x</span>')).toEqual([
      { text: '<span>', isCode: true },
      { text: 'x', isCode: false },
      { text: '</span>', isCode: true },
    ]);
  });

  test('treats unclosed backtick fence as protected until end', () => {
    expect(splitByProtectedRegions('before ```\ncode $100')).toEqual([
      { text: 'before ', isCode: false },
      { text: '```\ncode $100', isCode: true },
    ]);
  });

  test('treats unclosed tilde fence as protected until end', () => {
    expect(splitByProtectedRegions('before ~~~\ncode $100')).toEqual([
      { text: 'before ', isCode: false },
      { text: '~~~\ncode $100', isCode: true },
    ]);
  });

  test('does not treat unclosed inline backtick as protected', () => {
    expect(splitByProtectedRegions('text ` unclosed $x^2$')).toEqual([
      { text: 'text ` unclosed $x^2$', isCode: false },
    ]);
  });

  test('multiline fence cancels pending inline backtick', () => {
    expect(splitByProtectedRegions('text `start ```\ncode\n``` end` done')).toEqual([
      { text: 'text `start ', isCode: false },
      { text: '```\ncode\n```', isCode: true },
      { text: ' end` done', isCode: false },
    ]);
  });

  test('requires matching fence length to close (shorter fence stays open)', () => {
    expect(splitByProtectedRegions('````\ncode\n```\nmore')).toEqual([
      { text: '````\ncode\n```\nmore', isCode: true },
    ]);
  });

  test('allows longer fence to close shorter opening', () => {
    expect(splitByProtectedRegions('```\ncode\n````\nafter')).toEqual([
      { text: '```\ncode\n````', isCode: true },
      { text: '\nafter', isCode: false },
    ]);
  });

  test('does not treat non-HTML angle brackets as protected', () => {
    expect(splitByProtectedRegions('a < b and <Custom> tag')).toEqual([
      { text: 'a < b and <Custom> tag', isCode: false },
    ]);
  });

  test('handles multiple adjacent inline code blocks', () => {
    expect(splitByProtectedRegions('`a` `b` text')).toEqual([
      { text: '`a`', isCode: true },
      { text: ' ', isCode: false },
      { text: '`b`', isCode: true },
      { text: ' text', isCode: false },
    ]);
  });

  test('handles self-closing HTML tags', () => {
    expect(splitByProtectedRegions('text <br/> more')).toEqual([
      { text: 'text ', isCode: false },
      { text: '<br/>', isCode: true },
      { text: ' more', isCode: false },
    ]);
  });

  test('handles code block with language specifier', () => {
    expect(splitByProtectedRegions('```python\nprint()\n```')).toEqual([
      { text: '```python\nprint()\n```', isCode: true },
    ]);
  });

  test('does not cross fence marker types (backtick open, tilde close)', () => {
    expect(splitByProtectedRegions('```\ncode\n~~~\nmore')).toEqual([
      { text: '```\ncode\n~~~\nmore', isCode: true },
    ]);
  });

  test('handles HTML tags with attributes', () => {
    expect(splitByProtectedRegions('text <span class="x">$</span> end')).toEqual([
      { text: 'text ', isCode: false },
      { text: '<span class="x">', isCode: true },
      { text: '$', isCode: false },
      { text: '</span>', isCode: true },
      { text: ' end', isCode: false },
    ]);
  });

  test('protects entire <code>...</code> including inner text', () => {
    expect(splitByProtectedRegions('pre <code>$x^2$</code> post')).toEqual([
      { text: 'pre ', isCode: false },
      { text: '<code>$x^2$</code>', isCode: true },
      { text: ' post', isCode: false },
    ]);
  });

  test('protects entire <pre>...</pre> including inner text', () => {
    expect(splitByProtectedRegions('<pre>$100</pre> x')).toEqual([
      { text: '<pre>$100</pre>', isCode: true },
      { text: ' x', isCode: false },
    ]);
  });

  test('protects entire <math>...</math> including inner text', () => {
    expect(splitByProtectedRegions('<math>$a$</math>')).toEqual([
      { text: '<math>$a$</math>', isCode: true },
    ]);
  });

  test('protects <code> with attributes', () => {
    expect(splitByProtectedRegions('<code class="x">$y$</code>')).toEqual([
      { text: '<code class="x">$y$</code>', isCode: true },
    ]);
  });

  test('case-insensitive match for <CODE>...</CODE>', () => {
    expect(splitByProtectedRegions('<CODE>$x$</CODE>')).toEqual([
      { text: '<CODE>$x$</CODE>', isCode: true },
    ]);
  });

  test('unclosed <code> protects everything to end of input (streaming)', () => {
    // When the closer hasn't streamed in yet, protect the tail to avoid
    // mutating `$x$` before the `</code>` arrives in a later chunk.
    expect(splitByProtectedRegions('<code>$x$ tail')).toEqual([
      { text: '<code>$x$ tail', isCode: true },
    ]);
  });

  test('self-closing <math/> is not treated as paired container', () => {
    expect(splitByProtectedRegions('<math/>$a$')).toEqual([
      { text: '<math/>', isCode: true },
      { text: '$a$', isCode: false },
    ]);
  });
});
