/**
 * Exact §4.6 type 7 — the classifier is pinned against micromark ITSELF,
 * not against a hand-written expectation table.
 *
 * `isType7Line` decides whether a line at block indent is one complete
 * open/closing tag followed by whitespace only (CommonMark's condition 7).
 * For a line whose tag name is neither a type-6 name nor a type-1 name and
 * that does not sit on a paragraph continuation, micromark's block choice
 * is EXACTLY "html iff condition 7 holds" — so the conformance test below
 * parses each shape with the real remark-parse and demands agreement. A
 * micromark upgrade that shifts the grammar fails this file rather than
 * silently drifting from the scanner.
 *
 * Measured facts this pins (2026-08-25, remark-parse 11 / micromark 4):
 * - a QUOTED attribute value may contain `>` — `<span title="a>b">` alone
 *   on a line IS a type-7 block (the `[^>]*` approximation's hole, which
 *   `mayBeRawToMicromark` existed to cover);
 * - an UNQUOTED value may not (`<span title=a>b>` is a paragraph), may not
 *   be empty (`<a href=>` is a paragraph), and excludes `` ` ``;
 * - attribute names follow `[A-Za-z_:][A-Za-z0-9:._-]*` (`<i :a.b=c>` is a
 *   block, `<i .a=c>` a paragraph);
 * - `/` self-closes only directly before `>` (`<div/ >` is a paragraph);
 * - a CLOSING tag takes no attributes but its NAME is unrestricted:
 *   `</style>` alone on a line is a type-7 block — the earlier "raw-text
 *   names are paragraphs as end tags" note was wrong, and harmless only
 *   while the run flag blanket-covered every `<`-starting line.
 */
import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { isType7Line } from './computeFreezeBoundary';

/** micromark's block truth for a line standing at block start: html or not.
 *  The suffix line forces the block to have content after it so a lazy
 *  paragraph continuation cannot masquerade as agreement. */
function micromarkSaysHtml(line: string): boolean {
  const tree = unified().use(remarkParse).parse(`${line}\n\nafter\n`);
  const first = (tree as { children: Array<{ type: string }> }).children[0];
  return first !== undefined && first.type === 'html';
}

/** Non-type-6, non-type-1 tag names only — for these, "html block" ⟺
 *  "condition 7 holds", which is the equivalence the classifier owns. */
const CONDITION7_SHAPES = [
  '<span title="a>b">',
  "<i a='x>y'>",
  '<DIV-X Title="a>b">',
  '<span title=a>b>',
  '<foo a=b=c>',
  '<foo "quoted">',
  '<foo a =\t"v" >',
  '<x-y/>',
  '<foo/ >',
  '<a href="u"> \t',
  '<a href>',
  '<a href=>',
  '<i :a.b=c>',
  '<i .a=c>',
  '<em>',
  '<foo bar',
  '</span>',
  '</span a="b">',
  '</foo  >',
  '</style>',
  '</textarea>',
  '</pre>',
  '</script>',
  '<foo a="b" c=d e>',
  "<foo a='unterminated",
  '<foo ->',
  '<foo a-b=c>',
  '<foo a=b= c>',
  '<foo a==>',
  '<foo a=`t`>',
  '<foo a=/>',
  '<foo a=b/c>',
  '<style/>',
  '<textarea/>',
  '<style/ >',
];

describe('exact type 7 classifier', () => {
  test('agrees with micromark on every condition-7 shape', () => {
    for (const line of CONDITION7_SHAPES) {
      expect({ line, type7: isType7Line(line) }).toEqual({ line, type7: micromarkSaysHtml(line) });
    }
  });

  test('the load-bearing individual facts stay put', () => {
    // The hole the approximation had — and its exact complement.
    expect(isType7Line('<span title="a>b">')).toBe(true);
    expect(isType7Line('<span title=a>b>')).toBe(false);
    // Closing raw-text names ARE type 7 (Table A's note was wrong).
    expect(isType7Line('</style>')).toBe(true);
    // Open raw-text names are NOT (they are type 1, claimed earlier)…
    expect(isType7Line('<style>')).toBe(false);
    expect(isType7Line('<pre class="x">')).toBe(false);
    // …except with the self-closing slash straight after the name, which
    // micromark's tagName state dispatches past the raw-name check.
    expect(isType7Line('<style/>')).toBe(true);
    // Type-6 names never reach condition 7 (their own rules own the line).
    expect(isType7Line('<div a="b>">')).toBe(false);
    expect(isType7Line('</div>')).toBe(false);
    // micromark's unquoted-value automaton accepts `=` chains — looser
    // than the spec's written grammar, matched deliberately.
    expect(isType7Line('<foo a=b=c>')).toBe(true);
  });
});
