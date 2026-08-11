import { describe, test, expect } from 'vitest';
import { shortenDocumentId } from './shortenDocumentId';

describe('shortenDocumentId — threshold gating', () => {
  test('returns the input unchanged when at or below threshold', () => {
    expect(shortenDocumentId('tst')).toBe('tst');
    expect(shortenDocumentId('doc-a')).toBe('doc-a');
    // useId()'s typical `_r_0_` shape passes through verbatim so existing
    // snapshot tests do not churn.
    expect(shortenDocumentId('_r_0_')).toBe('_r_0_');
    // Length exactly equal to the default threshold (16) is still verbatim.
    expect(shortenDocumentId('a'.repeat(16))).toBe('a'.repeat(16));
  });

  test('hashes ids longer than threshold to ≤6 Base62 chars', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const out = shortenDocumentId(uuid);
    expect(out).not.toBe(uuid);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out).toMatch(/^[A-Za-z0-9]+$/);
  });

  test('custom threshold is respected', () => {
    expect(shortenDocumentId('abcdefgh', 4).length).toBeLessThanOrEqual(6);
    expect(shortenDocumentId('abcd', 4)).toBe('abcd');
    // A threshold high enough to skip every realistic input disables hashing.
    expect(shortenDocumentId('a'.repeat(40), 100)).toBe('a'.repeat(40));
  });

  test('empty string is below threshold and returned as-is', () => {
    // Defensive: callers shouldn't hand us '', but the function should not
    // throw or produce something weird if they do.
    expect(shortenDocumentId('')).toBe('');
  });

  test('hash output stays inside the Base62 alphabet (URI-safe, no padding)', () => {
    const out = shortenDocumentId('very-long-document-identifier-that-definitely-triggers-hashing');
    expect(out).toMatch(/^[A-Za-z0-9]+$/);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('shortenDocumentId — algorithmic properties', () => {
  test('deterministic: same input always yields same output', () => {
    const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(shortenDocumentId(uuid)).toBe(shortenDocumentId(uuid));
  });

  test('single-bit input change perturbs the output (MurmurHash3 avalanche)', () => {
    // Two 20-byte inputs differing in only the LAST byte. A weak hash with
    // poor low-bit avalanche would produce outputs identical in all but the
    // trailing Base62 char(s). With fmix32 in place, the entire 32-bit
    // output is reshuffled — the two Base62 strings should differ along
    // most positions, not just the tail.
    const a = shortenDocumentId('aaaaaaaaaaaaaaaaaaaa');
    const b = shortenDocumentId('aaaaaaaaaaaaaaaaaaab');
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]); // first Base62 char ≈ high hash bits
  });

  test('anagrams do not collide (rules out order-insensitive "hash" bugs)', () => {
    // The classic check: a sum-of-charCodes "hash" would give all permutations
    // of the same multiset identical outputs. MurmurHash3's block-mixing makes
    // this vanishingly unlikely.
    expect(shortenDocumentId('abcdefghijklmnopqrst')).not.toBe(shortenDocumentId('tsrqponmlkjihgfedcba'));
  });

  test('UUID set hashes without collisions across 1000 sequential inputs', () => {
    // Sanity check on the actual distribution against the actual workload.
    // 1000 ids into a 2^32 space — birthday-paradox expectation is
    // ~1000²/(2·2^32) ≈ 0.012% chance of any collision, so this test is
    // essentially asserting the impl has no systemic bias.
    const out = new Set<string>();
    for (let i = 0; i < 1000; i++) out.add(shortenDocumentId(`doc-uuid-stream-${i}`));
    expect(out.size).toBe(1000);
  });
});

describe('shortenDocumentId — MurmurHash3 reference vectors', () => {
  // These outputs are the Base62 encoding of the canonical MurmurHash3 x86
  // 32-bit hash values for known inputs, cross-verified against the Apache
  // Commons reference implementation:
  //   hash32('a')    = 0x3c2569b2  -> 'BGSBEG'
  //   hash32('ab')   = 0x9bbfd75f  -> 'C00DUb'
  //   hash32('abc')  = 0xb3dd93fa  -> 'DSNsxU'
  //   hash32('abcd') = 0x43ed676a  -> 'BPHwU6'
  // If a future "optimization" changes any of these, the implementation is
  // no longer bit-compatible with the canonical algorithm — almost certainly
  // a regression.
  test.each([
    ['a', 'BGSBEG'],
    ['ab', 'C00DUb'],
    ['abc', 'DSNsxU'],
    ['abcd', 'BPHwU6'],
  ])('MurmurHash3 vector: %s -> %s', (input, expected) => {
    // threshold=0 forces hashing even on these short reference inputs.
    expect(shortenDocumentId(input, 0)).toBe(expected);
  });
});

describe('shortenDocumentId — stability snapshots', () => {
  // Workload-shaped fixtures. These pin THIS implementation's output for
  // UUID / repeated-char / prefixed inputs so a future refactor that
  // accidentally drifts the hash (e.g. swaps endianness, drops the fmix32
  // step, mishandles the tail) is caught immediately — even when the
  // canonical reference vectors above still pass for some reason.
  test.each([
    ['550e8400-e29b-41d4-a716-446655440000', 'BChAcc'],
    ['f47ac10b-58cc-4372-a567-0e02b2c3d479', 'DuBkUp'],
    ['a'.repeat(20), 'Dv4eHX'],
    ['b'.repeat(20), 'Cy9hHo'],
    ['msg-00000000-0000-0000-0000-000000000000', 'CxtbHD'],
  ])('snapshot: %s -> %s', (input, expected) => {
    expect(shortenDocumentId(input)).toBe(expected);
  });
});
