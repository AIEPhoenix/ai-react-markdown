import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Features/Math',
  parameters: {
    docs: {
      description: {
        component:
          'Inline and display math via `remark-math` + KaTeX. A built-in LaTeX preprocessor ' +
          'runs first and fixes the rough edges of model-emitted math: currency `$`, ' +
          '`\\[…\\]` / `\\(…\\)` delimiters, table-pipe escaping, and `mhchem`. Requires ' +
          "`import 'katex/dist/katex.min.css'`.",
      },
    },
  },
};

export default meta;

/** Inline math sits in running text; display math gets its own centered block. */
export const InlineAndDisplay: CoreStory = {
  args: {
    content: String.raw`Euler's identity, $e^{i\pi} + 1 = 0$, ties together five constants inline.

The Gaussian integral as a display block:

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

And a matrix:

$$
\begin{bmatrix} a & b \\ c & d \end{bmatrix}
\begin{bmatrix} x \\ y \end{bmatrix}
=
\begin{bmatrix} ax + by \\ cx + dy \end{bmatrix}
$$`,
  },
};

/**
 * The preprocessor normalizes the alternate delimiters LLMs love to emit —
 * `\(…\)` for inline and `\[…\]` for display — into the `$…$` / `$$…$$` form
 * `remark-math` understands. No configuration needed.
 */
export const BracketDelimiters: CoreStory = {
  args: {
    content: String.raw`Written with TeX-style delimiters instead of dollar signs:

Inline: \(a^2 + b^2 = c^2\) renders just like dollar-delimited math.

Display:

\[
f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(0)}{n!} x^n
\]`,
  },
};

/**
 * The single hardest disambiguation in markdown math: a `$` that means *money*
 * versus a `$` that opens a formula. The preprocessor recognizes currency
 * patterns so prices render as plain text and never swallow the rest of the
 * line into a formula.
 */
export const CurrencyVsMath: CoreStory = {
  args: {
    content: String.raw`The license costs $5.99 per seat, or $59.90 per year — these stay as prices.

But $E = mc^2$ is still parsed as math, because the preprocessor only treats a
dollar sign as currency when it looks like currency (a digit follows, and there
is no closing dollar on the same line).

A range like $10–$20 also survives without collapsing into a formula.`,
  },
};

/**
 * `mhchem` chemical equations and pipes inside math both work: the preprocessor
 * escapes `|` so a formula can live inside a GFM table cell without the pipe
 * being read as a column separator.
 */
export const ChemistryAndTables: CoreStory = {
  args: {
    content: String.raw`Chemical equation via mhchem:

$$\ce{2 H2 + O2 -> 2 H2O}$$

Math inside a table cell (note the pipe in the set-builder notation survives):

| Concept | Definition |
| ------- | ---------- |
| Norm | $\lVert x \rVert = \sqrt{x_1^2 + x_2^2}$ |
| Set | $\{\, x \mid x > 0 \,\}$ |
| Limit | $\lim_{n \to \infty} \frac{1}{n} = 0$ |`,
  },
};
