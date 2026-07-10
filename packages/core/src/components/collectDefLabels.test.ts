import { describe, test, expect } from 'vitest';
import { collectDefLabels, createDefLabelScanner, type DefLabels } from './collectDefLabels';

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
});
