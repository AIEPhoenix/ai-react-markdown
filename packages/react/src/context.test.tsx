import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdownProvider, {
  AIMarkdownMetadataProvider,
  useAIMarkdownMetadata,
  useAIMarkdownDocument,
} from './context';

/** Bare-provider harness — exercises the drop-in direct-composition path. */
function renderWithProvider(children: React.ReactNode, documentId?: string) {
  return renderToString(
    <AIMarkdownProvider streaming={false} fontSize="14px" variant="default" colorScheme="light" documentId={documentId}>
      {children}
    </AIMarkdownProvider>
  );
}

// ── useAIMarkdownMetadata wrapper pattern ────────────────────────────────────

interface ExtendedMeta {
  userId: string;
  role: 'admin' | 'viewer';
}

const useExtendedMetadata = () => useAIMarkdownMetadata<ExtendedMeta>();

function MetadataProbe() {
  const meta = useExtendedMetadata();
  return (
    <>
      <span data-testid="userId">{meta?.userId ?? ''}</span>
      <span data-testid="role">{meta?.role ?? ''}</span>
    </>
  );
}

describe('useAIMarkdownMetadata extended generic (wrapper-hook pattern)', () => {
  test('returns the provider-supplied metadata typed as TMetadata', () => {
    const html = renderToString(
      <AIMarkdownMetadataProvider<ExtendedMeta> metadata={{ userId: 'u_42', role: 'admin' }}>
        <MetadataProbe />
      </AIMarkdownMetadataProvider>
    );
    expect(html).toContain('data-testid="userId">u_42<');
    expect(html).toContain('data-testid="role">admin<');
  });

  test('returns undefined when no metadata is provided (no runtime fallback)', () => {
    // Metadata has no default-filling: the hook consistently yields
    // `undefined` when the provider receives none, regardless of the
    // asserted TMetadata.
    const html = renderToString(
      <AIMarkdownMetadataProvider>
        <MetadataProbe />
      </AIMarkdownMetadataProvider>
    );
    expect(html).toContain('data-testid="userId"></span>');
    expect(html).toContain('data-testid="role"></span>');
  });
});

// ── documentId resolution (single descent point in the provider) ─────────────

function DocumentIdProbe() {
  const { documentId, clobberPrefix } = useAIMarkdownDocument();
  return (
    <>
      <span data-testid="documentId">{documentId}</span>
      <span data-testid="clobberPrefix">{clobberPrefix}</span>
    </>
  );
}

describe('AIMarkdownProvider documentId shortening', () => {
  test('long documentId is hashed in clobberPrefix but kept raw on document.documentId', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const html = renderWithProvider(<DocumentIdProbe />, uuid);
    // document.documentId stays raw — registry keying and consumer code that
    // reads it directly are unaffected by the prefix shortening.
    expect(html).toContain(`data-testid="documentId">${uuid}</span>`);
    // clobberPrefix uses the shortened form: short Base62 + the constant tail.
    // It must NOT contain the raw UUID.
    expect(html).not.toMatch(/data-testid="clobberPrefix">[^<]*550e8400/);
    expect(html).toMatch(/data-testid="clobberPrefix">[A-Za-z0-9]{1,6}-user-content-/);
  });

  test('short documentId passes through unchanged into clobberPrefix', () => {
    // Short ids (≤16 chars) stay verbatim — this is the contract that keeps
    // existing snapshot tests, deep-link URLs, and hand-picked ids stable.
    const html = renderWithProvider(<DocumentIdProbe />, 'msg-7');
    expect(html).toContain('data-testid="documentId">msg-7</span>');
    expect(html).toContain('data-testid="clobberPrefix">msg-7-user-content-</span>');
  });
});

describe('AIMarkdownProvider ill-formed documentId (issue #32)', () => {
  // All tests in this block render corrupted ids, which trip the dev-mode
  // console.warn probe — spy once here instead of per-test try/finally.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });
  const surrogateWarnings = () =>
    warnSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('unpaired UTF-16 surrogate')
    );
  const prefixOf = (html: string) => {
    const m = html.match(/data-testid="clobberPrefix">([^<]*)</);
    if (!m) throw new Error('clobberPrefix span not found');
    return m[1];
  };

  test('a short documentId with an unpaired surrogate renders instead of throwing URIError', () => {
    // #32: '\uD800' is ≤16 code units, so pre-fix it reached
    // `encodeURIComponent` verbatim and aborted the whole render
    // synchronously with `URIError: URI malformed`. Post-fix, ill-formed
    // ids are hashed — the prefix is plain Base62 + the constant tail.
    const html = renderWithProvider(<DocumentIdProbe />, '\uD800');
    expect(prefixOf(html)).toMatch(/^[A-Za-z0-9]{1,6}-user-content-$/);
    // The raw documentId stays untouched for registry keying and consumers.
    expect(html).toContain('data-testid="documentId">\uD800</span>');
  });

  test('distinct ill-formed ids derive DISTINCT prefixes (no silent cross-document collision)', () => {
    // Two ids corrupted at different points must NOT share a prefix —
    // otherwise footnote anchors of two documents on one page cross-link.
    // (A lossy U+FFFD projection would merge all three of these.)
    const a = prefixOf(renderWithProvider(<DocumentIdProbe />, 'm-\uD800'));
    const b = prefixOf(renderWithProvider(<DocumentIdProbe />, 'm-\uDC00'));
    const c = prefixOf(renderWithProvider(<DocumentIdProbe />, 'm-\uFFFD')); // well-formed lookalike
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    // Determinism across documents: the same corrupted id aligns.
    expect(prefixOf(renderWithProvider(<DocumentIdProbe />, 'm-\uD800'))).toBe(a);
  });

  test('dev mode warns once about the unpaired surrogate (upstream truncation signal)', () => {
    renderWithProvider(<DocumentIdProbe />, '\uD800');
    expect(surrogateWarnings()).toHaveLength(1);
  });

  test('a well-formed emoji documentId never trips the surrogate warning', () => {
    // The detection predicate (engine's hasLoneSurrogate) matches lone
    // surrogates only — a valid pair reads as one astral code point.
    const html = renderWithProvider(<DocumentIdProbe />, 'doc-\u{1F600}');
    expect(html).toContain(`data-testid="documentId">doc-\u{1F600}</span>`);
    expect(surrogateWarnings()).toHaveLength(0);
  });

  test('an omitted documentId renders warning-free (smoke)', () => {
    // NOTE (review 2026-08-13): this only asserts the trivially-true
    // outcome — useId() output cannot contain surrogates, so zero warnings
    // here does NOT prove the documentIdExplicit gate exists (deleting the
    // gate keeps this green). The gate and the warnedFor per-id dedup are
    // an accepted coverage gap: pinning them needs a client-side rerender
    // (react-dom/client + jsdom), and the repo's test environment is
    // deliberately node-only. Kept as a smoke test for the fallback path.
    renderWithProvider(<DocumentIdProbe />);
    expect(surrogateWarnings()).toHaveLength(0);
  });
});

function ExplicitProbe() {
  const { documentId, documentIdExplicit } = useAIMarkdownDocument();
  return (
    <>
      <span data-testid="explicit">{String(documentIdExplicit)}</span>
      <span data-testid="docId">{documentId}</span>
    </>
  );
}

describe('AIMarkdownProvider documentIdExplicit', () => {
  // `documentIdExplicit` records whether the consumer SUPPLIED a documentId,
  // distinct from whether `document.documentId` is non-empty (it always is —
  // the provider auto-fills via useId). This boolean is what
  // `useDocumentRegistry` gates on so an auto-generated id does NOT opt a
  // standalone chunk into cross-chunk coordination just because it sits
  // inside <AIMarkdownDocuments>.
  test('is true when a non-empty documentId is supplied', () => {
    const html = renderWithProvider(<ExplicitProbe />, 'msg-7');
    expect(html).toContain('data-testid="explicit">true<');
    expect(html).toContain('data-testid="docId">msg-7<');
  });

  test('is false when documentId is omitted (still gets a non-empty fallback id)', () => {
    const html = renderWithProvider(<ExplicitProbe />);
    expect(html).toContain('data-testid="explicit">false<');
    // The fallback id is still surfaced (non-empty) so clobberPrefix / id
    // attributes stay valid — only the coordination signal is false.
    expect(html).toMatch(/data-testid="docId">[^<]+<\/span>/);
  });

  test('is false when documentId is an empty string', () => {
    const html = renderWithProvider(<ExplicitProbe />, '');
    expect(html).toContain('data-testid="explicit">false<');
  });
});
