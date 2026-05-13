/**
 * Shorten long consumer-supplied `documentId` values down to a fixed-length
 * Base62 hash so they don't bloat every rendered `id="…"` / `href="#…"`.
 *
 * Trade-offs:
 *   - Non-cryptographic hash (MurmurHash3 x86 32-bit) — pure speed, excellent
 *     avalanche on the structured inputs we actually receive (UUIDs, nanoids,
 *     `useId()` outputs, opaque chat-message ids). Collision domain is 2^32;
 *     at ~77,000 active document ids the birthday-paradox collision rate hits
 *     ~50%, which is far beyond any realistic single-page chat workload.
 *   - Only kicks in past a length threshold (default 16) so short, hand-picked
 *     ids stay readable and existing test fixtures (`'tst'`, `'doc-a'`, …)
 *     plus `useId()`'s `'_r_0_'`-style output (≤7 chars) pass through untouched.
 *   - Pure function: same input always yields the same output. Two chunks
 *     sharing one logical `documentId` therefore still produce identical
 *     prefixes, so cross-chunk anchor and footnote coordination is preserved.
 *
 * Why MurmurHash3 specifically (vs the simpler FNV-1a):
 *   - FNV-1a does NOT pass SMHasher's avalanche test. For *structured* inputs
 *     like UUIDs (fixed hyphen positions, hex-only alphabet) its lower bits
 *     show measurable bias, which translates to a higher *practical* collision
 *     rate than the theoretical 2^32 figure suggests.
 *   - MurmurHash3's finalizer (`fmix32`) — `h ^= h>>>16; h = imul(h, M1);
 *     h ^= h>>>13; h = imul(h, M2); h ^= h>>>16` — is purpose-built to
 *     flatten any local pattern that survives the body, which is what gets
 *     it through SMHasher. That's the entire engineering reason for the
 *     ~30-line code-size delta vs FNV-1a.
 *
 * @module components/shortenDocumentId
 */

const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Encode a non-negative 32-bit integer as a Base62 string (no padding). */
function toBase62(n: number): string {
  if (n === 0) return BASE62_ALPHABET[0];
  // Treat `n` as unsigned 32-bit so the sign bit doesn't make the loop spin.
  let v = n >>> 0;
  let out = '';
  while (v > 0) {
    out = BASE62_ALPHABET[v % 62] + out;
    v = Math.floor(v / 62);
  }
  return out;
}

/** 32-bit unsigned rotate-left, in pure JS. */
function rotl32(x: number, r: number): number {
  return (((x << r) | (x >>> (32 - r))) >>> 0);
}

// MurmurHash3 x86 32-bit mixing constants — from Appleby's reference impl.
// Naming follows the spec so the code reads against the paper verbatim.
const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

// Single TextEncoder reused per process — instantiation is non-trivial and
// the hash runs once per `<AIMarkdown>` provider commit. UTF-8 bytes (not
// JS UTF-16 code units) are the canonical Murmur3 input so the hash stays
// portable with reference implementations in other languages.
const UTF8_ENCODER = /* @__PURE__ */ new TextEncoder();

/**
 * MurmurHash3 x86 32-bit. Pure function over the UTF-8 byte sequence of `s`.
 *
 * Implementation notes:
 *   - `Math.imul(a, b)` performs signed 32-bit integer multiplication with
 *     proper overflow truncation. Plain `a * b` would promote to IEEE-754
 *     double and silently lose precision past 2^53, breaking the hash.
 *   - The body processes the input in 4-byte little-endian blocks; the
 *     1–3 byte tail is folded in with the canonical Murmur3 cascade.
 *   - The finalize step (the three `imul` + `xor >>> n` lines below the
 *     tail) is `fmix32` — the avalanche stage that distinguishes Murmur3
 *     from naive multiply-xor hashes.
 *
 * @param s - Arbitrary input string (any Unicode).
 * @param seed - Optional 32-bit seed. Defaults to `0` for deterministic
 *   reproducibility across machines.
 * @returns Unsigned 32-bit integer.
 */
function murmur3_32(s: string, seed: number = 0): number {
  const bytes = UTF8_ENCODER.encode(s);
  const len = bytes.length;
  let h1 = seed >>> 0;
  const nblocks = len >>> 2;

  // ── Body: 4-byte little-endian blocks ───────────────────────────────────
  for (let i = 0; i < nblocks; i++) {
    const b = i * 4;
    let k1 =
      bytes[b] |
      (bytes[b + 1] << 8) |
      (bytes[b + 2] << 16) |
      (bytes[b + 3] << 24);

    k1 = Math.imul(k1, C1);
    k1 = rotl32(k1, 15);
    k1 = Math.imul(k1, C2);

    h1 ^= k1;
    h1 = rotl32(h1, 13);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) >>> 0;
  }

  // ── Tail: 1–3 leftover bytes, folded in with classic Murmur3 cascade ────
  // The three `if`s implement C-style switch fallthrough: rem==3 runs all
  // three statements; rem==2 runs the bottom two; rem==1 runs only the last
  // block (which is the one that also mixes into h1).
  const tail = nblocks * 4;
  const rem = len & 3;
  if (rem > 0) {
    let k1 = 0;
    if (rem === 3) k1 ^= bytes[tail + 2] << 16;
    if (rem >= 2) k1 ^= bytes[tail + 1] << 8;
    k1 ^= bytes[tail];
    k1 = Math.imul(k1, C1);
    k1 = rotl32(k1, 15);
    k1 = Math.imul(k1, C2);
    h1 ^= k1;
  }

  // ── Finalize (fmix32): the avalanche stage ──────────────────────────────
  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

/**
 * Shorten a `documentId` for use inside an HTML id prefix.
 *
 * @param id - The raw documentId (consumer-supplied or `useId()` fallback).
 * @param threshold - Only ids strictly longer than this get hashed.
 *   Defaults to `16`, which leaves short hand-picked ids and React's
 *   `useId()` outputs unchanged but catches UUIDs (36 chars) and nanoids.
 * @returns Either the original `id` (when short) or a 1–6 char Base62 hash.
 */
export function shortenDocumentId(id: string, threshold: number = 16): string {
  if (id.length <= threshold) return id;
  return toBase62(murmur3_32(id));
}
