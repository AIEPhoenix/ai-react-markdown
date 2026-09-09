import { describe, it, expect } from 'vitest';
import { createSSRApp, h, defineComponent } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { AIMarkdown, AIMarkdownDocuments, AIMarkdownSmoothStream, extendSanitizeSchema } from './index';

const render = (content: string, extra = {}) =>
  renderToString(createSSRApp({ render: () => h(AIMarkdown, { content, documentId: 'test', ...extra }) }));
describe('Vue SSR contracts', () => {
  it('renders actual HTML, math, GFM and defaults without browser globals', async () => {
    const html = await render('# Hello\n\n**bold** ==marked== $x^2$\n\n| a | b |\n| - | - |\n| c | d |');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<mark>marked</mark>');
    expect(html).toContain('katex');
    expect(html).toContain('<table>');
  });
  it('keeps local footnotes and applies final URL policy once', async () => {
    const html = await render('[safe](https://example.com) [bad](javascript:alert)\n\nref[^x]\n\n[^x]: body', {
      urlTransform: (url: string) => (url.startsWith('https:') ? url + '?once' : url),
    });
    expect(html).toContain('https://example.com?once');
    expect(html).not.toContain('?once?once');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('data-footnote-ref');
    expect(html).toContain('data-footnotes');
  });
  it('routes sanitized elements through components and scoped slots', async () => {
    const Code = defineComponent({
      props: ['node', 'streaming'],
      setup:
        (props, { slots }) =>
        () =>
          h('output', { 'data-streaming': String(props.streaming) }, slots.default?.()),
    });
    const html = await render('```ts\nhello\n```', { streaming: true, components: { code: Code } });
    expect(html).toContain('<output data-streaming="true"');
    expect(html).toContain('hello');
    const slot = await renderToString(
      createSSRApp({
        render: () =>
          h(
            AIMarkdown,
            { content: '**text**' },
            { strong: ({ children }: { children: string[] }) => h('b', { 'data-slot': 'yes' }, children) }
          ),
      })
    );
    expect(slot).toContain('<b data-slot="yes">text</b>');
  });
  it('does not render forged engine placeholders or DOM insertion sinks', async () => {
    const html = await render(
      '<cross-chunk-link label="x" local-url="javascript:alert(1)">safe</cross-chunk-link><img src="x" onerror="alert(1)">'
    );
    expect(html).not.toContain('cross-chunk-link');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    const broad = extendSanitizeSchema((draft) => {
      draft.attributes = { ...draft.attributes, div: ['innerHTML', 'onClick'] };
    });
    expect(
      await render('<div innerHTML="attack" onClick="attack">safe</div>', { sanitizeSchema: broad })
    ).not.toContain('attack');
  });
  it('preserves complete SSR content for smooth rendering and isolates requests', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(AIMarkdownDocuments, null, {
            default: () =>
              h(AIMarkdownSmoothStream, { content: 'complete[^x]\n\n[^x]: body', documentId: 'same', streaming: true }),
          }),
      })
    );
    expect(html).toContain('complete');
    expect(html).toContain('body');
    const other = await render('missing[^x]');
    expect(other).not.toContain('body');
  });
});
