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
 * Rules, applied to every straight `"` or `'` that has a CJK character
 * (Han, hiragana, katakana, hangul, CJK punctuation or a fullwidth form)
 * directly before or after it:
 *
 * 1. start of the block, whitespace or an opening bracket before it → opening;
 * 2. else end of the block, whitespace or closing punctuation after it → closing;
 * 3. else a non-CJK letter or digit before it (`English"中文`) → closing;
 * 4. else the quote sits between two ink characters (`文"引`), and the pair
 *    state for that quote kind decides: not open → opening, open → closing.
 *
 * A quote without a CJK neighbour is left for SmartyPants, but where rules
 * 1-3 fix its direction that direction still feeds the pair state, so
 * `中文"English" 中文"引号"中文` opens the third quote instead of closing it.
 *
 * The state machine runs per phrasing block (paragraph, heading, table
 * cell) over that block's text nodes in document order, descending through
 * emphasis, strong, delete, link and the other inline parents, so a pair
 * split by inline markup still pairs: `中文'*引号*'中文` is three text
 * nodes and the third's quote closes. A hard break (remark-breaks has
 * turned the soft line endings into `break` nodes by the time this runs)
 * is whitespace to the neighbour test; inline code, html, math, images and
 * footnote references are opaque ink — never entered, never changed, and
 * neither whitespace nor CJK to the quote beside them. Text is never moved
 * between nodes. A block's output depends only on that block, so the
 * splice path can reuse a settled prefix, and a streaming frame that cuts
 * a paragraph mid-quote is corrected by the frame that brings the closer.
 * Replacements are one UTF-16 unit for one, so node positions do not move.
 *
 * Nodes are replaced, not mutated in place, for the same reason as
 * `remarkStripComments`: the splice path keeps references into an earlier
 * frame's tree.
 *
 * @module components/remarkCjkQuotes
 */

import type { Parent, Root, Text } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

/** Han, kana, hangul, CJK symbols and punctuation, halfwidth and fullwidth forms. */
const CJK_RE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\u3000-\u303f\uff00-\uffef]/u;
const OPENING_RE = /[\p{Ps}\p{Pi}]/u;
/** Closing brackets and final quotes plus the CJK clause terminators. */
const CLOSING_RE = /[\p{Pe}\p{Pf}，。、！？；：]/u;
const WORD_RE = /[\p{L}\p{N}]/u;
const SPACE_RE = /\s/u;
/** A decade after an apostrophe (`'90s`): SmartyPants closes it, whatever
 *  precedes it, and so does the pair state here — otherwise the space
 *  before `'90s` would count it as an opener and leave a single quote open
 *  for the rest of the block. */
const DECADE_RE = /\d\ds(?![\p{L}\p{N}])/uy;

const OPEN_DOUBLE = '“';
const CLOSE_DOUBLE = '”';
const OPEN_SINGLE = '‘';
const CLOSE_SINGLE = '’';

/** The blocks whose children are phrasing content. */
const PHRASING_BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);

/** Stands in for an opaque inline node (code, html, math, image, footnote
 *  reference) beside a quote: ink, but not whitespace, CJK, a letter or a
 *  bracket. micromark never emits U+0000 in text, so it cannot collide. */
const INK = '\u0000';

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

/** Does a decade (`90s`) start at `index` of `value`? */
function isDecade(value: string, index: number): boolean {
  DECADE_RE.lastIndex = index;
  return DECADE_RE.test(value);
}

/** Pair state for one block: whether a double / single quote is open. */
export interface QuoteState {
  double: boolean;
  single: boolean;
}

/**
 * Curl the CJK-adjacent straight quotes of one text value; `null` when
 * nothing changes. `before` / `after` are the characters adjoining the
 * value in its block (`undefined` at the block's start / end; a space for
 * a break; `INK` for an opaque node), and `state` carries the pairing
 * across the block's text nodes.
 */
export function curlCjkQuotes(
  value: string,
  state: QuoteState = { double: false, single: false },
  before?: string,
  after?: string
): string | null {
  if (!value.includes('"') && !value.includes("'")) return null;
  let out: string[] | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== '"' && char !== "'") continue;
    const prev = i === 0 ? before : codePointBefore(value, i);
    const next = i + 1 >= value.length ? after : codePointAt(value, i + 1);
    let opening: boolean | undefined;
    if (char === "'" && isDecade(value, i + 1)) opening = false;
    else if (prev === undefined || SPACE_RE.test(prev) || OPENING_RE.test(prev)) opening = true;
    else if (next === undefined || SPACE_RE.test(next) || CLOSING_RE.test(next)) opening = false;
    else if (!isCjk(prev) && WORD_RE.test(prev)) opening = false;
    const cjkNeighbour = isCjk(prev) || isCjk(next);
    if (cjkNeighbour) opening ??= !(char === '"' ? state.double : state.single);
    if (opening !== undefined) {
      if (char === '"') state.double = opening;
      else state.single = opening;
    }
    if (!cjkNeighbour) continue;
    out ??= value.split('');
    out[i] = char === '"' ? (opening ? OPEN_DOUBLE : CLOSE_DOUBLE) : opening ? OPEN_SINGLE : CLOSE_SINGLE;
  }
  return out === null ? null : out.join('');
}

/** A block's inline content flattened to what the pairing needs: its text
 *  nodes (with their slot, so they can be replaced) and, between them, the
 *  breaks and opaque nodes that separate them. */
type Leaf = { kind: 'text'; node: Text; index: number; parent: Parent } | { kind: 'space' } | { kind: 'ink' };

function collectLeaves(parent: Parent, out: Leaf[]): void {
  parent.children.forEach((child, index) => {
    if (child.type === 'text') {
      if (child.value.length > 0) out.push({ kind: 'text', node: child, index, parent });
    } else if (child.type === 'break') {
      out.push({ kind: 'space' });
    } else if ('children' in child) {
      collectLeaves(child, out);
    } else {
      out.push({ kind: 'ink' });
    }
  });
}

/** The character a quote at the edge of `leaves[at]` sees on `side`. */
function edgeChar(leaves: readonly Leaf[], at: number, side: -1 | 1): string | undefined {
  const leaf = leaves[at + side];
  if (leaf === undefined) return undefined;
  if (leaf.kind === 'space') return ' ';
  if (leaf.kind === 'ink') return INK;
  const value = leaf.node.value;
  return side === -1 ? codePointBefore(value, value.length) : codePointAt(value, 0);
}

export default function remarkCjkQuotes() {
  return (tree: Root): void => {
    visit(
      tree,
      (node) => PHRASING_BLOCKS.has(node.type),
      (node) => {
        const leaves: Leaf[] = [];
        collectLeaves(node as Parent, leaves);
        const state: QuoteState = { double: false, single: false };
        leaves.forEach((leaf, at) => {
          if (leaf.kind !== 'text') return;
          const curled = curlCjkQuotes(leaf.node.value, state, edgeChar(leaves, at, -1), edgeChar(leaves, at, 1));
          if (curled === null) return;
          leaf.parent.children[leaf.index] = { ...leaf.node, value: curled };
        });
        return SKIP;
      }
    );
  };
}
