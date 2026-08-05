/**
 * Incremental LaTeX preprocessor: the whole contract is BYTE-EQUALITY with
 * `preprocessLaTeX(full)` at every append — including the original's
 * whole-string early-exit quirks. Pinned counterexamples come from the
 * design review (B1–B5); the property suite replays seeded random streams
 * with 1-char chunking that splits every straddle-able token.
 */
import { describe, expect, test } from 'vitest';
import { preprocessLaTeX, createIncrementalLatexPreprocessor } from './latex';

/** Replay `chunks` as an append stream, asserting byte-equality per step.
 *  `freezeThreshold: 0` forces a freeze attempt on EVERY call — without it,
 *  short counterexamples never leave the full-reprocess fallback and the
 *  pins pass vacuously. */
function replay(chunks: string[]): void {
  const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0 });
  let acc = '';
  for (const chunk of chunks) {
    acc += chunk;
    expect(incremental(acc)).toBe(preprocessLaTeX(acc));
  }
}

/** Replay a full document split into fixed-size chunks. */
function replaySized(doc: string, size: number): void {
  const chunks: string[] = [];
  for (let i = 0; i < doc.length; i += size) chunks.push(doc.slice(i, i + size));
  replay(chunks);
}

describe('createIncrementalLatexPreprocessor — pinned counterexamples', () => {
  test('B1: latent multi-line html tag — `>` arriving later protects a $ before the cut', () => {
    // The tag's attribute spans lines; before `>` arrives the `$5` is
    // currency-escaped, after it arrives the whole tag region is protected
    // and `$5` stays raw. A cut between the two frames would freeze the
    // escaped form. (`$x$` gives the stream a trigger so the gate is open.)
    replay(['$x$ math\nx\n<span title="a $5\n', 'ok">y $1 tail\n']);
  });

  test('B2: a lone `$` is NOT line-local — pipes escape across lines', () => {
    // findUnclosedDelimiterStart('both') toggles across newlines: the lone
    // `$` in the prefix makes the NEXT line's pipe part of the unclosed
    // tail (`\vert{}`). A raw per-line analysis would have cut after line 1.
    replay(['price $ one\n', 'a | b\n']);
  });

  test('B5: currency escaping rewrites the `$` token stream', () => {
    // Raw text has two `$` (looks paired); the transform escapes `$1`
    // (currency) leaving ONE live `$` — the active pipe is inside the
    // unclosed tail in the full run.
    replay(['$1\nx$ y\n', 'a | b\n']);
  });

  test('B3: truncateUnclosedLatexBlock trimEnd crosses the seam', () => {
    // Full run: `hello\n$$\nx` → truncate strips the unclosed `$$` AND
    // trimEnd()s the segment → `hello`. A frozen `hello\n` must be trimmed
    // at COMPOSE time only — the block closes later and the untrimmed
    // frozen bytes become correct again.
    replay(['hello\n', '$$\nx', '\n$$\ntail $z$\n']);
  });

  test('B4: late trigger — a `$` arriving after bare \\text{a_b} transforms the prefix', () => {
    // While the accumulated string has no trigger, the original early-exits
    // with the identity (underscore NOT escaped). The first `$` flips the
    // whole document into the transform regime retroactively.
    replay(['\\text{a_b}\n', 'plain prose\n', 'now $x$\n']);
  });

  test('dangling backtick run pairs with a later run and re-segments the past', () => {
    // The lone backtick's span, once closed frames later, swallows the `$`
    // that was previously transformed as math.
    replay(['use ` for $x$\n', 'more prose\n', 'and close `\n']);
  });

  test('late-closing \\[ and \\text{', () => {
    replay(['before $a$\n\\[x\n', 'y\\]\nafter $b$\n']);
    replay(['before $a$\n\\text{foo\n', 'bar}\nafter $b$\n']);
  });

  test('split closing </code> tag keeps the literal region protected', () => {
    replay(['<code>$not math$</co', 'de> after $real$\n']);
  });

  test('image-form ![x] does not count as a convertible bracket', () => {
    replay(['see !\\[img\\] and $m$\n\n', 'tail $n$\n']);
  });

  test('CRLF variants of the seam-sensitive cases', () => {
    replay(['price $ one\r\n', 'a | b\r\n']);
    replay(['hello\r\n', '$$\r\nx', '\r\n$$\r\n']);
    replay(['$x$ math\r\nx\r\n<span title="a $5\r\n', 'ok">y\r\n']);
  });

  test('unclosed fence and unclosed literal tag degrade gracefully', () => {
    replay(['$a$\n\n```\ncode $x\n', 'more $y\n', '```\n\n$b$\n']);
    replay(['$a$\n\n<pre>$not\n', 'math\n', '</pre>\n$b$\n']);
  });

  test('identical input replays the cached output (StrictMode idempotence)', () => {
    const incremental = createIncrementalLatexPreprocessor();
    const doc = 'x $a$\n\ny $4.2M z\n';
    const first = incremental(doc);
    expect(incremental(doc)).toBe(first);
    expect(first).toBe(preprocessLaTeX(doc));
  });

  test('non-append input (regeneration / older replay) resets cleanly', () => {
    const incremental = createIncrementalLatexPreprocessor();
    const a = 'first message $x$\n\nwith text\n';
    incremental(a);
    const b = 'rewritten $y$ body\n';
    expect(incremental(b)).toBe(preprocessLaTeX(b));
    // Older content (a discarded-render replay) is a non-append too.
    expect(incremental(a.slice(0, 10))).toBe(preprocessLaTeX(a.slice(0, 10)));
  });
});

describe('createIncrementalLatexPreprocessor — property fuzz', () => {
  // mulberry32, deterministic. Pieces bias toward every construct the safe
  // cut interacts with; 1-char and tiny chunkings split straddle-able
  // tokens (`\`+`[`, `<sp`+`an>`, `$`+`$`, backtick runs, `</co`+`de>`).
  const PIECES = [
    'prose text ',
    '\n',
    '\n\n',
    '\r\n',
    '$',
    '$$\n',
    '$x^2$ ',
    '$$\\int_0^1 x\\,dx$$\n',
    '\\[',
    '\\]',
    '\\(y\\) ',
    '\\ce{H2O} ',
    '$\\ce{CO2}$ ',
    '\\text{a_b} ',
    '\\text{open',
    '} ',
    '$4.2M revenue ',
    '$1,000.50 ',
    '| a | b |\n',
    '`',
    '``x``',
    '`code $x$` ',
    '```\nfenced $f\n```\n',
    '~~~\ntilde $t\n~~~\n',
    '<span>',
    '</span>',
    '<span title="multi\nline $5">',
    '<code>$c$</code>',
    '<pre>$p',
    '</pre>',
    '!\\[img\\] ',
    '\\\\',
    '   indented\n',
  ];
  let seed = 0x1a7e | 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  test('seeded random streams equal the full run at every append', () => {
    for (let stream = 0; stream < 60; stream++) {
      const pieceCount = 10 + Math.floor(rand() * 30);
      let doc = '';
      for (let i = 0; i < pieceCount; i++) doc += PIECES[Math.floor(rand() * PIECES.length)];
      // Three chunkings per doc: tiny (splits every token), medium, large.
      for (const size of [1 + Math.floor(rand() * 2), 7, 64]) {
        replaySized(doc, size);
      }
    }
  });

  test('long streams cross the freeze threshold and stay byte-identical', () => {
    for (let stream = 0; stream < 6; stream++) {
      const pieceCount = 250 + Math.floor(rand() * 100);
      let doc = '';
      for (let i = 0; i < pieceCount; i++) doc += PIECES[Math.floor(rand() * PIECES.length)];
      replaySized(doc, 48);
    }
  });
});
