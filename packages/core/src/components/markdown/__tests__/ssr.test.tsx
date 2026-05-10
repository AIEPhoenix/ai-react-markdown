import { describe, test, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown from '../../../index';
import { AIMarkdownDocuments } from '../../AIMarkdownDocuments';

describe('SSR', () => {
  test('standalone Direction A SSR: orphan def renders in server output', () => {
    // True standalone — no <AIMarkdownDocuments> wrapper. The footnoteDefinition
    // handler is gated on `registry || effectivePreserveOrphan`; config defaults
    // preserveOrphanReferences:true, so the orphan-protection handler runs
    // even without a wrapper.
    const html = renderToString(<AIMarkdown content="[^x]: hello" />);
    expect(html).toContain('data-footnotes');
    expect(html).toContain('hello');
  });

  test('standalone with preserveOrphanReferences:false drops orphan', () => {
    const html = renderToString(<AIMarkdown content="[^x]: hello" config={{ preserveOrphanReferences: false }} />);
    expect(html).not.toContain('data-footnotes');
  });

  test('coordinated SSR: cross-chunk ref renders as literal (registry empty during SSR)', () => {
    const html = renderToString(
      <AIMarkdownDocuments>
        <AIMarkdown content="See [^x]." documentId="m" />
        <AIMarkdown content="[^x]: hello" documentId="m" />
      </AIMarkdownDocuments>
    );
    // Direction B placeholders render their fallback during SSR (useEffect doesn't run)
    expect(html).toContain('[^x]');
  });
});
