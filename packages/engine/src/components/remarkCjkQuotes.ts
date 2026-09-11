/**
 * CJK-aware quote pass that runs BEFORE `remark-smartypants` as part of the
 * `smartypants` engine plugin.
 *
 * SmartyPants decides whether a straight quote opens or closes from the
 * token before it: whitespace or punctuation opens, a word closes. Han,
 * kana and hangul are words to it, so in `中文"引号"中文` both quotes close
 * (`中文”引号”中文`). Running pangu first fixes the double quote by putting a
 * space in front of each one, but pangu pads every straight `'` on its own,
 * which turns `中文'引号'中文` into `中文 ’ 引号 ’ 中文`. Neither order gives
 * correct output for both quote kinds, so the quotes next to CJK text are
 * curled here, by pairing, and SmartyPants only ever sees the Latin ones.
 *
 * Rules, applied to every straight `"` or `'` in a `text` node that has a
 * CJK character (Han, hiragana, katakana, hangul, CJK punctuation or a
 * fullwidth form) directly before or after it:
 *
 * 1. start of the node, whitespace or an opening bracket before it → opening;
 * 2. else end of the node, whitespace or closing punctuation after it → closing;
 * 3. else a non-CJK letter or digit before it (`English"中文`) → closing;
 * 4. else the quote sits between two ink characters (`文"引`), and the pair
 *    state for that quote kind decides: not open → opening, open → closing.
 *
 * A quote without a CJK neighbour is left for SmartyPants, but where rules
 * 1-3 fix its direction that direction still feeds the pair state, so
 * `中文"English" 中文"引号"中文` opens the third quote instead of closing it.
 *
 * Pairing is per text node. That is what keeps the pass local: a node's
 * output depends only on its own value, so the splice path can reuse a
 * settled prefix and a streaming frame that cuts a paragraph mid-quote is
 * corrected by the next frame that sees the closing quote. Replacements are
 * one UTF-16 unit for one, so node positions do not move. Only `text`
 * nodes are visited; code, inline code, html and math keep their quotes.
 *
 * Nodes are replaced, not mutated in place, for the same reason as
 * `remarkStripComments`: the splice path keeps references into an earlier
 * frame's tree.
 *
 * @module components/remarkCjkQuotes
 */

import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

/** Han, kana, hangul, CJK symbols and punctuation, halfwidth and fullwidth forms. */
const CJK_RE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const OPENING_RE = /[\p{Ps}\p{Pi}]/u;
/** Closing brackets and final quotes plus the CJK clause terminators. */
const CLOSING_RE = /[\p{Pe}\p{Pf}，。、！？；：]/u;
const WORD_RE = /[\p{L}\p{N}]/u;
const SPACE_RE = /\s/u;

const OPEN_DOUBLE = '“';
const CLOSE_DOUBLE = '”';
const OPEN_SINGLE = '‘';
const CLOSE_SINGLE = '’';

/** The code point ending at `index` (exclusive), or `undefined` at the start. */
function codePointBefore(value: string, index: number): string | undefined {
  if (index === 0) return undefined;
  const unit = value.charCodeAt(index - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && index >= 2) return String.fromCodePoint(value.codePointAt(index - 2)!);
  return value[index - 1];
}

/** The code point starting at `index`, or `undefined` at the end. */
function codePointAt(value: string, index: number): string | undefined {
  if (index >= value.length) return undefined;
  return String.fromCodePoint(value.codePointAt(index)!);
}

function isCjk(char: string | undefined): boolean {
  return char !== undefined && CJK_RE.test(char);
}

/** Curl the CJK-adjacent straight quotes of one text value; `null` when nothing changes. */
export function curlCjkQuotes(value: string): string | null {
  if (!value.includes('"') && !value.includes("'")) return null;
  let out: string[] | null = null;
  let doubleOpen = false;
  let singleOpen = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== '"' && char !== "'") continue;
    const prev = codePointBefore(value, i);
    const next = codePointAt(value, i + 1);
    let opening: boolean | undefined;
    if (prev === undefined || SPACE_RE.test(prev) || OPENING_RE.test(prev)) opening = true;
    else if (next === undefined || SPACE_RE.test(next) || CLOSING_RE.test(next)) opening = false;
    else if (!isCjk(prev) && WORD_RE.test(prev)) opening = false;
    const cjkNeighbour = isCjk(prev) || isCjk(next);
    if (cjkNeighbour) opening ??= !(char === '"' ? doubleOpen : singleOpen);
    if (opening !== undefined) {
      if (char === '"') doubleOpen = opening;
      else singleOpen = opening;
    }
    if (!cjkNeighbour) continue;
    out ??= value.split('');
    out[i] = char === '"' ? (opening ? OPEN_DOUBLE : CLOSE_DOUBLE) : opening ? OPEN_SINGLE : CLOSE_SINGLE;
  }
  return out === null ? null : out.join('');
}

export default function remarkCjkQuotes() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (parent === undefined || index === undefined) return;
      const curled = curlCjkQuotes(node.value);
      if (curled === null) return;
      parent.children[index] = { ...node, value: curled };
    });
  };
}
