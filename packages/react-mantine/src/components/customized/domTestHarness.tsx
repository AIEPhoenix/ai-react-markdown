// Shared harness for the package's client-side (react-dom/client under
// jsdom) tests. Test files stay `// @vitest-environment jsdom`; this module
// only provides the stubs Mantine needs to mount and a mount/cleanup pair
// that keeps every render inside `act`.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, type CodeHighlightAdapter } from '@mantine/code-highlight';

/** jsdom ships neither matchMedia (Mantine's color-scheme manager) nor
 *  ResizeObserver (Mantine's ScrollArea, used by CodeHighlight). */
export function installMantineDomStubs() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= (query: string) =>
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
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/** Let pending microtasks (resolved adapter promises, state updates) reach React. */
export const flushEffects = () => act(async () => {});

export function createMountHarness() {
  const roots: { root: Root; container: HTMLElement }[] = [];
  return {
    /** Mount `ui` under MantineProvider + CodeHighlightAdapterProvider, the README consumer setup. */
    async mount(ui: ReactNode, adapter: CodeHighlightAdapter): Promise<HTMLElement> {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      roots.push({ root, container });
      await act(async () => {
        root.render(
          <MantineProvider>
            <CodeHighlightAdapterProvider adapter={adapter}>{ui}</CodeHighlightAdapterProvider>
          </MantineProvider>
        );
      });
      return container;
    },
    async cleanup() {
      for (const { root, container } of roots.splice(0)) {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  };
}

/** Dispatch a real click on the element with the given accessible name. */
export async function clickByLabel(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!button) throw new Error(`no element with aria-label="${label}"`);
  await act(async () => {
    button.click();
  });
  return button;
}
