/**
 * Shared fixtures for the soft-atom model: the shapes the unit tests pin
 * byte-for-byte and the differential gate classifies against the legacy arm.
 * One module so a refactor cannot leave one consumer with an empty list
 * (the gate asserts a non-zero count per source).
 *
 * `LINE_ENDINGS` triplicates every multi-line shape: the lexer, the currency
 * counter and `opensMathFlow` all treat `\n`, `\r\n` and a lone `\r` as line
 * endings, so a pin that only used `\n` would prove nothing about the other
 * two.
 */

export const LINE_ENDINGS: ReadonlyArray<readonly [name: string, eol: string]> = [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['CR', '\r'],
];

/** Inputs with `{eol}` placeholders, expanded per line ending. */
export const SOFT_ATOM_SHAPES: readonly string[] = [
  // the defect
  '$x <br> y$',
  '$$ a <br> b $$',
  '| $a <b>x</b> b$ |',
  '$${eol}a <br>{eol}b{eol}$$',
  '$${eol}a{eol}<br>{eol}b{eol}$$',
  '$${eol}a <br> b',
  // idiom and attributes
  '<span>$</span>100 and $x^2$',
  'Price is <span>$</span>100 and formula $x^2$',
  '<span>$</span>50 is half of <span>$</span>100',
  '<a href="a|b">x</a>',
  '<a title="\\[x\\]">x</a>',
  // scopes
  '<b><i>$x$</i></b>',
  '<b><i>$x$</b></i>',
  '<b><i></b>$x$</i>',
  'x</b>y $a$',
  '<b>a<br>b</b>',
  '<b>$$ x</b>',
  '<b>\\text{x</b> $y$',
  '<b>\\[x</b> $y$',
  // line origin
  '`c`$$ x',
  '`c`{eol}{eol}$$ x',
  '<br>$$ x',
  '<br>{eol}$$ x',
  'a <br>$$ x',
  'a{eol}$$ x',
  // parity, brackets, mhchem
  '$100 <br> $x',
  '$5 <b>and</b> $6',
  '\\[ a <br> b \\]',
  '$<b>\\ce{H2O}</b>$',
  // multi-line tags stay hard boundaries
  '$a <span{eol} title="x">b$',
  '$$ a <span{eol} title="x">b',
  // atoms inside a truncated tail
  '$${eol}a <br> b <i>c</i>',
  // an unclosed delimiter before a tag now governs the text after it
  'price $ one <br>{eol}a | b',
  '$${eol}open <span>{eol}$x$ and $y$',
  // private-use input
  'prose \uE000 and $x <br> y$',
  // hard boundaries beside atoms
  '`code` <br> $x$',
  '<code>$x$</code> <br> $y$',
];

export function expandShape(shape: string, eol: string): string {
  return shape.split('{eol}').join(eol);
}

/** Every shape × every line ending, deduplicated (shapes without `{eol}`
 *  expand to themselves three times). */
export function softAtomFixtures(): string[] {
  const out = new Set<string>();
  for (const shape of SOFT_ATOM_SHAPES) for (const [, eol] of LINE_ENDINGS) out.add(expandShape(shape, eol));
  return [...out];
}
