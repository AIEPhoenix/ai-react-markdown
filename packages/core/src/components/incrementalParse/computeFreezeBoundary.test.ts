/**
 * Unit tests for the production freeze-boundary detector. The experiment's
 * falsification suite (experiments/prefixFreeze) validated the L4 rule
 * against the real pipeline; these tests pin the DETECTOR's own contract —
 * blockers, settledness, monotonicity, and the config-aware definition-list
 * blockers that the experiment did not cover (H3).
 */

import { describe, expect, test } from 'vitest';

import { computeFreezeBoundary as scanFreezeBoundary, type FreezeBoundaryOptions } from './computeFreezeBoundary';

/** Most cases only assert the boundary; the footnote bit has its own tests. */
const computeFreezeBoundary = (text: string, options: FreezeBoundaryOptions): number =>
  scanFreezeBoundary(text, options).boundary;

const OFF = { defListEnabled: false };
const ON = { defListEnabled: true };

describe('computeFreezeBoundary — basics', () => {
  test('single blank line between paragraphs is a boundary', () => {
    const text = 'para one\n\npara two\n\npara three';
    // Last candidate wins: after 'para two\n\n'.
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('para three'));
  });

  test('empty and single-block content freezes nothing', () => {
    expect(computeFreezeBoundary('', OFF)).toBe(0);
    expect(computeFreezeBoundary('just one paragraph', OFF)).toBe(0);
  });

  test('a trailing blank line is only a boundary once its newline exists', () => {
    // 'para\n\n' — the blank line IS terminated (second \n present).
    expect(computeFreezeBoundary('para\n\n', OFF)).toBe(6);
    // 'para\n' — line 2 does not exist yet; nothing confirmed blank.
    expect(computeFreezeBoundary('para\n', OFF)).toBe(0);
    // 'para\n\n   ' — trailing spaces-only line is UNCONFIRMED, but the
    // confirmed blank before it still counts.
    expect(computeFreezeBoundary('para\n\n   ', OFF)).toBe(6);
  });

  test('boundary is monotonic across appends', () => {
    const full =
      'alpha\n\nbeta with **bold**\n\n```js\ncode block\n```\n\n- item\n- item two\n\ncol zero closes\n\nfinal paragraph\n';
    let prev = 0;
    for (let i = 1; i <= full.length; i++) {
      const b = computeFreezeBoundary(full.slice(0, i), OFF);
      expect(b, `regression at length ${i}`).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });
});

describe('computeFreezeBoundary — fence and math blockers', () => {
  test('blank lines inside an open fence are not candidates', () => {
    const text = 'para\n\n```js\nline\n\nmore\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(6);
  });

  test('closing the fence re-enables later candidates', () => {
    const text = 'para\n\n```js\ncode\n```\n\nafter\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });

  test('blank lines inside an open $$ block are blocked (math swallows blanks)', () => {
    const text = 'para\n\n$$\na = 1\n\nb = 2\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(6);
  });
});

describe('computeFreezeBoundary — raw HTML blockers', () => {
  test('an unclosed container blocks candidates until it closes', () => {
    const open = '<details>\n\npara one\n\npara two\n';
    expect(computeFreezeBoundary(open, OFF)).toBe(0);
    const closed = '<details>\n\npara\n\n</details>\n\ntail\n\nend';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('end'));
  });

  test('an unclosed <!-- comment blocks; --> unblocks', () => {
    expect(computeFreezeBoundary('<!-- note\n\npara\n\nmore\n', OFF)).toBe(0);
    const closed = 'a\n\n<!-- note -->\n\ntail';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('tail'));
  });

  test('line-truncated open tags block (multi-line tag syntax)', () => {
    // `<div` + EOL opens a CommonMark html block; parse5 completes the tag
    // across lines and the container swallows later siblings.
    expect(computeFreezeBoundary('<div\n  class="x">\n\npara one\n\npara two\n', OFF)).toBe(0);
    // Attributes continuing on the next line — the `>` is off-line too.
    expect(computeFreezeBoundary('<div class="a"\n  data-x="y">\n\npara\n\nmore\n', OFF)).toBe(0);
    // Truncated CLOSING tag balances a truncated open.
    const closed = '<div\n>\ncontent\n</div\n>\n\ntail\n\nend';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('end'));
  });

  test('void and self-closing tags do not block', () => {
    const text = 'an image <img src="x"> and <br/> here\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });

  test('autolinks are not treated as tags', () => {
    const text = 'see <https://example.com> now\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });
});

describe('computeFreezeBoundary — continuation blockers', () => {
  test('list context blocks even across a double blank; column-0 paragraph terminates it', () => {
    const inList = '- item one\n\n\n- item two\n\n';
    expect(computeFreezeBoundary(inList, OFF)).toBe(0);
    const terminated = '- item one\n\ncol zero paragraph\n\ntail';
    expect(computeFreezeBoundary(terminated, OFF)).toBe(terminated.indexOf('tail'));
  });

  test('footnote definition context blocks (LOAD-BEARING since v2: defs splice via replay)', () => {
    expect(computeFreezeBoundary('[^n]: body\n\n', OFF)).toBe(0);
  });
});

describe('computeFreezeBoundary — review-hardened blockers (A1/A2/A4/A5/A6)', () => {
  test('A1: indented code blocks are continuation hazards', () => {
    expect(computeFreezeBoundary('    a\n\n', OFF)).toBe(0);
    const terminated = '    a\n\ncol zero\n\nzzz';
    expect(computeFreezeBoundary(terminated, OFF)).toBe(terminated.indexOf('zzz'));
  });

  test('A2: a def-shaped paragraph continuation line is NOT a definition', () => {
    // [a] ref + fake def on a continuation line → ref stays unresolved.
    expect(computeFreezeBoundary('see [a]\n\npara\n[a]: /x\n\nfiller\n\n', OFF)).toBe(0);
    // Consecutive defs chain without blanks (both valid).
    const chained = '[a]: /x\n[b]: /y\n\nsee [a] and [b]\n\nzzz';
    expect(computeFreezeBoundary(chained, OFF)).toBe(chained.indexOf('zzz'));
  });

  test('A4: a mid-line $$ does not close flow math', () => {
    expect(computeFreezeBoundary('$$\na $$\n\nx\n', OFF)).toBe(0);
    const closed = '$$\na $$\n$$\n\nzzz';
    expect(computeFreezeBoundary(closed, OFF)).toBe(closed.indexOf('zzz'));
  });

  test('A5: a backtick run with a backtick in the info string is not a fence', () => {
    // Paragraph, not fence — the <div> after it must be counted (blocked).
    expect(computeFreezeBoundary('```a``` b <div>\n\nx\n', OFF)).toBe(0);
    const plain = '```a``` b\n\nzzz';
    expect(computeFreezeBoundary(plain, OFF)).toBe(plain.indexOf('zzz'));
  });

  test('A6: html block types 3-5 block until their closer', () => {
    expect(computeFreezeBoundary('<?data\n\nx\n', OFF)).toBe(0);
    expect(computeFreezeBoundary('<![CDATA[\n\nx\n', OFF)).toBe(0);
    const piClosed = 'a <?x?> b\n\nzzz';
    expect(computeFreezeBoundary(piClosed, OFF)).toBe(piClosed.indexOf('zzz'));
    const declClosed = '<!DOCTYPE html>\n\nzzz';
    expect(computeFreezeBoundary(declClosed, OFF)).toBe(declClosed.indexOf('zzz'));
  });
});

describe('computeFreezeBoundary — reference taint', () => {
  test('an unresolved shortcut ref holds the boundary before it', () => {
    const text = 'see [spec] for details\n\nfiller one\n\nfiller two\n';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('a settled definition releases the taint', () => {
    // NOTE: the closing word must not be a substring of earlier text
    // ('tail' ⊂ 'details' bit us once).
    const text = 'see [spec] for details\n\n[spec]: https://example.com\n\nzzz';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('zzz'));
  });

  test('an unsettled definition (no blank after) does not release', () => {
    const text = 'see [spec] here\n\nfiller\n\n[spec]: https://example.com';
    expect(computeFreezeBoundary(text, OFF)).toBe(0);
  });

  test('labels are matched with micromark case folding, not toLowerCase', () => {
    // micromark's normalizeIdentifier folds 'ß' → 'SS' (toLowerCase would not),
    // so the def below DOES resolve the ref and the boundary may advance.
    const folded = 'see [ß] here\n\n[SS]: https://example.com\n\ntail';
    expect(computeFreezeBoundary(folded, OFF)).toBe(folded.indexOf('tail'));
  });

  test('inline links and definitions themselves are not taint', () => {
    const text = 'a [link](https://example.com) here\n\n[def]: https://example.com\n\ntail';
    expect(computeFreezeBoundary(text, OFF)).toBe(text.indexOf('tail'));
  });
});

describe('computeFreezeBoundary — definition-list blockers (H3)', () => {
  test("a single-blank candidate is blocked until the next line can't be a `: desc`", () => {
    // No next line yet → the block above could still be claimed as a <dt>.
    expect(computeFreezeBoundary('Term\n\n', ON)).toBe(0);
    // Same text without the extension is freely freezable.
    expect(computeFreezeBoundary('Term\n\n', OFF)).toBe(6);
    // Next line confirmed non-`:` → settled.
    const settled = 'Term\n\nnext paragraph\n\ntail';
    expect(computeFreezeBoundary(settled, ON)).toBe(settled.indexOf('tail'));
  });

  test('a `: desc` line claims across ONE blank; two blanks are immune', () => {
    // Candidate after 'Term\n\n' must not be selected when ': desc' follows.
    const claimed = 'Term\n\n: desc\n\nsomething at col zero\n\ntail';
    // The ': desc' both invalidates the Term candidate (dd line) and is a
    // continuation context for the candidate after itself; the col-zero
    // paragraph terminates, so the last candidate before 'tail' survives —
    // but only once its own next-line check settles (it has: 'tail').
    expect(computeFreezeBoundary(claimed, ON)).toBe(claimed.indexOf('tail'));
    // Double blank: the backward scan cannot cross two blank lines.
    const immune = 'Term\n\n\nnot claimed\n\ntail';
    expect(computeFreezeBoundary(immune, ON)).toBe(immune.indexOf('tail'));
  });

  test('partial trailing lines settle only when they contradict `^ {0,3}:[ \\t]`', () => {
    expect(computeFreezeBoundary('Term\n\nx', ON)).toBe(6); // 'x' can never become ': '
    expect(computeFreezeBoundary('Term\n\n:', ON)).toBe(0); // ':' may still grow a space
    expect(computeFreezeBoundary('Term\n\n  ', ON)).toBe(0); // spaces may still grow ': '
    expect(computeFreezeBoundary('Term\n\n:x', ON)).toBe(6); // ':x' can never match
    expect(computeFreezeBoundary('Term\n\n    code', ON)).toBe(6); // indent 4 can never match
  });
});

describe('computeFreezeBoundary — footnote taint (fence/mask aware)', () => {
  // v2 removed the hasFootnoteSyntax flag (footnotes splice via injection
  // replay); what remains load-bearing is the footnote-namespace reference
  // taint — pinned here through the boundary itself.
  test('an unresolved [^ref] pins the boundary below it', () => {
    const payload = 'intro para.\n\na claim[^n] here\n\nafter.\n\n';
    expect(computeFreezeBoundary(payload, OFF)).toBe(payload.indexOf('a claim'));
  });

  test('a settled footnote def releases the taint (whole doc freezable)', () => {
    const payload = 'a claim[^n] here\n\n[^n]: def body\n\nafter para.\n\n';
    expect(computeFreezeBoundary(payload, OFF)).toBe(payload.length);
  });

  test('[^ inside a code fence or math block does NOT taint', () => {
    const fenced = '```js\nconst re = /[^0-9]/;\n```\n\ntail\n\n';
    expect(computeFreezeBoundary(fenced, OFF)).toBe(fenced.length);
    const math = '$$\n[^x]\n$$\n\ntail\n\n';
    expect(computeFreezeBoundary(math, OFF)).toBe(math.length);
  });
});

describe('computeFreezeBoundary — inline code-span masking (safe direction)', () => {
  test('intra-line spans no longer over-block html/ref/footnote checks', () => {
    const html = 'use `<div>` in prose\n\nzzz';
    expect(computeFreezeBoundary(html, OFF)).toBe(html.indexOf('zzz'));
    const ref = 'the `[x]` token\n\nzzz';
    expect(computeFreezeBoundary(ref, OFF)).toBe(ref.indexOf('zzz'));
    const fnSpan = 'regex `[^0-9]` inline\n\ntail\n\n';
    expect(computeFreezeBoundary(fnSpan, OFF)).toBe(fnSpan.length);
  });

  test('a paragraph with an unpaired run disables masking (cross-line span gate)', () => {
    // The ` before <div> could pair with a run on the NEXT line — masking
    // must not hide the tag (over-block instead).
    expect(computeFreezeBoundary('a `unclosed <div> here\n\nfiller\n\n', OFF)).toBe(0);
  });

  test('resume-vs-fresh equivalence: chained checkpoints match fresh scans', () => {
    const payload =
      'para `code` one\n\n- item\n\n    indented\n\n[a]: /x\n\nsee [a] and `<b>`\n\nnote[^f] here\n\n[^f]: body\n\n```js\nx\n```\n\n<?pi?> done\n\ntail.\n';
    let checkpoint: ReturnType<typeof scanFreezeBoundary>['checkpoint'] | null = null;
    for (let i = 1; i <= payload.length; i++) {
      const prefix = payload.slice(0, i);
      const resumed = scanFreezeBoundary(prefix, OFF, checkpoint);
      checkpoint = resumed.checkpoint;
      const fresh = scanFreezeBoundary(prefix, OFF);
      expect(resumed.boundary, `at length ${i}`).toBe(fresh.boundary);
    }
  });
});
