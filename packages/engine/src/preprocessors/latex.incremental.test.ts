/**
 * Incremental LaTeX preprocessor: the whole contract is BYTE-EQUALITY with
 * `preprocessLaTeX(full)` at every append — including the original's
 * whole-string early-exit quirks. Pinned counterexamples come from the
 * design review (B1–B5); the property suite replays seeded random streams
 * with 1-char chunking that splits every straddle-able token.
 */
import { describe, expect, test } from 'vitest';
import { preprocessLaTeX, createIncrementalLatexPreprocessor } from './latex';
import { testEnv } from '../components/incrementalParse/spliceArbiterHarness';

/** Replay `chunks` as an append stream, asserting byte-equality per step.
 *  `freezeThreshold: 0` forces a freeze attempt on EVERY call — without it,
 *  short counterexamples never leave the full-reprocess fallback and the
 *  pins pass vacuously; `backoff: false` for the same reason (a failed
 *  attempt would otherwise skip the next ones and 1-char chunkings would
 *  stop exercising the cut rules). Backoff can only freeze LESS, so passing
 *  here implies passing with it on — the P2-3 suite covers the on-state. */
function replay(chunks: string[]): void {
  const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0, backoff: false });
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

describe('createIncrementalLatexPreprocessor — failed-freeze backoff and blank-line hazard release (2026-08-19 review P2-3)', () => {
  /** Stream `doc` in `size`-char appends through a threshold-0 instance
   *  (backoff ON), asserting byte-equality per step; returns attempt count
   *  and total frozen bytes. */
  function replayCounting(doc: string, size: number): { attempts: number; frozen: number } {
    let attempts = 0;
    let frozen = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      onAttempt: ({ frozenBytes }) => {
        attempts++;
        frozen += frozenBytes;
      },
    });
    for (let i = size; i < doc.length + size; i += size) {
      const acc = doc.slice(0, i);
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    return { attempts, frozen };
  }
  /** Replay with backoff ON and assert that at least one freeze happened. */
  function replayFreezing(chunks: string[]): void {
    let frozen = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      onAttempt: ({ frozenBytes }) => {
        frozen += frozenBytes;
      },
    });
    let acc = '';
    for (const chunk of chunks) {
      acc += chunk;
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    expect(frozen).toBeGreaterThan(0);
  }
  const PARA = 'plain prose keeps flowing here with $x^2$ and \\(y\\) inline.\n\n';

  test('a stray `$` early in the document: byte-equal, and attempts stay logarithmic', () => {
    // `US$` (no digits) is not currency-escaped and keeps parity odd for
    // every later slice, so the last-cut candidate is never quiescent.
    // Before: every frame re-scanned the whole active region and re-ran the
    // candidate for nothing. Now failed attempts back off (active must
    // double), so their count is O(log n) — not O(frames).
    const doc = 'intro line one.\n\nprice in US$ today\n\n' + PARA.repeat(120);
    const frames = Math.ceil(doc.length / 16);
    const { attempts } = replayCounting(doc, 16);
    expect(attempts).toBeLessThan(Math.log2(doc.length) + 12);
    expect(attempts).toBeLessThan(frames / 8);
  });

  test('a lone backtick: the hazard latch releases at the next blank line and the stream keeps freezing', () => {
    // A code span cannot cross a blank line, so a lone backtick on a
    // finished paragraph can never be re-paired by a later append: lines
    // after the blank are safe cuts again. Byte-equality is the contract.
    const doc = 'Press the ` key to open the palette.\n\n' + PARA.repeat(120);
    const { attempts, frozen } = replayCounting(doc, 16);
    // Progress: nearly the whole document froze (before: nothing after the
    // backtick, ever). Under backoff a HIGH attempt count is the second
    // progress signal — attempts run every frame only while freezes keep
    // succeeding; without the release every attempt fails and the count
    // collapses to O(log n).
    expect(frozen).toBeGreaterThan(doc.length - 2 * PARA.length);
    expect(attempts).toBeGreaterThan(Math.ceil(doc.length / 16) / 3);
    // Oracle pins: a lone run, then a blank, then a run of the same length —
    // never a pair; the prefix freezes.
    replayFreezing(['use ` for $x$\n\n', 'more\n', 'close `\n']);
    // A mid-line ``` run and a later line-start ``` fence: the blank line
    // between them settles the first run (it cannot pair across the blank).
    replayFreezing(['x ``` y\n\n', '```\ncode $z\n```\n', 'tail ``` $w$\n']);
    // The counterexample from the property suite: an EMPTY remainder after
    // a segment's last `\n` must not count as a blank line (it is the start
    // of a line that continues in the next segment).
    replay(['prose `$1,000.50\n<code>x</code>\n<span title="a\nb">tail\n', '`<co']);
    // Whitespace after a protected span on the same line is not a blank line
    // either — that partial line must not release the latch.
    replay(['a ` b\n<code>x</code>   \n$y$ z ` w\n', ' `\n']);
    // Two paragraphs, one lone backtick each — never a pair; math between converts.
    replay(['a ` b\n\n$e^{i\\pi}$ here\n\nc ` d\n', ' more $x$\n']);
  });

  test('a long streaming `$$` block: attempts inside it back off, freezing resumes after it closes', () => {
    const block = '$$\n' + '\\int_0^1 x^{2}\\,dx + \\sum_{k=1}^{n} k \\\\\n'.repeat(80);
    // Enough tail after the block for the active region to reach the next
    // attempt size (backoff waits for it to double after the last failure —
    // the recovery lag is the price of the geometric bound).
    const doc = PARA.repeat(20) + block + '$$\n\n' + PARA.repeat(120);
    const blockOpenAt = PARA.length * 20;
    const blockCloseAt = blockOpenAt + block.length + 3;
    let attemptsInsideBlock = 0;
    let frozen = 0;
    let streamed = 0;
    const incremental = createIncrementalLatexPreprocessor({
      freezeThreshold: 0,
      onAttempt: ({ frozenBytes }) => {
        frozen += frozenBytes;
        if (streamed > blockOpenAt && streamed < blockCloseAt) attemptsInsideBlock++;
      },
    });
    for (let i = 24; i < doc.length + 24; i += 24) {
      const acc = doc.slice(0, i);
      streamed = acc.length;
      expect(incremental(acc)).toBe(preprocessLaTeX(acc));
    }
    // Inside the open block every attempt fails: logarithmic, not per frame.
    expect(attemptsInsideBlock).toBeLessThan(Math.log2(block.length) + 4);
    // The prefix froze before the block opened, and the block itself once
    // the next attempt fired after it closed.
    expect(frozen).toBeGreaterThan(PARA.length * 18 + block.length);
  });

  test('backoff resets on non-append input', () => {
    let attempts = 0;
    const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0, onAttempt: () => attempts++ });
    const stuck = 'US$ stuck\n\n' + PARA.repeat(40);
    for (let i = 8; i < stuck.length + 8; i += 8) incremental(stuck.slice(0, i));
    const before = attempts;
    // Regeneration: a fresh document must attempt immediately again.
    const fresh = 'fresh $x$ start\n\n' + PARA;
    incremental(fresh);
    expect(attempts).toBe(before + 1);
    expect(incremental(fresh)).toBe(preprocessLaTeX(fresh));
  });

  test('backoff on: seeded streams still equal the full run (backoff can only freeze less)', () => {
    // A small backoff-ON replay over mixed content, complementing the
    // threshold-0/backoff-OFF property suite below.
    const doc =
      'intro $a$ text\n\nUS$ price\n\n' +
      PARA.repeat(6) +
      'x ` y\n\n' +
      PARA.repeat(6) +
      '$$\nblock\n$$\n\n' +
      PARA.repeat(6);
    for (const size of [1, 5, 33]) {
      const incremental = createIncrementalLatexPreprocessor({ freezeThreshold: 0 });
      for (let i = size; i < doc.length + size; i += size) {
        const acc = doc.slice(0, i);
        expect(incremental(acc)).toBe(preprocessLaTeX(acc));
      }
    }
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

  // Scale for the soak gate via LATEX_FUZZ_STREAMS (default keeps the unit
  // suite fast); TIMEOUT scales along.
  const STREAMS = Number(testEnv('LATEX_FUZZ_STREAMS') ?? 60);
  const FUZZ_TIMEOUT_MS = Math.max(120_000, STREAMS * 250);

  test(
    'seeded random streams equal the full run at every append',
    () => {
      for (let stream = 0; stream < STREAMS; stream++) {
        const pieceCount = 10 + Math.floor(rand() * 30);
        let doc = '';
        for (let i = 0; i < pieceCount; i++) doc += PIECES[Math.floor(rand() * PIECES.length)];
        // Three chunkings per doc: tiny (splits every token), medium, large.
        for (const size of [1 + Math.floor(rand() * 2), 7, 64]) {
          replaySized(doc, size);
        }
      }
    },
    FUZZ_TIMEOUT_MS
  );

  test(
    'long streams cross the freeze threshold and stay byte-identical',
    () => {
      const longStreams = Math.max(6, Math.floor(STREAMS / 10));
      for (let stream = 0; stream < longStreams; stream++) {
        const pieceCount = 250 + Math.floor(rand() * 100);
        let doc = '';
        for (let i = 0; i < pieceCount; i++) doc += PIECES[Math.floor(rand() * PIECES.length)];
        replaySized(doc, 48);
      }
    },
    FUZZ_TIMEOUT_MS
  );
});
