import { sanitizeSchema, createRegistry } from '@ai-markdown/engine';
import { renderTree } from './render';
import { describe, it, expect } from 'vitest';
import { createSSRApp, h, defineComponent } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { AIMarkdown, AIMarkdownDocuments, AIMarkdownSmoothStream, extendSanitizeSchema } from './index';

const render = (content: string, extra = {}) =>
  renderToString(createSSRApp({ render: () => h(AIMarkdown, { content, documentId: 'test', ...extra }) }));
describe('Vue SSR contracts', () => {
  it('renders semantic definition lists only while their plugin is enabled', async () => {
    const source = 'Term\n: Definition';
    const enabled = await render(source);
    expect(enabled).toContain('<dl>');
    expect(enabled).toContain('<dt>Term</dt>');
    expect(enabled).toContain('<dd>');
    const disabled = await render(source, { enginePlugins: [] });
    expect(disabled).not.toContain('<dl>');
    expect(disabled).toContain(': Definition');
  });
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
  it('keeps smooth-stream control props off the rendered root element', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(AIMarkdownSmoothStream, {
            content: 'text',
            documentId: 'smooth',
            coordinate: false,
            pacing: 'responsive',
            class: 'host',
          }),
      })
    );
    expect(html).toContain('class="aimd-vue host"');
    expect(html).not.toMatch(/\bcoordinate=/);
    expect(html).not.toMatch(/\bpacing=/);
  });
  it('emits the cursor tail marker only while streaming with the cursor enabled', async () => {
    const source = 'See [site][u].\n\n[u]: https://example.com';
    expect(await render(source)).not.toContain('data-aimd-tail-kind');
    expect(await render(source, { streaming: true, streamingCursor: false })).not.toContain('data-aimd-tail-kind');
    const streaming = await render(source, { streaming: true });
    expect(streaming).toContain('data-aimd-tail-kind="invisible-def"');
    const footnote = await render('Claim[^n].\n\n[^n]: body', { streaming: true });
    expect(footnote).toContain('data-aimd-tail-kind="footnote-def"');
    expect(footnote).toContain('data-aimd-tail-label="n"');
  });
});

it('applies URL policy and element overrides to coordinated footnote marks', async () => {
  const registry = createRegistry();
  const calls: string[] = [];
  const html = await renderToString(
    createSSRApp({
      render: () =>
        h(
          'main',
          renderTree(
            {
              type: 'root',
              children: [
                {
                  type: 'element',
                  tagName: 'footnote-sup',
                  properties: { label: 'N', localNumber: 1, localOccurrence: 1 },
                  children: [],
                },
              ],
            },
            {
              registry,
              sym: null,
              clobberPrefix: 'doc-',
              sanitizeSchema,
              urlTransform: (url) => {
                calls.push(url);
                return '/reader' + url;
              },
              components: {
                sup: defineComponent({
                  setup:
                    (_props, { slots }) =>
                    () =>
                      h('sup', { 'data-custom': 'yes' }, slots.default?.()),
                }),
              },
              slots: { a: ({ properties, children }) => [h('a', { ...properties, 'data-slot': 'yes' }, children)] },
              streaming: false,
              metadata: undefined,
            }
          )
        ),
    })
  );
  expect(calls).toEqual(['#doc-fn-n']);
  expect(html).toContain('href="/reader#doc-fn-n"');
  expect(html).toContain('data-custom="yes"');
  expect(html).toContain('data-slot="yes"');
});
