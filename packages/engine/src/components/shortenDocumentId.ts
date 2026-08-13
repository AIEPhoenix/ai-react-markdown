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
  return ((x << r) | (x >>> (32 - r))) >>> 0;
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
  return murmur3_32_bytes(UTF8_ENCODER.encode(s), seed);
}

/**
 * MurmurHash3 x86 32-bit over an explicit byte sequence. Split out from
 * `murmur3_32` so the ill-formed-id branch of `shortenDocumentId` can hash
 * raw UTF-16LE code units — `TextEncoder` is lossy on unpaired surrogates
 * (WHATWG USVString conversion folds every lone surrogate to U+FFFD), so
 * feeding it an ill-formed string would silently merge distinct ids.
 */
function murmur3_32_bytes(bytes: Uint8Array, seed: number = 0): number {
  const len = bytes.length;
  let h1 = seed >>> 0;
  const nblocks = len >>> 2;

  // ── Body: 4-byte little-endian blocks ───────────────────────────────────
  for (let i = 0; i < nblocks; i++) {
    const b = i * 4;
    let k1 = bytes[b] | (bytes[b + 1] << 8) | (bytes[b + 2] << 16) | (bytes[b + 3] << 24);

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

// With the `u` flag this character class matches ONLY unpaired surrogates:
// a valid pair reads as one astral code point, which lies outside
// [U+D800, U+DFFF]. Dropping the flag would make it match each HALF of a
// valid pair and misclassify ordinary emoji ids — the flag is load-bearing.
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u;

/**
 * Whether `id` is ill-formed UTF-16 (contains at least one unpaired
 * surrogate — typically the fallout of an upstream pipeline slicing a
 * string mid-emoji). Exported as the single owner of the detection
 * semantics so consumers (e.g. core's dev-mode documentId warning) cannot
 * drift from the branch condition inside `shortenDocumentId`.
 */
export function hasLoneSurrogate(id: string): boolean {
  return LONE_SURROGATE_RE.test(id);
}

/**
 * Domain-separation seed for hashing ill-formed ids. Ill-formed ids hash
 * over raw UTF-16LE code-unit bytes while long well-formed ids hash over
 * UTF-8 bytes — and the two byte encodings can collide: a lone-surrogate
 * id's UTF-16LE byte sequence can equal some well-formed id's UTF-8 byte
 * sequence (e.g. utf16le("\uD800\u4E80") === utf8("\u0000\u0600N")
 * === [00 D8 80 4E]; both sides padded past the threshold to actually
 * reach the two hash branches). A distinct seed makes equal byte inputs
 * produce unrelated hashes, reducing cross-domain collisions to the
 * generic 2^32 class.
 */
const ILL_FORMED_SEED = 1;

/**
 * Raw UTF-16LE code-unit bytes of `s` — total and trivially injective on
 * ALL JavaScript strings, unlike UTF-8 encoding, which is lossy on
 * ill-formed input (`TextEncoder` folds every lone surrogate to U+FFFD).
 */
function utf16leBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes[i * 2] = c & 0xff;
    bytes[i * 2 + 1] = c >>> 8;
  }
  return bytes;
}

/**
 * Shorten a `documentId` for use inside an HTML id prefix.
 *
 * Well-formed ids keep the original contract byte-for-byte: at or below
 * `threshold` they pass through verbatim; above it they hash via
 * MurmurHash3 over UTF-8 bytes to a 1–6 char Base62 form.
 *
 * Ill-formed UTF-16 ids (unpaired surrogates, e.g. from an upstream
 * pipeline slicing a string mid-emoji) are ALWAYS hashed, regardless of
 * length — over their raw UTF-16LE code units, seeded with
 * `ILL_FORMED_SEED`. Rationale (issue #32):
 *
 *   - Returned verbatim, a lone surrogate makes the caller's
 *     `encodeURIComponent` throw `URIError: URI malformed` synchronously,
 *     aborting the whole render before any markdown is parsed.
 *   - Hashing the WHATWG lossy projection (lone surrogates → U+FFFD, what
 *     `TextEncoder`/`toWellFormed()` do) was rejected: it silently merges
 *     distinct corrupted ids — and merges them with a well-formed id
 *     containing a literal U+FFFD — turning the old loud error into a
 *     silent cross-document anchor collision.
 *   - Escaping into a well-formed string before hashing was rejected too:
 *     a naive marker scheme is not injective (marker-lookalike content
 *     forges it), and an escape-the-escape scheme is strictly more code
 *     than hashing the raw code units, which is injective for free.
 *
 * Distinct ids therefore produce distinct prefixes up to the generic 2^32
 * birthday bound — the same guarantee long well-formed ids always had —
 * with no equivalence-class carve-out for corrupted input.
 *
 * @param id - The raw documentId (consumer-supplied or `useId()` fallback).
 *   Any JavaScript string is accepted, including ill-formed UTF-16.
 * @param threshold - Only well-formed ids strictly longer than this get
 *   hashed. Defaults to `16`, which leaves short hand-picked ids and
 *   React's `useId()` outputs unchanged but catches UUIDs (36 chars) and
 *   nanoids. Ill-formed ids ignore the threshold — they always hash.
 * @returns The original `id` (well-formed and short) or a 1–6 char Base62
 *   hash (well-formed long, or ill-formed of any length).
 */
export function shortenDocumentId(id: string, threshold: number = 16): string {
  if (hasLoneSurrogate(id)) return toBase62(murmur3_32_bytes(utf16leBytes(id), ILL_FORMED_SEED));
  if (id.length <= threshold) return id;
  return toBase62(murmur3_32(id));
}
