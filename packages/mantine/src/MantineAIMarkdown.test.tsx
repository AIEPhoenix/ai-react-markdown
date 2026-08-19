import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MantineProvider, type MantineProviderProps } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from './MantineAIMarkdown';
import { useAIMarkdownTheme } from '@ai-react-markdown/core';

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

  test('json code fence is pretty-printed; nested JSON documents expand, primitive-looking strings do not', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```json\n{"a":{"b":1}}\n```'} />);
    // JSON.parse + JSON.stringify(..., null, 2) reformats the one-liner —
    // the indented `"b": 1` line only exists if pretty-printing ran.
    expect(stripTags(html)).toContain('&quot;b&quot;: 1');
    // A string holding a JSON OBJECT expands (tool-transcript shape)…
    const nested = renderMarkdown(<MantineAIMarkdown content={'```json\n{"tool_result":"{\\"hits\\":[1]}"}\n```'} />);
    expect(stripTags(nested)).toContain('&quot;hits&quot;: [');
    // …but `"true"` / `"123"` / `"null"` stay strings — no type rewrite of
    // what the model wrote (r2 P2-14).
    const prim = renderMarkdown(<MantineAIMarkdown content={'```json\n{"flag":"true","n":"123","z":"null"}\n```'} />);
    const text = stripTags(prim);
    expect(text).toContain('&quot;flag&quot;: &quot;true&quot;');
    expect(text).toContain('&quot;n&quot;: &quot;123&quot;');
    expect(text).toContain('&quot;z&quot;: &quot;null&quot;');
    // A `"__proto__"` key is an own property of the parsed object and must
    // survive the expansion (null-prototype target), not set the prototype.
    const proto = renderMarkdown(<MantineAIMarkdown content={'```json\n{"__proto__":{"x":1},"a":"[1]"}\n```'} />);
    expect(stripTags(proto)).toContain('&quot;__proto__&quot;: {');
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
      const { colorScheme } = useAIMarkdownTheme();
      return <em data-scheme={colorScheme} />;
    };
    const html = renderMarkdown(<MantineAIMarkdown content={'*probe*'} customComponents={{ em: SchemeProbe }} />, {
      forceColorScheme: 'dark',
    });
    expect(html).toContain('data-scheme="dark"');
  });

  test('explicit colorScheme prop wins over the computed scheme', () => {
    const SchemeProbe = () => {
      const { colorScheme } = useAIMarkdownTheme();
      return <em data-scheme={colorScheme} />;
    };
    const html = renderMarkdown(
      <MantineAIMarkdown content={'*probe*'} colorScheme="light" customComponents={{ em: SchemeProbe }} />,
      { forceColorScheme: 'dark' }
    );
    expect(html).toContain('data-scheme="light"');
  });

  test('mermaid code fence exposes keyboard-accessible controls under SSR', () => {
    const html = renderMarkdown(<MantineAIMarkdown content={'```mermaid\ngraph TD;\nA-->B;\n```'} />);
    expect(html).toContain('aria-label="Show Mermaid code"');
    expect(html).toContain('aria-label="Copy Mermaid code"');
    // The open action is a real header button; the SVG container is an
    // image with a description (its content stays reachable to assistive
    // tech — r2 P3), not a `role="button"` wrapping the diagram.
    expect(html).toContain('aria-label="Open Mermaid diagram in a new window"');
    // No role on the container at all: `role="img"` / `role="button"` would
    // make the SVG's own accessible name and structure presentational.
    expect(html).not.toMatch(/<pre[^>]+role="/);
  });
});
