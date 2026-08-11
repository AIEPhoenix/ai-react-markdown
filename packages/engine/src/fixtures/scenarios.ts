/**
 * Streaming stress-payload fixtures, extracted verbatim from core's
 * stories/streaming/scenarios.ts (boundary action ⑦): the engine's
 * equivalence/sensitivity test batteries consume DEFAULT_PAYLOAD/withDefs,
 * and stories keep using them through the engine entry — one source, no
 * drifting copies.
 *
 * @module fixtures/scenarios
 */

const DEFAULT_BLOCKS = [
  '# Stress payload\n\n',
  'Streaming markdown with mixed token boundaries — code, math, tables, admonitions — all incomplete during transit.\n\n',
  '```ts\nconst fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));\nconst result = Array.from({ length: 12 }, (_, i) => fib(i));\n```\n\n',
  '$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n\n',
  'Inline math like $E = mc^2$ and $\\frac{a}{b}$ keeps appearing.\n\n',
  '| Lang | Year | Stable |\n| --- | --- | --- |\n| JavaScript | 1995 | yes |\n| TypeScript | 2012 | yes |\n| Rust | 2010 | yes |\n\n',
  '> The hard part is **incomplete tokens** — code fences, LaTeX delimiters, table rows mid-emission.\n\n',
  '- bullet one with `inline code`\n- bullet two with [link](https://example.com)\n- bullet three closes the test payload.\n',
];

export const DEFAULT_PAYLOAD = DEFAULT_BLOCKS.join('');

/** Definition-bearing tail appended by {@link withDefs}: footnote and
 *  link-reference defs WITH in-text references. */
const DEFS_TAIL =
  'References[^n1] appear mid-prose[^n2], along with [reference links][spec] and [another one][gfm].\n\n' +
  '[^n1]: First footnote body with `code` and a [link](https://example.com/fn).\n' +
  '[^n2]: Second footnote body, plain text.\n\n' +
  '[spec]: https://spec.commonmark.org\n' +
  '[gfm]: https://github.github.com/gfm/ "GFM spec"\n';

/**
 * Append the definitions tail to a payload (any payload — including the
 * ALREADY-SCALED one; apply after `.repeat()` so one tail serves the whole
 * document and no repeat seam glues a def line onto the next repetition).
 *
 * What this exercises — and what it does NOT: the default payload contains
 * zero definitions, so without this tail the def-label scanner runs on a
 * best-case input and the aggregate footnote footer never renders. With
 * it, def lines stream through the scanner's active region (its full-parse
 * slow path) and the footer assembles. It does NOT exercise the
 * cross-chunk PHANTOM path: each benchmark side is a single chunk, so no
 * label is ever defined "elsewhere" and the phantom candidate set stays
 * empty — measuring that needs a second chunk contributing definitions
 * the first one references.
 */
export function withDefs(payload: string): string {
  const sep = payload.endsWith('\n\n') ? '' : payload.endsWith('\n') ? '\n' : '\n\n';
  return payload + sep + DEFS_TAIL;
}
