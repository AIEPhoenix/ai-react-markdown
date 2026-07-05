// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from './MantineAIMarkdown';

// Mock the mermaid module so lifecycle tests can script success/failure per
// render attempt without pulling the real (heavy, DOM-mutating) renderer in.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(),
    render: vi.fn(),
  },
}));
import mermaid from 'mermaid';

const mockedParse = vi.mocked(mermaid.parse);
const mockedRender = vi.mocked(mermaid.render);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements neither matchMedia (Mantine color-scheme detection) nor
// ResizeObserver (Mantine ScrollArea) — provide inert stubs.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// The error-state CodeHighlightTabs highlights with language 'mermaid', which
// the stock hljs build doesn't know — register a no-op grammar so the adapter
// doesn't throw "Unknown language".
if (!hljs.getLanguage('mermaid')) {
  hljs.registerLanguage('mermaid', () => ({ contains: [] }));
}

const adapter = createHighlightJsAdapter(hljs);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

/** Client-side render harness mirroring the README consumer setup. */
async function renderMarkdown(ui: ReactNode) {
  await act(async () => {
    root.render(
      <MantineProvider>
        <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
      </MantineProvider>
    );
  });
  // Second flush: the mermaid effect awaits parse/render promises whose
  // continuations land after the first act pass.
  await act(async () => {});
}

const MERMAID_FENCE_A = '```mermaid\ngraph TD;\nA-->B;\n```';
const MERMAID_FENCE_B = '```mermaid\ngraph TD;\nA-->B;\nB-->C;\n```';

/**
 * Script one successful mermaid render pass returning the given svg markup.
 * Mirrors real mermaid 11 geometry: render() clears the host container
 * (`innerHTML = ''`) before drawing into it.
 */
function mockMermaidSuccess(svg: string) {
  mockedParse.mockResolvedValue({ diagramType: 'flowchart-v2', config: {} });
  mockedRender.mockImplementation(async (_id: string, _code: string, hostElement?: Element) => {
    if (hostElement) hostElement.innerHTML = '';
    return { svg, diagramType: 'flowchart-v2' } as Awaited<ReturnType<typeof mermaid.render>>;
  });
}

/**
 * Script a mermaid draw-stage failure with real mermaid 11 geometry: render()
 * clears the host container FIRST (`innerHTML = ''`), and in the worst case
 * (a throw point outside mermaid's cleanup wrappers) strands a temp `#d{id}`
 * element in the container.
 */
function mockMermaidRenderFailure() {
  mockedParse.mockResolvedValue({ diagramType: 'flowchart-v2', config: {} });
  mockedRender.mockImplementation(async (id: string, _code: string, hostElement?: Element) => {
    if (hostElement) hostElement.innerHTML = '';
    const temp = document.createElement('div');
    temp.id = `d${id}`;
    hostElement?.appendChild(temp);
    throw new Error('mermaid render failed');
  });
}

describe('MermaidCode lifecycle (client)', () => {
  test('successful render injects the svg and shows the chart type', async () => {
    mockMermaidSuccess('<svg data-diagram="a"></svg>');
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_A} />);

    expect(container.querySelector('svg[data-diagram="a"]')).not.toBeNull();
    expect(container.querySelector('.chart-type-tag')?.textContent).toBe('flowchart-v2');
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ suppressErrorRendering: true }));
  });

  test('first-render failure shows the error state', async () => {
    mockedParse.mockRejectedValue(new Error('parse failed'));
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_A} />);

    expect(container.textContent).toContain('Mermaid Render Error');
    expect(container.querySelector('svg[data-diagram]')).toBeNull();
  });

  test('success-then-PARSE-failure keeps the previous diagram silently (streaming semantics)', async () => {
    mockMermaidSuccess('<svg data-diagram="a"></svg>');
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_A} />);
    expect(container.querySelector('svg[data-diagram="a"]')).not.toBeNull();

    // Parse failure = streaming-incomplete code: mermaid.render is never
    // called, the host is untouched — keep the last good diagram, no error.
    mockedParse.mockRejectedValue(new Error('parse failed'));
    mockedRender.mockClear();
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_B} />);

    expect(mockedRender).not.toHaveBeenCalled();
    expect(container.querySelector('svg[data-diagram="a"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Mermaid Render Error');
  });

  test('success-then-DRAW-failure shows the error view for the CURRENT code, not a stale diagram', async () => {
    mockMermaidSuccess('<svg data-diagram="a"></svg>');
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_A} />);
    expect(container.querySelector('svg[data-diagram="a"]')).not.toBeNull();

    // Draw failure = parse passed but render rejected the CURRENT code
    // (often deterministic, e.g. an unregistered layout in an init
    // directive). Showing diagram A for content B would be silently wrong
    // content — the error view with B's source must appear instead.
    mockMermaidRenderFailure();
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_B} />);

    expect(container.textContent).toContain('Mermaid Render Error');
    // The diagram panel is hidden in the error state.
    expect(container.querySelector('.aim-mantine-mermaid-code')?.getAttribute('style')).toContain('display: none');
  });

  test('draw-failure error state recovers on the next successful render, with no temp leftovers', async () => {
    mockMermaidSuccess('<svg data-diagram="a"></svg>');
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_A} />);

    mockMermaidRenderFailure();
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_B} />);
    // Assert the sweep BEFORE the recovery render — the next successful
    // mermaid.render clears the host anyway, which would make a post-recovery
    // assertion vacuous.
    expect(container.querySelectorAll('[id^="dmermaid-"]')).toHaveLength(0);

    mockMermaidSuccess('<svg data-diagram="a"></svg>');
    await renderMarkdown(<MantineAIMarkdown content={MERMAID_FENCE_A} />);

    expect(mockedRender).toHaveBeenCalled();
    expect(container.querySelectorAll('[id^="dmermaid-"]')).toHaveLength(0);
    expect(container.querySelector('svg[data-diagram="a"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Mermaid Render Error');
  });
});

describe('PreCode language matrix (client)', () => {
  test('unregistered language falls back to plaintext but keeps it as the file name', async () => {
    await renderMarkdown(<MantineAIMarkdown content={'```foobar\nsome code here\n```'} />);

    // CodeHighlightTabs shows the unknown identifier as the tab label...
    expect(container.textContent).toContain('foobar');
    expect(container.textContent).toContain('some code here');
    // ...but highlights as plaintext (no hljs token spans inside the code).
    expect(container.querySelector('code .hljs-keyword')).toBeNull();
  });

  test('autoDetectUnknownLanguage consults hljs.highlightAuto and uses its result', async () => {
    const highlightAutoSpy = vi
      .spyOn(hljs, 'highlightAuto')
      .mockReturnValue({ language: 'python' } as ReturnType<typeof hljs.highlightAuto>);

    await renderMarkdown(
      <MantineAIMarkdown content={'```\nimport os\n```'} config={{ codeBlock: { autoDetectUnknownLanguage: true } }} />
    );

    expect(highlightAutoSpy).toHaveBeenCalledWith('import os\n');
    expect(container.textContent).toContain('python');
    highlightAutoSpy.mockRestore();
  });

  test('auto-detection stays off by default', async () => {
    const highlightAutoSpy = vi.spyOn(hljs, 'highlightAuto');

    await renderMarkdown(<MantineAIMarkdown content={'```\nimport os\n```'} />);

    expect(highlightAutoSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('import os');
    highlightAutoSpy.mockRestore();
  });
});
