// @vitest-environment jsdom
//
// Client-side (react-dom/client) counterpart of the SSR smoke tests in
// MantineAIMarkdown.test.tsx. These cases need effects: Mantine's
// CodeHighlight asks the nearest CodeHighlightAdapterProvider to load a
// language grammar from a `useEffect`, and highlights again once the
// provider reports the language loaded. renderToString runs neither, so an
// adapter that loads grammars on demand (the `createShikiAdapter` shape:
// `loadContext` + `loadLanguage`) can only be exercised in a DOM
// environment. jsdom resolves through vitest's optional peer, which the
// workspace already installs.
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { createHighlightJsAdapter, type CodeHighlightAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../MantineAIMarkdown';
import { createMountHarness, flushEffects, installMantineDomStubs } from './domTestHarness';

const harness = createMountHarness();
beforeAll(installMantineDomStubs);
afterEach(harness.cleanup);

/**
 * A recording stand-in for a grammar-on-demand adapter. It highlights only
 * once `loadLanguage` has been asked for the language, so a highlighted
 * output proves the provider both requested the grammar and re-ran the
 * highlighter after the promise resolved.
 */
function createRecordingAdapter() {
  const loadLanguageCalls: string[] = [];
  const loaded = new Set<string>();
  const ctx = { name: 'recording-ctx' };
  const adapter: CodeHighlightAdapter = {
    loadContext: () => Promise.resolve(ctx),
    loadLanguage: (_ctx, language) => {
      loadLanguageCalls.push(language);
      loaded.add(language);
      return Promise.resolve();
    },
    getHighlighter: (highlighterCtx) => {
      if (!highlighterCtx) return ({ code }) => ({ highlightedCode: code, isHighlighted: false });
      return ({ code, language }) => {
        if (!language || !loaded.has(language)) return { highlightedCode: code, isHighlighted: false };
        return {
          highlightedCode: `<span class="recording-hl" data-lang="${language}">${code}</span>`,
          isHighlighted: true,
        };
      };
    },
  };
  return { adapter, loadLanguageCalls };
}

describe('code fences and grammar-on-demand adapters (client render)', () => {
  test('a ```ts fence asks the consumer adapter to load "ts" and is highlighted once it resolves', async () => {
    const { adapter, loadLanguageCalls } = createRecordingAdapter();
    const container = await harness.mount(<MantineAIMarkdown content={'```ts\nconst answer = 42;\n```'} />, adapter);
    // One flush for loadContext to resolve, one for loadLanguage.
    await flushEffects();
    await flushEffects();
    expect(loadLanguageCalls).toContain('ts');
    const highlighted = container.querySelector('.recording-hl');
    expect(highlighted, 'the code element should carry the adapter markup').not.toBeNull();
    expect(highlighted?.getAttribute('data-lang')).toBe('ts');
    expect(highlighted?.textContent).toContain('const answer = 42;');
  });

  test('the synchronous highlight.js adapter still highlights on the client', async () => {
    const container = await harness.mount(
      <MantineAIMarkdown content={'```typescript\nconst answer = 42;\n```'} />,
      createHighlightJsAdapter(hljs)
    );
    await flushEffects();
    const code = container.querySelector('code.hljs');
    expect(code).not.toBeNull();
    expect(code?.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(code?.textContent).toContain('const answer = 42;');
  });
});
