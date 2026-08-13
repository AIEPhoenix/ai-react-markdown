import type { Decorator } from '@storybook/react-vite';

// react-scan is a render-visualisation overlay. It is a dev-only convenience,
// but it instruments React itself, so it must not load in two environments:
//
//   - vitest browser runs: the instrumentation costs time on every commit and
//     buys nothing, since nobody is looking at the overlay.
//   - the public documentation export: shipping React instrumentation to
//     visitors slows the site down AND skews the numbers they read off the
//     Performance Lab, which is the whole point of publishing it.
//
// Hence the dynamic `import()` below — a static import would keep the library
// in the graph no matter what the flag says.

// Vitest runs the preview under `mode: 'test'`; Storybook's own builds are
// 'development' / 'production'. `import.meta.env.VITEST` is checked first for
// the explicit signal, with MODE as the reliable fallback.
const isVitest = Boolean(import.meta.env.VITEST) || import.meta.env.MODE === 'test';
// Set STORYBOOK_DOCS_EXPORT=1 for the public export build (see .storybook/main.ts).
const isDocsExport = Boolean(import.meta.env.STORYBOOK_DOCS_EXPORT);

export const REACT_SCAN_ENABLED: boolean = !isVitest && !isDocsExport;

let modulePromise: Promise<typeof import('react-scan')> | null = null;
const loadReactScan = (): Promise<typeof import('react-scan')> => (modulePromise ??= import('react-scan'));

/**
 * Arm the renderer hook. `scan()` short-circuits inside an iframe (the
 * Storybook preview is one) and also bails when called with both
 * `enabled: false` and `showToolbar: false`; calling `start()` directly
 * bypasses both guards so the hook is installed regardless of toggle state.
 *
 * NOTE: outlines only render in Storybook's *standalone* iframe view
 * (http://localhost:6006/iframe.html?id=...). In the default canvas view the
 * nested manager→preview iframe layout breaks react-scan's overlay
 * positioning. See https://github.com/aidenybai/react-scan/issues/419 — open
 * as of 2025-12.
 */
export const armReactScan = (): void => {
  if (!REACT_SCAN_ENABLED) return;
  void loadReactScan().then(({ setOptions, start }) => {
    setOptions({ enabled: false, showToolbar: false, dangerouslyForceRunInProduction: true });
    start();
  });
};

let lastEnabled: boolean | null = null;

const setReactScanEnabled = (enabled: boolean): void => {
  if (!REACT_SCAN_ENABLED) return;
  if (enabled === lastEnabled) return;
  lastEnabled = enabled;
  void loadReactScan().then(({ setOptions }) => {
    setOptions({ enabled, showToolbar: enabled });
  });
};

export const withReactScan: Decorator = (Story, context) => {
  // No-ops under vitest and in the docs export — see REACT_SCAN_ENABLED above.
  setReactScanEnabled(context.globals.reactScan === 'on');
  return <Story />;
};
