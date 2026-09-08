import { describe, expect, test } from 'vitest';
import { AIMarkdownStabilityPolicy, stabilizeRecord, type AIMarkdownStabilityTable } from './useStableRecord';

interface Rec {
  data: { a: number } | undefined;
  fn: (() => void) | undefined;
  opaque: unknown;
}

const TABLE: AIMarkdownStabilityTable<Rec> = {
  data: AIMarkdownStabilityPolicy.DEEP_EQUAL,
  fn: AIMarkdownStabilityPolicy.WARN_ONLY,
  opaque: AIMarkdownStabilityPolicy.PASS_THROUGH,
};

const fn = () => {};

describe('stabilizeRecord (pure step of the stability firewall)', () => {
  test('returns prev itself when no key changed — record identity is preserved', () => {
    const prev: Rec = { data: { a: 1 }, fn, opaque: 'x' };
    const next: Rec = { data: prev.data, fn, opaque: 'x' };
    expect(stabilizeRecord(prev, next, TABLE)).toBe(prev);
  });

  test('DEEP_EQUAL: a fresh but deep-equal reference is restored to the previous one', () => {
    const prev: Rec = { data: { a: 1 }, fn, opaque: 'x' };
    const next: Rec = { data: { a: 1 }, fn, opaque: 'x' };
    const out = stabilizeRecord(prev, next, TABLE);
    // Restore makes every key equal to prev — whole-record identity survives.
    expect(out).toBe(prev);
    expect(out.data).toBe(prev.data);
  });

  test('DEEP_EQUAL: genuinely different contents flow through', () => {
    const prev: Rec = { data: { a: 1 }, fn, opaque: 'x' };
    const next: Rec = { data: { a: 2 }, fn, opaque: 'x' };
    const out = stabilizeRecord(prev, next, TABLE);
    expect(out).not.toBe(prev);
    expect(out.data).toBe(next.data);
    // Unchanged keys keep their previous references.
    expect(out.fn).toBe(fn);
    expect(out.opaque).toBe('x');
  });

  test('WARN_ONLY: no comparison — a fresh function reference flows through', () => {
    const otherFn = () => {};
    const prev: Rec = { data: { a: 1 }, fn, opaque: 'x' };
    const next: Rec = { data: prev.data, fn: otherFn, opaque: 'x' };
    const out = stabilizeRecord(prev, next, TABLE);
    expect(out.fn).toBe(otherFn);
  });

  test('PASS_THROUGH: value flows through untouched even when deep-equal', () => {
    const prev: Rec = { data: { a: 1 }, fn, opaque: { big: 'blob' } };
    const next: Rec = { data: prev.data, fn, opaque: { big: 'blob' } };
    const out = stabilizeRecord(prev, next, TABLE);
    expect(out.opaque).toBe(next.opaque);
    expect(out.opaque).not.toBe(prev.opaque);
  });

  test('undefined → value and value → undefined transitions are ordinary changes', () => {
    const prev: Rec = { data: undefined, fn: undefined, opaque: undefined };
    const next: Rec = { data: { a: 1 }, fn, opaque: 'x' };
    const out = stabilizeRecord(prev, next, TABLE);
    expect(out.data).toBe(next.data);
    const back = stabilizeRecord(out, prev, TABLE);
    expect(back.data).toBeUndefined();
  });
});
