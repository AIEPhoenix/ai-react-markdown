import { describe, test, expect } from 'vitest';
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';
import { normalizeId, normalizeForMatch } from './normalizeId';

describe('normalizeId', () => {
  test('whitespace runs collapse to single space', () => {
    expect(normalizeId('foo  bar')).toBe('FOO BAR');
    expect(normalizeId('foo\n\tbar')).toBe('FOO BAR');
  });
  test('case-folds to uppercase (matches mdast-util-to-hast convention)', () => {
    expect(normalizeId('FooBar')).toBe('FOOBAR');
    expect(normalizeId('foobar')).toBe('FOOBAR');
  });
  test('combined normalization', () => {
    expect(normalizeId('Foo  Bar\n\nBaz')).toBe('FOO BAR BAZ');
  });
  test('strips leading/trailing whitespace like micromark (padded / soft-broken labels)', () => {
    // A placeholder carries the ORIGINAL label (`[ foo ]`); the def is
    // keyed by the trimmed identifier. Both must land on the same key.
    expect(normalizeId(' foo ')).toBe('FOO');
    expect(normalizeId('foo\nbar')).toBe('FOO BAR');
    expect(normalizeId('\tfoo\n')).toBe('FOO');
    // Only ASCII whitespace folds (micromark's rule) — NBSP is label content.
    expect(normalizeId('foo\u00a0bar')).toBe('FOO\u00A0BAR');
  });
  test('byte-identical to micromark normalizeIdentifier (the mdast identifier source)', () => {
    for (const raw of [' foo ', 'Foo  Bar', 'ß', 'ǅ', 'a\r\nb', '  ']) {
      expect(normalizeId(raw)).toBe(normalizeIdentifier(raw));
    }
  });
});

describe('normalizeForMatch', () => {
  test('is normalizeId — micromark identifiers keep their backslashes, so the source is NOT unescaped', () => {
    // `[^a\*b]`: identifier `a\*b` (label `a*b`); registry keys come from
    // the identifier, the pre-check must find that exact form in the source.
    expect(normalizeForMatch('ref [^a\\*b] here')).toBe(normalizeId('ref [^a\\*b] here'));
    expect(normalizeForMatch('ref [^a\\*b] here')).toContain('A\\*B');
    expect(normalizeForMatch('foo\\]bar')).toBe('FOO\\]BAR');
    expect(normalizeForMatch('x\\λ')).toBe(normalizeId('x\\λ'));
  });
  test('still collapses whitespace + uppercase', () => {
    expect(normalizeForMatch('Foo  Bar')).toBe('FOO BAR');
  });
});
