/**
 * Unit tests for `sanitizeCrossChunkUrl`. The function is the render-time
 * symmetry layer for cross-chunk link/image placeholders — it must produce
 * the same observable result as the standalone in-tree two-gate pipeline
 * (urlTransform + rehype-sanitize protocols allowlist) for any given URL,
 * key, and tag.
 */
import { describe, expect, test } from 'vitest';
import type { Element as HastElement } from 'hast';
import { sanitizeCrossChunkUrl } from './crossChunkUrlSanitize';
import { sanitizeSchema as defaultLibrarySchema } from './sanitizeSchema';
import { extendSanitizeSchema } from './extendSanitizeSchema';
import { defaultUrlTransform } from './markdown';

describe('sanitizeCrossChunkUrl — default library policy', () => {
  test('strips javascript: hrefs on <a>', () => {
    expect(
      sanitizeCrossChunkUrl(
        'javascript:alert(1)',
        'href',
        'a',
        defaultUrlTransform,
        defaultLibrarySchema
      )
    ).toBe('');
  });

  test('strips javascript: srcs on <img>', () => {
    expect(
      sanitizeCrossChunkUrl(
        'javascript:alert(1)',
        'src',
        'img',
        defaultUrlTransform,
        defaultLibrarySchema
      )
    ).toBe('');
  });

  test('preserves https:// hrefs', () => {
    expect(
      sanitizeCrossChunkUrl(
        'https://example.com/x',
        'href',
        'a',
        defaultUrlTransform,
        defaultLibrarySchema
      )
    ).toBe('https://example.com/x');
  });

  test('preserves https:// srcs on <img>', () => {
    expect(
      sanitizeCrossChunkUrl(
        'https://example.com/pic.png',
        'src',
        'img',
        defaultUrlTransform,
        defaultLibrarySchema
      )
    ).toBe('https://example.com/pic.png');
  });

  test('preserves relative urls', () => {
    expect(
      sanitizeCrossChunkUrl('/abs/path', 'href', 'a', defaultUrlTransform, defaultLibrarySchema)
    ).toBe('/abs/path');
    expect(
      sanitizeCrossChunkUrl('rel/path', 'href', 'a', defaultUrlTransform, defaultLibrarySchema)
    ).toBe('rel/path');
  });

  test('preserves a hash-only fragment href (colon-after-#)', () => {
    expect(
      sanitizeCrossChunkUrl('#section:title', 'href', 'a', defaultUrlTransform, defaultLibrarySchema)
    ).toBe('#section:title');
  });
});

describe('sanitizeCrossChunkUrl — both gates must permit (defense in depth)', () => {
  test('gate 1 strips when urlTransform returns null even if schema permits', () => {
    // urlTransform blocks; schema allows http. Result must be empty.
    const blockAll = () => null as unknown as string;
    expect(
      sanitizeCrossChunkUrl('http://allowed.example/', 'href', 'a', blockAll, defaultLibrarySchema)
    ).toBe('');
  });

  test('gate 2 strips when schema blocks even if urlTransform permits', () => {
    // urlTransform allows myapp; schema does NOT include myapp in
    // protocols.href. This is exactly the standalone behavior — schema
    // wins. Cross-chunk must match.
    const allowMyapp = (url: string) => url;
    const html = sanitizeCrossChunkUrl(
      'myapp://thing',
      'href',
      'a',
      allowMyapp,
      defaultLibrarySchema
    );
    expect(html).toBe('');
  });

  test('both gates permit → URL passes through', () => {
    const allowMyapp = (url: string) => url;
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
    });
    expect(
      sanitizeCrossChunkUrl('myapp://thing', 'href', 'a', allowMyapp, schema)
    ).toBe('myapp://thing');
  });

  test('schema permits href but NOT src — asymmetric per-attribute allowlist honored', () => {
    // Critical regression scenario: a consumer who deliberately allows a
    // scheme on `<a href>` but disallows it on `<img src>` (e.g. to allow
    // private-scheme deep links but block opaque-scheme image src for
    // tracking-pixel hygiene). The standalone path enforces this via
    // `protocols.href` vs `protocols.src`. Cross-chunk must match.
    const allowMyapp = (url: string) => url;
    const schema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('myapp');
      // NOTE: deliberately NOT adding myapp to protocols.src.
    });
    expect(
      sanitizeCrossChunkUrl('myapp://thing', 'href', 'a', allowMyapp, schema)
    ).toBe('myapp://thing');
    expect(
      sanitizeCrossChunkUrl('myapp://thing', 'src', 'img', allowMyapp, schema)
    ).toBe('');
  });
});

describe('sanitizeCrossChunkUrl — key-aware urlTransform contract', () => {
  test('passes correct key+tag to a key-aware urlTransform', () => {
    const calls: Array<{ url: string; key: string; tagName: string }> = [];
    const recordingTransform = (url: string, key: string, node: HastElement) => {
      calls.push({ url, key, tagName: node.tagName });
      return url;
    };

    sanitizeCrossChunkUrl(
      'https://x/',
      'href',
      'a',
      recordingTransform,
      defaultLibrarySchema
    );
    sanitizeCrossChunkUrl(
      'https://y/',
      'src',
      'img',
      recordingTransform,
      defaultLibrarySchema
    );

    expect(calls).toEqual([
      { url: 'https://x/', key: 'href', tagName: 'a' },
      { url: 'https://y/', key: 'src', tagName: 'img' },
    ]);
  });

  test('a key-aware transform that blocks src-only blocks images but not links', () => {
    // A transform that blocks the same URL on `src` (e.g. to prevent
    // tracking pixels) but allows it on `href` must produce divergent
    // results for cross-chunk link vs image of the same registry def.
    const onlyHref = (url: string, key: string) => (key === 'href' ? url : '');
    expect(
      sanitizeCrossChunkUrl(
        'https://tracker.example/x',
        'href',
        'a',
        onlyHref,
        defaultLibrarySchema
      )
    ).toBe('https://tracker.example/x');
    expect(
      sanitizeCrossChunkUrl(
        'https://tracker.example/x',
        'src',
        'img',
        onlyHref,
        defaultLibrarySchema
      )
    ).toBe('');
  });
});

describe('sanitizeCrossChunkUrl — missing schema entries', () => {
  test('no protocols.<key> entry within a caller-supplied protocols means no protocol restriction (matches hast-util-sanitize)', () => {
    // hast-util-sanitize: when the caller supplies a `protocols` object but
    // it lacks an entry for the queried attribute, the upstream code path
    // returns `true` immediately ("everything is fine"). Our helper must
    // mirror that — using the partial caller's `protocols` verbatim and
    // NOT cherry-picking default entries for missing keys (the latter
    // would over-restrict relative to standalone).
    const noProtoSchema = extendSanitizeSchema((s) => {
      delete s.protocols!.href;
    });
    const allowAll = (url: string) => url;
    expect(
      sanitizeCrossChunkUrl('myapp://thing', 'href', 'a', allowAll, noProtoSchema)
    ).toBe('myapp://thing');
  });

  test('empty protocols.<key> array is also treated as no-restriction', () => {
    // Matches upstream's `if (!protocols || protocols.length === 0) return true`.
    const emptyProtoSchema = extendSanitizeSchema((s) => {
      s.protocols!.href = [];
    });
    const allowAll = (url: string) => url;
    expect(
      sanitizeCrossChunkUrl('myapp://thing', 'href', 'a', allowAll, emptyProtoSchema)
    ).toBe('myapp://thing');
  });

  test('schema with NO `protocols` field at all falls back to library default protocols', () => {
    // Upstream applies `{...defaultSchema, ...options}` shallow-merge, so a
    // caller-supplied sparse schema (e.g. only `tagNames` / `attributes`)
    // inherits `defaultSchema.protocols` entirely. Our helper mirrors that
    // by falling back to `libraryDefaultSchema.protocols` when the
    // top-level `protocols` field is absent. Without the fallback, a
    // TypeScript-bypass caller could silently get allow-all here while
    // standalone applied the default allowlist — the round-2 codex finding.
    const sparseSchema = { tagNames: ['p'] } as unknown as Parameters<typeof sanitizeCrossChunkUrl>[4];
    const allowAll = (url: string) => url;
    // `javascript:` is NOT in defaultSchema.protocols.href → must be stripped.
    expect(
      sanitizeCrossChunkUrl('javascript:alert(1)', 'href', 'a', allowAll, sparseSchema)
    ).toBe('');
    // `https:` IS in defaultSchema.protocols.href → must pass.
    expect(
      sanitizeCrossChunkUrl('https://example.com/x', 'href', 'a', allowAll, sparseSchema)
    ).toBe('https://example.com/x');
  });
});

describe('sanitizeCrossChunkUrl — case-sensitive protocol comparison (upstream parity)', () => {
  // `hast-util-sanitize`'s protocol check is literal string equality on the
  // protocol prefix (`url.slice(0, protocol.length) === protocol`). The
  // helper used to lowercase both sides, which made it MORE permissive than
  // upstream for mixed-case schemes — `HTTPS://x` would be stripped
  // standalone but render cross-chunk. Both reviewers (oracle + codex)
  // flagged this as a parity bug; these tests pin the fix.

  test('mixed-case scheme `HTTPS://` is stripped (matches standalone hast-util-sanitize)', () => {
    const allowAll = (url: string) => url;
    // Default schema's protocols.href contains lowercase 'http'/'https' only.
    // 'HTTPS' does not match either, so the URL must be stripped.
    expect(
      sanitizeCrossChunkUrl(
        'HTTPS://example.com/x',
        'href',
        'a',
        allowAll,
        defaultLibrarySchema
      )
    ).toBe('');
  });

  test('canonical-case scheme `https://` still passes', () => {
    const allowAll = (url: string) => url;
    expect(
      sanitizeCrossChunkUrl(
        'https://example.com/x',
        'href',
        'a',
        allowAll,
        defaultLibrarySchema
      )
    ).toBe('https://example.com/x');
  });

  test('caller-supplied protocol must match URL case (no implicit lowercasing on either side)', () => {
    // Caller adds 'MYAPP' to protocols.href. `myapp://...` (lowercase URL)
    // does NOT match 'MYAPP' (uppercase allowlist entry). The user is
    // expected to configure the allowlist and URL in matching case — same
    // contract as standalone.
    const upperSchema = extendSanitizeSchema((s) => {
      s.protocols!.href!.push('MYAPP');
    });
    const allowAll = (url: string) => url;
    expect(
      sanitizeCrossChunkUrl('myapp://thing', 'href', 'a', allowAll, upperSchema)
    ).toBe('');
    // Mismatched case in the OTHER direction also rejects.
    expect(
      sanitizeCrossChunkUrl('MYAPP://thing', 'href', 'a', allowAll, upperSchema)
    ).toBe('MYAPP://thing');
  });
});
