// React integration: marker attributes through the real renderer.
import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import AIMarkdown from '../../index';
describe('tail marker — real pipeline via renderToString', () => {
  test('a streaming footnote-def tail stamps the marker; the standalone li id coexists', () => {
    const html = renderToString(<AIMarkdown content={'body [^a]\n\n[^a]: partial def'} streaming />);
    expect(html).toContain('data-aimd-tail-kind="footnote-def"');
    expect(html).toContain('data-aimd-tail-label="a"');
    expect(html).toMatch(/id="[^"]*user-content-fn-a"/);
  });

  test('LAZY CONTINUATION stays in-def — the case a text back-walk gets wrong', () => {
    // `line2` has zero indentation yet still belongs to the definition.
    const html = renderToString(<AIMarkdown content={'body [^a]\n\n[^a]: line1\nline2'} streaming />);
    expect(html).toContain('data-aimd-tail-kind="footnote-def"');
  });

  test('a body tail after a mid-document definition renders NO marker', () => {
    const html = renderToString(<AIMarkdown content={'body [^a]\n\n[^a]: def\n\nmore body'} streaming />);
    expect(html).not.toContain('data-aimd-tail-kind');
  });

  test('a trailing blank line after the def stays in-def (benign either way)', () => {
    const html = renderToString(<AIMarkdown content={'body [^a]\n\n[^a]: def text\n\n'} streaming />);
    expect(html).toContain('data-aimd-tail-kind="footnote-def"');
  });

  test('a streaming link-definition tail stamps invisible-def', () => {
    const html = renderToString(<AIMarkdown content={'body [x]\n\n[x]: https://example.com/lo'} streaming />);
    expect(html).toContain('data-aimd-tail-kind="invisible-def"');
  });

  test('no marker without streaming — static documents keep :last-child semantics', () => {
    const html = renderToString(<AIMarkdown content={'body [^a]\n\n[^a]: full def'} streaming={false} />);
    expect(html).not.toContain('data-aimd-tail-kind');
  });
});
