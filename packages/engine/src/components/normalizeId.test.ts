import { describe, test, expect } from 'vitest';
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
});

describe('normalizeForMatch', () => {
  test('also resolves backslash escapes', () => {
    expect(normalizeForMatch('foo\\]bar')).toBe('FOO]BAR');
  });
  test('still collapses whitespace + uppercase', () => {
    expect(normalizeForMatch('Foo  Bar')).toBe('FOO BAR');
  });
});
