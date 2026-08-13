import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

import { playwright } from '@vitest/browser-playwright';

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
          benchmark: {
            include: ['packages/*/src/**/*.bench.{ts,tsx}'],
          },
        },
      },
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
            // The benchmark harnesses stream on mount in dev and in the static
            // build (they are the Performance Lab). Under test nobody watches
            // them, so they render their idle UI instead of burning rAF and
            // long-task budget for the whole run. The stories still mount and
            // still assert — only the auto-start is off.
            initialGlobals: { autoStart: 'off' },
          }),
        ],
        test: {
          name: 'storybook',
          // Streaming smokes legitimately wait through multi-second windows
          // (e.g. the streaming cursor's 5 s stall threshold plus recovery).
          // The browser-mode default of 15 s would kill those runs with an
          // opaque runner timeout instead of the failing waitFor's message.
          // 45 s leaves margin over the longest in-story wait — the 30 s
          // `waitFor` in streaming/IncrementalParse.stories.tsx — so that a
          // slow machine reports the failing assertion rather than a bare
          // runner timeout.
          testTimeout: 45_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
          // Don't run benchmarks in the browser project — they're CPU-bound
          // and run under node in the `unit` project.
          benchmark: {
            include: [],
          },
        },
      },
    ],
  },
});
