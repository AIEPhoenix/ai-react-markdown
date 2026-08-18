import { describe, expect, test } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../MantineAIMarkdown';
import { jsonLooksComplete } from './PreCode';

const adapter = createHighlightJsAdapter(hljs);
const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');
const render = (ui: ReactNode) =>
  renderToString(
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );

describe('jsonLooksComplete (v2.4.1 review: the pretty-print gate)', () => {
  test('balanced values pass', () => {
    expect(jsonLooksComplete('{"a":{"b":1}}')).toBe(true);
    expect(jsonLooksComplete('[1, [2, 3]]\n')).toBe(true);
    expect(jsonLooksComplete('{\n  "a": {\n    "b": 1\n  }\n}')).toBe(true);
  });
  test('an in-progress pretty-printed prefix ending on a closing bracket does not pass', () => {
    expect(jsonLooksComplete('{\n  "a": {\n    "b": 1\n  }')).toBe(false);
    expect(jsonLooksComplete('{\n  "items": [\n    {"x": 1}')).toBe(false);
  });
  test('brackets inside strings are ignored; unterminated strings fail', () => {
    expect(jsonLooksComplete('{"a": "}"}')).toBe(true);
    expect(jsonLooksComplete('{"a": "\\"}"}')).toBe(true);
    expect(jsonLooksComplete('{"a": "}')).toBe(false);
  });
  test('shapes without a closing bracket at the end never pass', () => {
    expect(jsonLooksComplete('{"a": 1')).toBe(false);
    expect(jsonLooksComplete('42')).toBe(false);
    expect(jsonLooksComplete('')).toBe(false);
  });
});

describe('json pretty-print while streaming', () => {
  test('a complete json block is pretty-printed mid-stream; an unbalanced prefix is left verbatim', () => {
    const done = render(<MantineAIMarkdown content={'```json\n{"a":{"b":1}}\n```'} streaming />);
    expect(stripTags(done)).toContain('&quot;b&quot;: 1');
    const partial = render(<MantineAIMarkdown content={'```json\n{"a":{"b":1}\n```'} streaming />);
    expect(stripTags(partial)).toContain('{&quot;a&quot;:{&quot;b&quot;:1}');
    expect(stripTags(partial)).not.toContain('&quot;b&quot;: 1');
  });
});
