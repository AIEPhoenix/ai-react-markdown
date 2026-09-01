/**
 * The math the generated layer cannot reach.
 *
 * `generated.ts` covers KaTeX's VOCABULARY — every identifier in its tables,
 * exhaustively, as bare TeX fragments. This file covers two things that are
 * not vocabulary:
 *
 *  1. THE SEAMS. Math in this library does not arrive as TeX. It arrives as
 *     markdown, and `preprocessLaTeX` rewrites it on the way in: currency
 *     dollars are escaped, bracket delimiters become dollars, pipes inside a
 *     formula are replaced so GFM does not read them as table cells, single
 *     dollars become double, and an unclosed trailing block is truncated
 *     because a stream can stop mid-formula. Every one of those is a place
 *     where math, markdown and streaming meet, and it is where this engine's
 *     bugs have actually lived. A corpus of bare TeX cannot see any of them.
 *
 *  2. DOCUMENT SHAPE. A packed line of 12 symbols joined by `\quad` proves
 *     coverage and proves nothing about cost: real formulas nest, stack,
 *     align and size their delimiters, and those are the operations that make
 *     KaTeX expensive.
 *
 * EVERY SEAM CASE BELOW WAS RUN THROUGH THE ENGINE BEFORE IT WAS WRITTEN.
 * The `probes` text describes the transform that was actually observed, not
 * the one the source comments promise — several differ in detail (a bare pipe
 * becomes `\vert{}` rather than being backslash-escaped; `\(...\)` becomes
 * `$$...$$` rather than `$...$`).
 *
 * WHAT THIS FILE DOES NOT CONTAIN: expected outputs. The corpus owns inputs;
 * assertions belong to the consumer that makes them, so there is one place to
 * update when the engine legitimately changes and not two.
 */

export interface MathCase {
  /** Stable id. Used in benchmark scenario ids and test names. */
  readonly id: string;
  /** What this case is here to expose. */
  readonly probes: string;
  /** Markdown source — NOT bare TeX. These exist to be fed to the renderer. */
  readonly src: string;
}

/**
 * The `preprocessLaTeX` seams, one case per documented behaviour plus the
 * boundaries that decide whether each fires.
 *
 * Deliberately includes inputs that must NOT be rewritten. A rewrite rule is
 * only as good as the thing it declines to touch, and every one of these
 * negative cases is a shape that a naive version of the rule would have eaten:
 * a markdown image looks like a display-math opener, a markdown link looks
 * like one too, and a table row full of prices looks like six formulas.
 */
export const MATH_SEAM_CASES: readonly MathCase[] = [
  {
    id: 'seam-currency-plain',
    probes: 'a price is not a formula — `$100` and `$1,000.50` are escaped, not opened',
    src: 'The plan costs $100 up front and $1,000.50 a year, or $2.5K over three years.',
  },
  {
    id: 'seam-currency-vs-math',
    probes:
      'the parity rule: a `$` before digits is currency only if no unescaped `$` closes it later on the line',
    src: 'Revenue was $8.29 \\text{ B} \\times 4$ last year, against a $500 budget.',
  },
  {
    id: 'seam-currency-table',
    probes: 'a table row of prices — the shape whose per-match rescan was once quadratic',
    src: `| Tier | Monthly | Annual | Overage |
| --- | --- | --- | --- |
| Free | $0 | $0 | $0.10 |
| Pro | $20 | $200 | $0.05 |
| Team | $1,000 | $10,000.50 | $0.01 |`,
  },
  {
    id: 'seam-escaped-dollar',
    probes: 'an author who already escaped it must not be escaped twice',
    src: 'It costs \\$5 exactly, not \\$50.',
  },
  {
    id: 'seam-bracket-delimiters',
    probes: 'TeX bracket delimiters become dollar delimiters',
    src: `A display block:

\\[ \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt\\pi}{2} \\]

and an inline one, \\( a^2 + b^2 = c^2 \\), in a sentence.`,
  },
  {
    id: 'seam-bracket-vs-image',
    probes: 'a markdown image opens with the same two characters and must survive untouched',
    src: 'Here is a diagram: ![the pipeline](pipeline.png) and some text.',
  },
  {
    id: 'seam-bracket-vs-link',
    probes: 'an escaped-bracket link is not a display block either',
    src: 'See \\[the specification\\](https://example.test/spec) for the full grammar.',
  },
  {
    id: 'seam-pipe-in-math',
    probes: 'a bare pipe inside a formula would split a GFM table cell, so it is rewritten',
    src: `| Rule | Probability |
| --- | --- |
| Bayes | $P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$ |
| Norm | $\\|x\\|_2 = \\sqrt{\\sum x_i^2}$ |`,
  },
  {
    id: 'seam-array-column-spec',
    probes: 'the pipes in an array column spec are structure, not content, and must be left alone',
    src: '$\\begin{array}{c|c|c} a & b & c \\\\ \\hline d & e & f \\end{array}$',
  },
  {
    id: 'seam-text-underscore',
    probes: 'underscores inside \\text{} are prose, not emphasis markers',
    src: 'The field is $\\text{max_depth}$ and the flag is $\\text{no_cache}$.',
  },
  {
    id: 'seam-single-to-double',
    probes: 'single-dollar inline math is normalised to double',
    src: 'Given $x^2 + y^2 = r^2$ and $\\theta = \\arctan(y/x)$, the point is on the circle.',
  },
  {
    id: 'seam-unclosed-tail',
    probes: 'a stream that stops mid-formula — the trailing unclosed block is truncated',
    src: `Here is the derivation so far.

$$
\\frac{\\partial}{\\partial x} \\left( `,
  },
  {
    id: 'seam-unclosed-with-pipe',
    probes: 'an unclosed block containing a pipe, which is the streaming half of the pipe rule',
    src: 'Partial result: $$ P(A | B',
  },
  {
    id: 'seam-fenced-code-protected',
    probes: 'a fenced block is protected — none of the rules above may fire inside it',
    src: `Prices in the config:

\`\`\`json
{ "monthly": "$100", "formula": "\\\\[ x^2 \\\\]" }
\`\`\``,
  },
  {
    id: 'seam-inline-code-protected',
    probes: 'an inline code span is protected too, including the multi-backtick form',
    src: 'Write `$100` for a literal price, or `` `$x$` `` to show the markup itself.',
  },
  {
    id: 'seam-indented-code-limitation',
    probes:
      'a KNOWN LIMITATION pinned deliberately: indented code blocks are NOT protected, so a `$` inside one is rewritten',
    src: `A four-space block below.

    const price = "$100";
    const tex = "\\\\[ x^2 \\\\]";`,
  },
  {
    id: 'seam-html-protected',
    probes: 'a `$` inside an HTML tag is not a delimiter',
    src: 'Inline HTML: <span data-cost="$100">$</span> and then prose.',
  },
  {
    id: 'seam-mhchem',
    probes:
      'mhchem commands survive the markdown pass — but NOTHING in this repo loads katex/contrib/mhchem, so the render half is the consumer\'s job and these show as errors in the benchmark apps',
    src: 'Water is $\\ce{H2O}$ and the enthalpy is $\\pu{285.8 kJ//mol}$.',
  },
];

/**
 * Formulas shaped like the ones a model actually emits.
 *
 * Chosen for what they make KaTeX DO rather than for which symbols they name:
 * nested fractions recurse, `\left…\right` measures its content before it can
 * size a delimiter, matrices and alignments lay out a grid, and `\substack`
 * and multi-line limits stack boxes. The generated layer has none of that —
 * every fragment there is one identifier applied to a placeholder.
 */
export const MATH_AUTHORED: readonly MathCase[] = [
  {
    id: 'authored-inline-density',
    probes: 'many small inline formulas in flowing prose — the commonest real shape',
    src: `Let $f: \\mathbb{R}^n \\to \\mathbb{R}$ be convex with $\\nabla f$ Lipschitz of constant $L$. For a step size $\\eta \\le 1/L$ the iterate $x_{k+1} = x_k - \\eta \\nabla f(x_k)$ satisfies $f(x_k) - f^\\star \\le \\frac{\\|x_0 - x^\\star\\|^2}{2\\eta k}$, so $O(1/k)$ convergence needs no strong convexity.`,
  },
  {
    id: 'authored-nested-fractions',
    probes: 'recursive layout — a continued fraction four levels deep',
    src: `$$
\\varphi = 1 + \\cfrac{1}{1 + \\cfrac{1}{1 + \\cfrac{1}{1 + \\cfrac{1}{1 + \\ddots}}}}
$$`,
  },
  {
    id: 'authored-sized-delimiters',
    probes: '\\left…\\right must measure its content before it can size the fence',
    src: `$$
\\left[ \\sum_{i=1}^{n} \\left( \\frac{x_i - \\bar{x}}{\\sigma} \\right)^{2} \\right]^{1/2}
\\quad\\text{and}\\quad
\\left\\{ x \\;\\middle|\\; \\left| f(x) \\right| < \\varepsilon \\right\\}
$$`,
  },
  {
    id: 'authored-matrix',
    probes: 'grid layout, and an inverse written the way a textbook writes it',
    src: `$$
\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1}
= \\frac{1}{ad - bc} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}
$$`,
  },
  {
    id: 'authored-aligned-derivation',
    probes: 'multi-line alignment — the shape a model uses for a step-by-step derivation',
    src: `$$
\\begin{aligned}
  \\mathcal{L}(\\theta)
    &= -\\frac{1}{N} \\sum_{i=1}^{N} \\log p_\\theta(y_i \\mid x_i) \\\\
    &= -\\frac{1}{N} \\sum_{i=1}^{N} \\left[ y_i \\log \\hat{y}_i + (1 - y_i) \\log (1 - \\hat{y}_i) \\right] \\\\
  \\frac{\\partial \\mathcal{L}}{\\partial \\theta}
    &= \\frac{1}{N} \\sum_{i=1}^{N} (\\hat{y}_i - y_i) \\, x_i
\\end{aligned}
$$`,
  },
  {
    id: 'authored-cases',
    probes: 'a piecewise definition — braces sized around a two-column body',
    src: `$$
\\operatorname{relu}(x) = \\begin{cases}
  x & \\text{if } x > 0 \\\\
  0 & \\text{otherwise}
\\end{cases}
$$`,
  },
  {
    id: 'authored-substack-limits',
    probes: 'stacked limits under a large operator',
    src: `$$
\\sum_{\\substack{i = 1 \\\\ i \\neq j}}^{n} a_{ij}
\\qquad
\\lim_{\\substack{h \\to 0 \\\\ h > 0}} \\frac{f(x+h) - f(x)}{h}
$$`,
  },
  {
    id: 'authored-array-rules',
    probes:
      'the one context \\hline and \\hdashline are valid in — they are excluded from the generated layer for exactly this reason',
    src: `$$
\\begin{array}{c|c|c}
  n & a_n & b_n \\\\
  \\hline
  1 & 1 & 1 \\\\
  \\hdashline
  2 & 1 & 2 \\\\
  3 & 2 & 3
\\end{array}
$$`,
  },
  {
    id: 'authored-tags-and-labels',
    probes: 'numbered equations — the display-only construct set',
    src: `$$
\\begin{align}
  \\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\tag{1} \\\\
  \\nabla \\cdot \\mathbf{B} &= 0 \\tag{2} \\\\
  \\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t} \\notag \\\\
  \\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t} \\tag{4}
\\end{align}
$$`,
  },
  {
    id: 'authored-cd-diagram',
    probes: 'a commutative diagram — the CD environment, unlike anything else here',
    src: `$$
\\begin{CD}
  A @>f>> B \\\\
  @VgVV @VVhV \\\\
  C @>>k> D
\\end{CD}
$$`,
  },
  {
    id: 'authored-mixed-prose',
    probes: 'display and inline interleaved with headings and a list — a whole answer, not a fragment',
    src: `## Gradient descent

Given a differentiable $f$, the update is

$$
x_{k+1} = x_k - \\eta_k \\nabla f(x_k)
$$

where the step size $\\eta_k$ is chosen by one of:

1. a constant $\\eta_k = \\eta \\le 1/L$;
2. backtracking, until $f(x_k - \\eta d) \\le f(x_k) - c\\,\\eta\\,\\|\\nabla f(x_k)\\|^2$;
3. an exact line search, $\\eta_k = \\arg\\min_\\eta f(x_k - \\eta \\nabla f(x_k))$.

For strongly convex $f$ with modulus $\\mu$, the rate improves to
$\\left(1 - \\frac{\\mu}{L}\\right)^k$ — linear rather than $O(1/k)$.`,
  },
];

/** The whole authored layer as one markdown document. */
export const MATH_MARKDOWN: string = [...MATH_SEAM_CASES, ...MATH_AUTHORED]
  .map((c) => `### ${c.id}\n\n${c.probes}.\n\n${c.src}\n`)
  .join('\n');
