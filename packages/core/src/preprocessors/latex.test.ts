import { describe, expect, test } from 'vitest';
import { preprocessLaTeX } from './latex';

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

  test('handles unclosed multiline code block gracefully', () => {
    const content = 'before ```\n$100\nno closing fence $x^2$';
    // Unclosed ``` — everything from ``` onward is treated as remaining text (not code)
    const expected = 'before ```\n\\$100\nno closing fence $$x^2$$';
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
});
