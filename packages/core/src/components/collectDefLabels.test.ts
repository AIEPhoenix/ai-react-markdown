import { describe, test, expect } from 'vitest';
import {
  collectDefLabels,
  createDefLabelScanner,
  DEF_LINE_START_RE,
  lastRegionStart,
  type DefLabels,
} from './collectDefLabels';

describe('collectDefLabels', () => {
  test('extracts footnote def labels', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('[^x]: text\n[^y]: more');
    expect(footnoteLabels).toEqual(new Set(['X', 'Y']));
    expect(linkLabels).toEqual(new Set());
  });

  test('extracts link def labels', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('[a]: https://example.com\n[b]: /img.png "title"');
    expect(linkLabels).toEqual(new Set(['A', 'B']));
    expect(footnoteLabels).toEqual(new Set());
  });

  test('uses uppercase normalize (case-fold + ws-collapse)', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('[^FooBar]: x\n\n[Hello World]: y');
    expect(footnoteLabels.has('FOOBAR')).toBe(true);
    expect(linkLabels.has('HELLO WORLD')).toBe(true);
  });

  test('ignores defs inside fenced code blocks', () => {
    const src = '```\n[notdef]: never\n```\n\n[real]: yes';
    const { linkLabels } = collectDefLabels(src);
    expect(linkLabels).toEqual(new Set(['REAL']));
  });

  test('handles indented defs (up to 3 spaces, CommonMark)', () => {
    const src = '   [indented]: yes';
    const { linkLabels } = collectDefLabels(src);
    expect(linkLabels.has('INDENTED')).toBe(true);
  });

  test('empty source returns empty sets', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('');
    expect(footnoteLabels.size).toBe(0);
    expect(linkLabels.size).toBe(0);
  });

  test('orphan ref source returns no labels (refs are not defs)', () => {
    const { footnoteLabels, linkLabels } = collectDefLabels('See [^x] and [y][z].');
    expect(footnoteLabels.size).toBe(0);
    expect(linkLabels.size).toBe(0);
  });
});

// ─── createDefLabelScanner — append-aware fast path ─────────────────────────

const asPlain = (l: DefLabels) => ({ fn: [...l.footnoteLabels].sort(), link: [...l.linkLabels].sort() });

/** Replay `chunks` as an append-only stream and assert, at EVERY step, that
 *  the scanner's answer deep-equals a fresh full parse of the accumulated
 *  source. This is the scanner's whole contract — the fast path must be
 *  unobservable except through object identity. */
function replay(chunks: string[]): void {
  const scanner = createDefLabelScanner();
  let acc = '';
  for (const chunk of chunks) {
    acc += chunk;
    expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
  }
}

describe('createDefLabelScanner', () => {
  test('equals a full parse at every step of adversarial streams', () => {
    // Plain prose (pure fast path).
    replay(['Hello ', 'world.\n\n', 'Another ', 'paragraph ', 'of text.\n']);
    // Def split mid-label and mid-destination.
    replay(['See [x', '][ref].\n\n[re', 'f]: https://exa', 'mple.com\n']);
    // Multi-line def: `[x]:` on one line, destination appended WITHOUT a
    // `[` — the case that forces the region back to the last blank line.
    replay(['[x]:\n', 'https://example.com\n']);
    // Setext re-typing: `===` (no `[`) turns the def-looking paragraph
    // region into a heading.
    replay(['[foo]: /url', '\n===\n']);
    // Defs inside an open (then closed) code fence never count.
    replay(['```\n', '[fake]: /nope\n', '```\n', '\n[real]: /yes\n']);
    // Blockquoted def, footnote def split across tokens.
    replay(['> quoted\n> [q]: /q\n\n', 'tail [^f', 'n]: body\n']);
    // Document with no blank lines at all (region = whole source).
    replay(['line one\n', 'line two\n', '[d]: /url\n']);
    // Bracket-dense prose: inline links and citations mid-line.
    replay(['Cite [1] then [a link](https://e.com) ', 'and more [2] prose.\n\n', 'tail [3] text ', 'continues.']);
    // CRLF stream with a def across a CRLF blank line.
    replay(['line one\r\n\r\n', '[d]: /url\r\n', 'prose after\r\n']);
    // Bulleted link (over-match direction) and blockquoted def.
    replay(['- [t](https://e.com)\n', '- second bullet\n\n', '> [q]: /q\n']);
  });

  test('region boundary is CRLF-aware', () => {
    expect(lastRegionStart('a\n\nb')).toBe(3);
    expect(lastRegionStart('a\r\n\r\nb')).toBe(5);
    expect(lastRegionStart('a\r\n \r\nb')).toBe(6);
    expect(lastRegionStart('no blanks at all')).toBe(0);
  });

  test('fast-path trigger is line-anchored, not any-bracket', () => {
    // Mid-line brackets — the shape AI prose is dense with — must NOT
    // knock the stream off the fast path.
    expect(DEF_LINE_START_RE.test('See [the docs](https://e.com) and [1] for details')).toBe(false);
    expect(DEF_LINE_START_RE.test('prose line\nmore [citation] prose')).toBe(false);
    // Anything that CAN start a definition must trigger.
    expect(DEF_LINE_START_RE.test('[x]: /url')).toBe(true);
    expect(DEF_LINE_START_RE.test('prose\n[^fn]: body')).toBe(true);
    expect(DEF_LINE_START_RE.test('> [q]: /q')).toBe(true);
    expect(DEF_LINE_START_RE.test('  - [maybe][ref]')).toBe(true); // over-match: safe
    expect(DEF_LINE_START_RE.test('1. [ordered](u)')).toBe(true); // over-match: safe
    expect(DEF_LINE_START_RE.test('[x')).toBe(true); // partial def line mid-stream
  });

  test('append without "[" in the active region returns the SAME object', () => {
    const scanner = createDefLabelScanner();
    const first = scanner.scan('[a]: /url\n\nprose ');
    const second = scanner.scan('[a]: /url\n\nprose and more prose');
    expect(second).toBe(first);
    expect([...second.linkLabels]).toEqual(['A']);
  });

  test('full rescan keeps the previous reference when the labels are unchanged', () => {
    const scanner = createDefLabelScanner();
    const first = scanner.scan('[a]: /url\n\nsee [a');
    // ']' completes a REFERENCE (not a def): region has '[' → full rescan,
    // but the label set is identical, so the object identity survives.
    const second = scanner.scan('[a]: /url\n\nsee [a]');
    expect(second).toBe(first);
  });

  test('non-append change (regeneration) falls back to a full parse', () => {
    const scanner = createDefLabelScanner();
    scanner.scan('[old]: /url\n\ntext');
    const next = scanner.scan('[new]: /url\n\ndifferent');
    expect(asPlain(next)).toEqual(asPlain(collectDefLabels('[new]: /url\n\ndifferent')));
  });

  test('fast path actually skips the parse on def-free prose appends', () => {
    // Injectable parse counts invocations — externally, a skipped parse is
    // indistinguishable from a parse whose sets came out equal.
    let calls = 0;
    const counting = (s: string) => {
      calls++;
      return collectDefLabels(s);
    };
    const scanner = createDefLabelScanner(counting);
    let acc = 'intro paragraph\n\nprose ';
    scanner.scan(acc);
    expect(calls).toBe(1); // first scan always parses
    for (const token of ['streams ', 'in with [a link](https://e.com) ', 'and citations [1] ', 'to the end.']) {
      acc += token;
      scanner.scan(acc);
    }
    expect(calls).toBe(1); // every append rode the fast path
    // A def line DOES force the parse.
    acc += '\n\n[d]: /url';
    scanner.scan(acc);
    expect(calls).toBe(2);
  });

  test('property: seeded random token streams match a full parse at every step', () => {
    // mulberry32 — deterministic; the pieces bias toward the constructs the
    // scanner's grammar facts interact with (defs, brackets, blank lines,
    // fences, CRLF, container prefixes, partial def lines).
    let s = 0xdef5 | 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const PIECES = [
      'word ',
      'two words ',
      '\n',
      '\n\n',
      '\r\n',
      '[',
      ']',
      '(https://e.com) ',
      '[^fn]: body\n',
      '[ref]: /url\n',
      '[ref]: ',
      '"title"\n',
      '```\n[fenced]: /nope\n```\n',
      '> quoted line\n',
      '- list item ',
      '   ',
      '===\n',
      ': ',
    ];
    for (let stream = 0; stream < 25; stream++) {
      const scanner = createDefLabelScanner();
      let acc = '';
      for (let i = 0; i < 40; i++) {
        acc += PIECES[Math.floor(rand() * PIECES.length)];
        expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
      }
    }
  });
});
