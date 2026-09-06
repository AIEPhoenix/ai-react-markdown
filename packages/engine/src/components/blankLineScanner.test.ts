import { expect, test } from 'vitest';
import { createBlankLineScanner } from './blankLineScanner';
import { lastRegionStart } from './collectDefLabels';

test('all character partitions match the complete regex, including CR seams', () => {
  const alphabet = ['x', '\n', '\r', ' ', '\t'];
  const documents = [''];
  for (let depth = 0, start = 0, end = 1; depth < 5; depth++) {
    for (let i = start; i < end; i++) for (const c of alphabet) documents.push(documents[i] + c);
    start = end;
    end = documents.length;
  }
  for (const source of documents) {
    const scan = createBlankLineScanner();
    for (let i = 1; i <= source.length; i++)
      expect(scan(source.slice(0, i), i - 1)).toBe(lastRegionStart(source.slice(0, i)));
    expect(scan('replacement\n\n')).toBe(lastRegionStart('replacement\n\n'));
  }
});
