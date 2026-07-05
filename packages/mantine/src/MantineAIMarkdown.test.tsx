import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MantineProvider, type MantineProviderProps } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from './MantineAIMarkdown';
import { useMantineAIMarkdownRenderState } from './hooks/useMantineAIMarkdownRenderState';

const adapter = createHighlightJsAdapter(hljs);

/** Drop element tags so assertions can match text that hljs split into token spans. */
const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

// SSR smoke harness mirroring the README consumer setup (MantineProvider +
// CodeHighlightAdapterProvider). renderToString keeps these tests in the same
// node environment as the core suite — no jsdom, no effects, so what's being
// exercised is the provider wiring, the default component overrides, and the
// config/state plumbing rather than browser behavior.
function renderMarkdown(ui: ReactNode, providerProps?: Omit<MantineProviderProps, 'children'>) {
  return renderToString(
    <MantineProvider {...providerProps}>
      <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );
}

describe('MantineAIMarkdown smoke', () => {
  test('renders basic markdown inside MantineProvider', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'# Hello\n\nstreaming **world**'} />);
    expect(html).toContain('<h1');
    expect(html).toContain('Hello');
    expect(html).toContain('<strong');
    expect(html).toContain('world');
  });

  test('recognized code fence renders via CodeHighlightTabs with the language as tab label', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```typescript\nconst answer = 42;\n```'} />);
    // The hljs adapter highlights at SSR time, splitting the code text across
    // token <span>s — compare against the tag-stripped text.
    expect(stripTags(html)).toContain('const answer = 42;');
    // CodeHighlightTabs renders `fileName: 'typescript'` as tab text — the
    // core default `<pre><code class="language-typescript">` path would not
    // produce "typescript" as element text.
    expect(html).toMatch(/>typescript</);
  });

  test('json code fence is deep-parsed and pretty-printed', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```json\n{"a":{"b":1}}\n```'} />);
    // deepParseJson + JSON.stringify(..., null, 2) reformats the one-liner —
    // the indented `"b": 1` line only exists if pretty-printing ran.
    expect(stripTags(html)).toContain('&quot;b&quot;: 1');
  });

  test('caller customComponents override the Mantine pre default', () => {
    const html = renderMarkdown(
      <MantineAIMarkdown
        content={'```typescript\nconst answer = 42;\n```'}
        customComponents={{ pre: () => <pre data-custom-pre="yes" /> }}
      />
    );
    expect(html).toContain('data-custom-pre="yes"');
    expect(html).not.toMatch(/>typescript</);
  });

  test('color scheme is auto-detected from MantineProvider', () => {
    const SchemeProbe = () => {
      const { colorScheme } = useMantineAIMarkdownRenderState();
      return <em data-scheme={colorScheme} />;
    };
    const html = renderMarkdown(<MantineAIMarkdown content={'*probe*'} customComponents={{ em: SchemeProbe }} />, {
      forceColorScheme: 'dark',
    });
    expect(html).toContain('data-scheme="dark"');
  });

  test('explicit colorScheme prop wins over the computed scheme', () => {
    const SchemeProbe = () => {
      const { colorScheme } = useMantineAIMarkdownRenderState();
      return <em data-scheme={colorScheme} />;
    };
    const html = renderMarkdown(
      <MantineAIMarkdown content={'*probe*'} colorScheme="light" customComponents={{ em: SchemeProbe }} />,
      { forceColorScheme: 'dark' }
    );
    expect(html).toContain('data-scheme="light"');
  });

  test('mermaid code fence renders without crashing under SSR', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```mermaid\ngraph TD;\nA-->B;\n```'} />);
    expect(html.length).toBeGreaterThan(0);
  });

  test('raw HTML <pre> without a code child falls back to a plain <pre>', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'<pre>just preformatted text</pre>'} />);
    expect(html).toContain('just preformatted text');
    // The Mantine code-block path always renders the expand control — a plain
    // <pre> fallback must not.
    expect(html).not.toContain('Expand code');
    expect(html).not.toContain('Collapse code');
  });

  test('raw HTML <br> inside a code block maps to a single newline', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'<pre><code>a<br>b</code></pre>'} />);
    // join('\n') over [text, br-element, text] used to fabricate a blank line
    // ("a\n\nb"); hast-util-to-string semantics + explicit br yield "a\nb".
    expect(stripTags(html)).toContain('a\nb');
    expect(stripTags(html)).not.toContain('a\n\nb');
  });

  test('invalid json code fence renders the original text without crashing', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```json\n{"a": \n```'} />);
    expect(stripTags(html)).toContain('{&quot;a&quot;:');
  });

  test('truncated streaming json renders without crashing', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```json\n{"items": [{"id": 1}, {"id'} streaming />);
    expect(html.length).toBeGreaterThan(0);
    expect(stripTags(html)).toContain('{&quot;items&quot;:');
  });

  test('nested stringified json is expanded by the deep parse', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```json\n{"a":"{\\"b\\":1}"}\n```'} />);
    // Only the deep parse turns the escaped inner string into a real object
    // that pretty-prints as an indented `"b": 1` line.
    expect(stripTags(html)).toContain('&quot;b&quot;: 1');
  });

  test('extended config deep-merges down to the CodeHighlight expand state', () => {
    const collapsed = renderMarkdown(
      <MantineAIMarkdown
        content={'```typescript\nconst answer = 42;\n```'}
        config={{ codeBlock: { defaultExpanded: false } }}
      />
    );
    const expanded = renderMarkdown(<MantineAIMarkdown content={'```typescript\nconst answer = 42;\n```'} />);
    // The "Expand code" button is hidden (data-hidden) while expanded and
    // visible while collapsed — defaultExpanded flipping that state proves the
    // partial Mantine config survived core's deep merge and reached the
    // CodeHighlight component.
    const showCodeButton = (html: string) => html.match(/<button[^>]*showCodeButton[^>]*>/)?.[0] ?? '';
    expect(showCodeButton(expanded)).toContain('data-hidden="true"');
    expect(showCodeButton(collapsed)).not.toContain('data-hidden="true"');
    expect(showCodeButton(collapsed)).not.toBe('');
  });
});
