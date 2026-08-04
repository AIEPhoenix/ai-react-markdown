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
    // Bulleted link (fast-path direction) and blockquoted def.
    replay(['- [t](https://e.com)\n', '- second bullet\n\n', '> [q]: /q\n']);
    // Escaped bracket inside a label, split right at the escape.
    replay(['[a\\', ']b]: /url\n', 'prose after\n']);
    // Multi-line label split across the line break.
    replay(['[foo\n', 'bar]: /url\n']);
    // Def signature completing one char at a time: `[x` → `[x]` → `[x]:`.
    replay(['see\n[x', ']', ': /url\n']);
    // Link list followed by a genuine def footer.
    replay(['- [a](https://e.com/a)\n', '- [b](https://e.com/b)\n', '\n[c]: https://e.com/c\n']);
    // Ghost-def counterexample (Phase B review): without the scanner
    // boundary profile, `$$`-wrapped `<!--` reads as closed math and the
    // frozen prefix would let the tail parse invent `[x]` OUTSIDE the
    // still-open type-2 comment. Per-step equality pins the profile.
    replay(['$$\n', '<!--\n', '$$\n', '\n', '[x]: /u\n', 'prose\n']);
    replay(['$$\r\n', '<!--\r\n', '$$\r\n', '\r\n', '[x]: /u\r\n']);
    // A ``` fence inside $$ really opens under the pinned grammar.
    replay(['$$\n', '```\n', '$$\n', '\n', '[x]: /u\n']);
    // Streaming def footer after freezable prose (the Phase B motivation).
    replay(['body paragraph one.\n\n', 'body paragraph two.\n\n', '[1]: /a\n', '[2]: /b\n', '[^3]: note\n']);
  });

  test('region boundary is CRLF-aware', () => {
    expect(lastRegionStart('a\n\nb')).toBe(3);
    expect(lastRegionStart('a\r\n\r\nb')).toBe(5);
    expect(lastRegionStart('a\r\n \r\nb')).toBe(6);
    expect(lastRegionStart('no blanks at all')).toBe(0);
  });

  test('fast-path trigger requires the full `]:` def signature, not just a line-start bracket', () => {
    // Mid-line brackets — the shape AI prose is dense with — must NOT
    // knock the stream off the fast path.
    expect(DEF_LINE_START_RE.test('See [the docs](https://e.com) and [1] for details')).toBe(false);
    expect(DEF_LINE_START_RE.test('prose line\nmore [citation] prose')).toBe(false);
    // Line-START brackets without the `]:` signature are links, task boxes
    // or references — grammar-verified non-defs, and exactly what the
    // Documents+smooth cliff streamed. They must stay on the fast path.
    expect(DEF_LINE_START_RE.test('- [Title](https://e.com)')).toBe(false);
    expect(DEF_LINE_START_RE.test('  - [maybe][ref]')).toBe(false); // `][` adjacency: not a def
    expect(DEF_LINE_START_RE.test('1. [ordered](u)')).toBe(false);
    expect(DEF_LINE_START_RE.test('- [x] task item')).toBe(false);
    expect(DEF_LINE_START_RE.test('[x')).toBe(false); // incomplete: no def until `]:` lands (region re-checks)
    expect(DEF_LINE_START_RE.test('[x]\n: /url')).toBe(false); // colon must be ADJACENT (grammar-verified)
    // Anything that CAN be a definition must trigger.
    expect(DEF_LINE_START_RE.test('[x]: /url')).toBe(true);
    expect(DEF_LINE_START_RE.test('prose\n[^fn]: body')).toBe(true);
    expect(DEF_LINE_START_RE.test('> [q]: /q')).toBe(true);
    expect(DEF_LINE_START_RE.test('- [li]: /url')).toBe(true); // defs nest in lists
    expect(DEF_LINE_START_RE.test('[a\\]b]: /url')).toBe(true); // escaped bracket inside label
    expect(DEF_LINE_START_RE.test('[a\\\\]: /url')).toBe(true); // escaped backslash then close
    expect(DEF_LINE_START_RE.test('[foo\nbar]: /url')).toBe(true); // labels may span lines
  });

  test('bulleted link lists and task lists stream entirely on the fast path', () => {
    // The measured Documents+smooth cliff: a blank-line-free `- [Title](url)`
    // list used to defeat the bracket-only probe and pay a full reparse per
    // revealed frame (~15ms at 20k chars). A def's real signature is the
    // adjacent `]:` — links (`](`), references (`][`) and task boxes (`] `)
    // never carry it.
    let calls = 0;
    const counting = (s: string) => {
      calls++;
      return collectDefLabels(s);
    };
    const scanner = createDefLabelScanner(counting);
    let acc = 'Sources:\n';
    scanner.scan(acc);
    // Phase B: the probe gates the SLICE and TAIL parses too, so a
    // signature-free document costs zero parses even on first scan.
    expect(calls).toBe(0);
    for (let i = 1; i <= 20; i += 1) {
      // Split each item mid-bracket to exercise the append seam.
      for (const piece of [`- [Result ${i}]`, `(https://example.com/${i})\n`]) {
        acc += piece;
        expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
      }
    }
    for (const piece of ['- [ ] pending task\n', '- [x] done task\n']) {
      acc += piece;
      expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
    }
    expect(calls).toBe(0); // the whole list rode the fast path
    // A REAL def arriving afterwards still forces a parse and is found.
    // (The list's continuation hazard blocks freezing here, so this one
    // parse covers the full source — the conservative direction.)
    acc += '\n[1]: https://example.com/canonical\n';
    const labels = scanner.scan(acc);
    expect(calls).toBe(1);
    expect([...labels.linkLabels]).toContain('1');
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
    // Phase B: even the first scan skips the parse when neither the frozen
    // slice nor the live tail carries a def signature.
    expect(calls).toBe(0);
    for (const token of ['streams ', 'in with [a link](https://e.com) ', 'and citations [1] ', 'to the end.']) {
      acc += token;
      scanner.scan(acc);
    }
    expect(calls).toBe(0); // every append rode the fast path
    // A def line DOES force a parse — of the small tail only: the frozen
    // prefix ends at the blank line before it and holds no signature.
    acc += '\n\n[d]: /url';
    scanner.scan(acc);
    expect(calls).toBe(1);
  });

  test('a streaming def footer parses only the live tail once the prefix freezes', () => {
    // The Phase B goal: while a citation footer streams, the parse cost
    // must be O(footer), not O(document). The injected parse records the
    // LENGTH of every source it is given.
    const parsedLengths: number[] = [];
    const recording = (s: string) => {
      parsedLengths.push(s.length);
      return collectDefLabels(s);
    };
    const scanner = createDefLabelScanner(recording);
    const body = Array.from({ length: 60 }, (_, i) => `Body paragraph ${i} with prose text in it.`).join('\n\n');
    let acc = body + '\n\n';
    scanner.scan(acc); // body: full parse once (fast path not yet armed)
    const bodyLength = acc.length;
    parsedLengths.length = 0;
    for (let i = 1; i <= 30; i += 1) {
      acc += `[${i}]: https://example.com/${i}\n`;
      expect(asPlain(scanner.scan(acc))).toEqual(asPlain(collectDefLabels(acc)));
    }
    expect(bodyLength).toBeGreaterThan(2_000);
    const maxParsed = Math.max(...parsedLengths);
    // Every footer-era parse touched only the footer-sized tail (plus the
    // one-off frozen-prefix slice, which contains no def signature and is
    // skipped by the probe entirely).
    expect(maxParsed).toBeLessThan(1_200);
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
      '- [Title](https://e.com)\n',
      '- [x] task\n',
      '[a\\]b]: /u\n',
      '\\',
      '   ',
      '===\n',
      ': ',
      '$$\n',
      '<!--\n',
      '-->\n',
      '<div>\n',
      '</div>\n',
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
