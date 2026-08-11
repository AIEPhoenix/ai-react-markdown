import { describe, expect, test } from 'vitest';
import { createRemendPreprocessor } from './remend';
import { preprocessLaTeX } from './latex';

const repair = createRemendPreprocessor();

describe('createRemendPreprocessor', () => {
  test('closes unterminated bold at the tail', () => {
    expect(repair('Streaming **bold')).toBe('Streaming **bold**');
  });

  test('closes unterminated inline code at the tail', () => {
    expect(repair('Run `pnpm install')).toBe('Run `pnpm install`');
  });

  test('closes unterminated strikethrough at the tail', () => {
    expect(repair('It was ~~wrong')).toBe('It was ~~wrong~~');
  });

  test('renders incomplete links as text only (pipeline default)', () => {
    // remend's own default is a `streamdown:` placeholder URL, which this
    // pipeline's URL sanitizer would strip into a dead <a>. The factory
    // flips linkMode to 'text-only'.
    const out = repair('See [the docs](https://exa');
    expect(out).not.toContain('streamdown:');
    expect(out).not.toContain('[');
    expect(out).toContain('the docs');
  });

  test('linkMode stays caller-overridable', () => {
    const protocolRepair = createRemendPreprocessor({ linkMode: 'protocol' });
    expect(protocolRepair('See [the docs](https://exa')).toContain('streamdown:incomplete-link');
  });

  test('drops incomplete images entirely', () => {
    const out = repair('Diagram ![arch](https://exa');
    expect(out).not.toContain('![');
    expect(out).not.toContain('arch');
  });

  test('never touches math tails — $ handling belongs to preprocessLaTeX', () => {
    // Even a caller passing options cannot re-enable math completion
    // (the factory forces katex/inlineKatex off after spreading options).
    const optioned = createRemendPreprocessor({ bold: false });
    expect(optioned('Euler: $$e^{i\\pi}')).toBe('Euler: $$e^{i\\pi}');
    expect(optioned('Cost is $100 and')).toBe('Cost is $100 and');
  });

  test('is a no-op on well-formed documents (final-frame equivalence)', () => {
    const complete = [
      '# Title',
      '',
      'Prose with **bold**, `code`, ~~strike~~, and [a link](https://example.com).',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n');
    expect(repair(complete)).toBe(complete);
  });

  test('does not repair inside closed fenced code blocks', () => {
    const fenced = '```\nconst s = "**not bold";\n```';
    expect(repair(fenced)).toBe(fenced);
  });

  test('composes after preprocessLaTeX (the contentPreprocessors slot)', () => {
    // User preprocessors run after the built-in LaTeX pass; the repaired
    // output must leave LaTeX's rewrites intact.
    const streamed = 'Inline \\(x^2\\) then **bol';
    const out = repair(preprocessLaTeX(streamed));
    expect(out).toBe('Inline $$x^2$$ then **bol**');
  });
});
