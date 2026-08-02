import { describe, expect, test } from 'vitest';
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
