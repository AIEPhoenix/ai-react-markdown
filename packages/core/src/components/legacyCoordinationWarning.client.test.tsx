// @vitest-environment jsdom

// Client-side (effects run) coverage for the dev-only warning emitted when
// `blockMemoEnabled: false` renders with real coordination intent — inside
// `<AIMarkdownDocuments>` with an explicit documentId. The gate must NOT fire
// for standalone legacy usage: `state.documentId` is always filled with a
// `useId()` fallback, so a naive `documentId !== undefined` check would warn
// for every legacy user (regression this file locks out).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import AIMarkdown from '../index';
import { AIMarkdownDocuments } from './AIMarkdownDocuments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  warnSpy.mockRestore();
});

async function renderClient(ui: ReactNode) {
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {});
}

const coordinationWarnings = () =>
  warnSpy.mock.calls.filter(
    (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('cross-chunk coordination')
  );

describe('legacy-path coordination warning (client)', () => {
  test('fires once for blockMemoEnabled:false inside <AIMarkdownDocuments> with explicit documentId', async () => {
    await renderClient(
      <AIMarkdownDocuments>
        <AIMarkdown content="hello" documentId="doc-1" config={{ blockMemoEnabled: false }} />
      </AIMarkdownDocuments>
    );
    // Re-render the same tree (streaming-style) — still one warning.
    await renderClient(
      <AIMarkdownDocuments>
        <AIMarkdown content="hello world" documentId="doc-1" config={{ blockMemoEnabled: false }} />
      </AIMarkdownDocuments>
    );
    expect(coordinationWarnings()).toHaveLength(1);
  });

  test('does NOT fire for standalone blockMemoEnabled:false (no wrapper, no documentId)', async () => {
    await renderClient(<AIMarkdown content="hello" config={{ blockMemoEnabled: false }} />);
    expect(coordinationWarnings()).toHaveLength(0);
  });

  test('does NOT fire inside the wrapper without an explicit documentId', async () => {
    await renderClient(
      <AIMarkdownDocuments>
        <AIMarkdown content="hello" config={{ blockMemoEnabled: false }} />
      </AIMarkdownDocuments>
    );
    expect(coordinationWarnings()).toHaveLength(0);
  });

  test('does NOT fire when blockMemoEnabled stays default (coordinated path)', async () => {
    await renderClient(
      <AIMarkdownDocuments>
        <AIMarkdown content="hello" documentId="doc-1" />
      </AIMarkdownDocuments>
    );
    expect(coordinationWarnings()).toHaveLength(0);
  });
});
