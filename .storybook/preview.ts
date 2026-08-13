import type { Preview } from '@storybook/react-vite';
import { getUserPreferredColorTheme } from './utils/sb-theme';
// The React-dependent story infrastructure lives under packages/core/stories/_shared.
// It cannot live in this directory: pnpm's strict node_modules layout puts `react`
// only in packages/*/node_modules, so a `.tsx` file here fails to resolve both
// `react` and the JSX runtime under the dev server and vitest. This file stays a
// plain `.ts` registration layer.
import { armReactScan, withReactScan } from '../packages/core/stories/_shared/reactScan';
import { withColorScheme } from '../packages/core/stories/_shared/withColorScheme';
import { AimDocsContainer } from '../packages/core/stories/_shared/AimDocsContainer';

armReactScan();

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },

    docs: {
      container: AimDocsContainer,
    },

    // The sidebar is the reading order: evaluate (Introduction, Playground),
    // integrate (the feature branches), then dig (Performance Lab, QA).
    // Anything not named here sorts after the named entries, alphabetically.
    options: {
      storySort: {
        order: [
          'Introduction',
          'Core',
          [
            'Playground',
            'Features',
            'Theming',
            'Configuration',
            'Streaming',
            'Documents',
            'Extending',
            'Performance Lab',
            // The methodology page reads before the instruments it explains.
            ['About', '*'],
            'QA',
          ],
          'Mantine',
          ['Overview', 'Playground', 'Code Blocks', 'Mermaid Diagrams', 'Color Scheme', 'Kitchen Sink'],
        ],
      },
    },
  },
  initialGlobals: {
    theme: getUserPreferredColorTheme(),
    reactScan: 'off',
    // Benchmark harnesses stream on mount here, but stay idle under vitest —
    // see the `initialGlobals` override in vitest.config.ts.
    autoStart: 'on',
  },
  globalTypes: {
    theme: {
      description: 'Global theme for components',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
    reactScan: {
      description: 'Toggle react-scan render visualisation (outlines render only in standalone iframe view)',
      toolbar: {
        title: 'React Scan',
        icon: 'lightning',
        items: [
          { value: 'off', icon: 'eyeclose', title: 'Off' },
          { value: 'on', icon: 'eye', title: 'On (use Open Canvas in New Tab)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  // withColorScheme sits last so it wraps outermost: the Mantine provider is a
  // component-level decorator, and it reads the color scheme through this
  // decorator's React context.
  decorators: [withReactScan, withColorScheme],
};

export default preview;
