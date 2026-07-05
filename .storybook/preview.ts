import type { Preview } from '@storybook/react-vite';
import { getUserPreferredColorTheme } from './utils/sb-theme';
import { ThemedDocsContainer } from './ThemedDocsContainer';

const preview: Preview = {
  parameters: {
    options: {
      // Curate the sidebar: Introduction first, then the two packages (Core,
      // Mantine) as top-level branches, each ordered capability-first via the
      // nested arrays. Anything not listed falls through to the end, A→Z.
      storySort: {
        order: [
          'Introduction',
          'Core',
          ['AIMarkdown', 'Features', 'Theming', 'Configuration', 'Extending', 'Robustness', 'Coordination'],
          'Mantine',
          ['MantineAIMarkdown', 'Features', 'Configuration'],
        ],
      },
    },
    docs: {
      // Theme the Docs page chrome (MDX / autodocs) to follow the toolbar Theme
      // switch — `addon-docs`'s static `docs.theme` otherwise keeps it light.
      container: ThemedDocsContainer,
    },

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
  },
  initialGlobals: {
    theme: getUserPreferredColorTheme(),
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
  },
};

export default preview;
