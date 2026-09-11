import { describe, expect, test } from 'vitest';

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

  test('only the first character is a BOM; a later U+FEFF is ordinary text', () => {
    const inner = `a ${BOM}b\n${BOM}c`;
    expect(preprocessAIMDContent(inner)).toBe(inner);
    expect(preprocessAIMDContent(`${BOM}${BOM}x`)).toBe(`${BOM}x`);
  });

  test('a BOM-only input becomes the empty string', () => {
    expect(preprocessAIMDContent(BOM)).toBe('');
  });

  test('is byte-identical to the LaTeX stage alone for BOM-free input', () => {
    const src = 'Inline \\(x\\) and $5 dollars.\n\n$$\ne=mc^2\n$$\n';
    expect(preprocessAIMDContent(src)).toBe(preprocessLaTeX(src));
  });
});
