// @vitest-environment jsdom
//
// The mermaid block's header actions must carry their own inline SVG icons.
// An earlier version used Tailwind/iconify utility classes
// (`icon-[entypo--code]`, ...) that nothing in this package defines, so
// consumers saw empty buttons. mermaid itself is mocked: jsdom cannot lay
// out SVG text, and the header is what is under test, not the diagram.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import MantineAIMarkdown from '../../../MantineAIMarkdown';
import { clickByLabel, createMountHarness, flushEffects, installMantineDomStubs } from '../domTestHarness';

vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    parse: () => Promise.resolve(true),
    render: () => Promise.resolve({ svg: '<svg data-mock-diagram="1"></svg>', diagramType: 'flowchart' }),
    mermaidAPI: { getConfig: () => ({ securityLevel: 'strict' }) },
  },
}));

const harness = createMountHarness();
const adapter = createHighlightJsAdapter(hljs);
beforeAll(() => {
  installMantineDomStubs();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });
});
afterEach(harness.cleanup);

const MERMAID_FENCE = '```mermaid\ngraph TD;\nA-->B;\n```';

/** Every header action, by accessible name, must render a real `<svg>` icon. */
const expectSvgIcon = (container: HTMLElement, label: string) => {
  const button = container.querySelector(`[aria-label="${label}"]`);
  expect(button, `button "${label}" should render`).not.toBeNull();
  expect(button?.querySelector('svg'), `button "${label}" should contain an inline svg icon`).not.toBeNull();
};

/** No leftover iconify/Tailwind utility classes anywhere in the tree. */
const expectNoIconClasses = (container: HTMLElement) => {
  for (const el of container.querySelectorAll('[class]')) {
    expect(el.className.toString()).not.toMatch(/icon-(origin-)?\[/);
  }
};

describe('mermaid block header icons (client render)', () => {
  test('diagram header actions render inline svg icons and no icon-[...] utility classes', async () => {
    const container = await harness.mount(<MantineAIMarkdown content={MERMAID_FENCE} />, adapter);
    await flushEffects();
    await flushEffects();
    expect(container.querySelector('[data-mock-diagram]'), 'mocked diagram should be mounted').not.toBeNull();
    expectSvgIcon(container, 'Open Mermaid diagram in a new window');
    expectSvgIcon(container, 'Show Mermaid code');
    expectSvgIcon(container, 'Copy Mermaid code');
    expectNoIconClasses(container);
  });

  test('the copied state and the "Render Mermaid" way back from the source view use svg icons too', async () => {
    const container = await harness.mount(<MantineAIMarkdown content={MERMAID_FENCE} />, adapter);
    await flushEffects();
    await flushEffects();
    await clickByLabel(container, 'Copy Mermaid code');
    await flushEffects();
    expectSvgIcon(container, 'Mermaid code copied');
    expectNoIconClasses(container);

    await clickByLabel(container, 'Show Mermaid code');
    expectSvgIcon(container, 'Render Mermaid diagram');
    expectNoIconClasses(container);
    // The way back restores the diagram view.
    await clickByLabel(container, 'Render Mermaid diagram');
    await flushEffects();
    expect(container.querySelector('[aria-label="Render Mermaid diagram"]')).toBeNull();
    expect(container.querySelector('[data-mock-diagram]')).not.toBeNull();
  });
});
