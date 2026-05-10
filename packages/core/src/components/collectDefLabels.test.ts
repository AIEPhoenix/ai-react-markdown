import { describe, test, expect } from 'vitest';
import { collectDefLabels } from './collectDefLabels';

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
