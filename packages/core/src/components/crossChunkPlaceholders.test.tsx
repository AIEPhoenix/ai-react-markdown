import { describe, test, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { AIMarkdownDocuments, __internalGetContext } from './AIMarkdownDocuments';
import { ChunkSymbolContext } from './chunkSymbolContext';
import AIMarkdownRenderStateProvider from '../context';
import { CrossChunkImage, CrossChunkLink, FootnoteSupNumber } from './crossChunkPlaceholders';

function WithProvider({ children, documentId }: { children: ReactNode; documentId: string }) {
  return (
    <AIMarkdownDocuments>
      <AIMarkdownRenderStateProvider
        streaming={false}
        fontSize="14px"
        variant="default"
        colorScheme="light"
        documentId={documentId}
      >
        {children}
      </AIMarkdownRenderStateProvider>
    </AIMarkdownDocuments>
  );
}

function SeedRegistryMidFlight({ children }: { children: ReactNode }) {
  const ctx = __internalGetContext();
  const registry = ctx!.getRegistry('doc');
  const existing = registry.allocateSymbol('existing');
  registry.contributeChunkData(existing, {
    refs: [{ label: 'X', kind: 'footnote' }],
    defs: new Map(),
    linkDefs: new Map(),
    ownFootnoteLabels: new Set(),
    ownLinkLabels: new Set(),
  });
  const pending = registry.allocateSymbol('pending');
  return <ChunkSymbolContext.Provider value={pending}>{children}</ChunkSymbolContext.Provider>;
}

describe('crossChunkPlaceholders', () => {
  test('FootnoteSupNumber accepts STRING localOccurrence (post-rehype-raw shape)', () => {
    // rehype-raw's parse5 round-trip stringifies numeric hast properties.
    // FootnoteSupNumber must coerce the wire-shape to compute the right
    // global occurrence — `typeof === 'number'` is the wrong gate.
    function SeedAndRender({ occurrence }: { occurrence: number | string }) {
      const ctx = __internalGetContext();
      const reg = ctx!.getRegistry('doc');
      const sym = reg.allocateSymbol('chunk1');
      reg.contributeChunkData(sym, {
        refs: [
          { label: 'X', kind: 'footnote' },
          { label: 'X', kind: 'footnote' },
        ],
        defs: new Map([['X', { identifier: 'X', sourceIdentifier: 'x', contentSource: 'b' }]]),
        linkDefs: new Map(),
        ownFootnoteLabels: new Set(['X']),
        ownLinkLabels: new Set(),
      });
      return (
        <ChunkSymbolContext.Provider value={sym}>
          <FootnoteSupNumber label="X" localOccurrence={occurrence as number} />
        </ChunkSymbolContext.Provider>
      );
    }
    // Numeric input — standard pre-pipeline shape.
    const htmlNum = renderToString(
      <WithProvider documentId="doc">
        <SeedAndRender occurrence={2} />
      </WithProvider>
    );
    // String input — what rehype-raw actually emits.
    const htmlStr = renderToString(
      <WithProvider documentId="doc">
        <SeedAndRender occurrence={'2'} />
      </WithProvider>
    );
    // Both render the second-occurrence backref id `fnref-X-2`.
    expect(htmlNum).toContain('fnref-X-2');
    expect(htmlStr).toContain('fnref-X-2');
  });

  test('FootnoteSupNumber renders empty when registry has no number for the label', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <FootnoteSupNumber label="X" />
      </WithProvider>
    );
    // No <sup>, no <a data-footnote-ref>, no rendered number content.
    expect(html).not.toContain('<sup');
    expect(html).not.toContain('data-footnote-ref');
  });

  test('FootnoteSupNumber waits until the chunk occurrence is registered', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <SeedRegistryMidFlight>
          <FootnoteSupNumber label="X" localOccurrence={1} />
        </SeedRegistryMidFlight>
      </WithProvider>
    );
    expect(html).not.toContain('<sup');
    expect(html).not.toContain('data-footnote-ref');
    expect(html).not.toContain('fnref-X');
  });

  test('CrossChunkLink fallback flattens rich children to plain text (no [object Object])', () => {
    // When the [text] slot contained inline markup like `[**bold**][X]`,
    // react-markdown hands CrossChunkLink a React element tree as children.
    // The previous `String(children?.toString?.())` path produced literal
    // `[object Object]` in the fallback. The fix walks the children tree
    // and concatenates text content.
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="full">
          <strong>bold</strong> text
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).not.toContain('[object Object]');
    expect(html).toContain('[bold text][X]');
  });

  test('CrossChunkLink fallback handles nested + array children', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="full">
          {[
            'a',
            <em key="e">b</em>,
            <span key="s">
              <code>c</code>
            </span>,
          ]}
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[abc][X]');
  });

  test('CrossChunkLink referenceType=full → fallback `[click][X]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="full">
          click
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[click][X]');
    // No anchor element rendered on fallback path.
    expect(html).not.toContain('<a ');
  });

  test('CrossChunkLink referenceType=shortcut → fallback `[X]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="shortcut">
          X
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[X]');
    expect(html).not.toContain('[X][');
    expect(html).not.toContain('<a ');
  });

  test('CrossChunkLink referenceType=collapsed → fallback `[X][]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkLink label="X" referenceType="collapsed">
          X
        </CrossChunkLink>
      </WithProvider>
    );
    expect(html).toContain('[X][]');
    expect(html).not.toContain('<a ');
  });

  test('CrossChunkImage referenceType=full → fallback `![alt text][X]`', () => {
    const html = renderToString(
      <WithProvider documentId="doc">
        <CrossChunkImage label="X" referenceType="full" alt="alt text" />
      </WithProvider>
    );
    expect(html).toContain('![alt text][X]');
    expect(html).not.toContain('<img');
  });
});
