import { describe, expect, test } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

import preprocessAIMDContent from './index';
import { preprocessLaTeX } from './latex';

const BOM = '\uFEFF';

describe('preprocessAIMDContent — document-leading BOM', () => {
  test('strips a leading U+FEFF before any other stage sees the text', () => {
    const seen: string[] = [];
    const spy = (s: string) => {
      seen.push(s);
      return s;
    };
    const out = preprocessAIMDContent(`${BOM}# Title\n\nbody`, [spy], spy);
    expect(out).toBe('# Title\n\nbody');
    // Both the LaTeX stage and the caller stage received BOM-free text.
    expect(seen).toEqual(['# Title\n\nbody', '# Title\n\nbody']);
  });

  test('every document-leading BOM is removed; an interior U+FEFF is ordinary text', () => {
    const inner = `a ${BOM}b\n${BOM}c`;
    expect(preprocessAIMDContent(inner)).toBe(inner);
    for (const n of [1, 2, 3]) {
      expect(preprocessAIMDContent(`${BOM.repeat(n)}x`), `${n} BOMs`).toBe('x');
      expect(preprocessAIMDContent(`${BOM.repeat(n)}${inner}`), `${n} BOMs`).toBe(inner);
    }
  });

  test('a run of leading BOMs renders the same as none: heading and definition (explicit contract)', () => {
    // Stripping exactly one BOM here and letting micromark drop a second
    // made the result depend on the count: two BOMs rendered `# Heading`
    // as a heading (a raw micromark parse yields a paragraph), three left
    // one in the text. The pipeline normalizes the whole run; this is a
    // preprocessing contract, not raw-micromark equivalence for
    // multi-BOM input.
    const parse = (s: string) => (unified().use(remarkParse).use(remarkGfm).parse(s) as Root).children;
    for (const body of ['# Heading\n', '[x]: /url\n', '[^f]: note\n\nsee [^f]\n']) {
      const expected = parse(body);
      for (const n of [1, 2, 3]) {
        const staged = preprocessAIMDContent(`${BOM.repeat(n)}${body}`);
        expect(staged, `${n} BOMs`).toBe(body);
        expect(parse(staged), `${n} BOMs`).toEqual(expected);
      }
    }
    // The raw parser's own behaviour for the double-BOM input is what the
    // contract replaces: it keeps one BOM as text and yields a paragraph.
    expect(parse(`${BOM}${BOM}# Heading\n`)[0].type).toBe('paragraph');
  });

  test('a BOM-only input becomes the empty string', () => {
    expect(preprocessAIMDContent(BOM)).toBe('');
    expect(preprocessAIMDContent(BOM.repeat(3))).toBe('');
  });

  test('is byte-identical to the LaTeX stage alone for BOM-free input', () => {
    const src = 'Inline \\(x\\) and $5 dollars.\n\n$$\ne=mc^2\n$$\n';
    expect(preprocessAIMDContent(src)).toBe(preprocessLaTeX(src));
  });
});
