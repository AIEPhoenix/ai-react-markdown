import type { Preview } from '@storybook/vue3-vite';
import { h } from 'vue';
// Storybook's docs UI uses React even when the component renderer is Vue.
import { AimDocsContainer } from '@ai-markdown/storybook-kit/react/AimDocsContainer';
import { getUserPreferredColorTheme } from '@ai-markdown/storybook-kit/common/sb-theme';
import '@ai-markdown/vue/styles.css';
import 'katex/dist/katex.min.css';
const preview: Preview = {
  parameters: {
    docs: { container: AimDocsContainer },
    a11y: { test: 'todo' },
    options: {
      storySort: {
        // Storybook statically parses this array. Keep both renderer orders aligned.
        order: [
          'Introduction',
          'Playground',
          'Basics',
          ['Markdown Basics', 'Math', 'CJK & International Text', 'Footnotes & Definition Lists', 'Engine Plugins'],
          'Customization',
          [
            'Custom Components',
            'Metadata',
            'URL Sanitization',
            'Content Preprocessors',
            'Orphan References',
            'Theming',
            'Extending',
          ],
          'Streaming',
          [
            'Streaming Basics',
            'Incremental Parsing',
            'Smooth Streaming',
            'Streaming Cursor',
            'Turn Taking',
            'Error Recovery',
          ],
          'Documents',
          ['Cross-Chunk Coordination', 'Definition Lifecycle'],
          'Integrations',
          ['Mantine'],
          'Performance Lab',
          ['About', '*'],
          'QA',
        ],
      },
    },
  },
  initialGlobals: { theme: getUserPreferredColorTheme(), autoStart: 'off' },
  globalTypes: {
    theme: {
      description: 'Preview color scheme',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  decorators: [
    (story, context) => ({
      setup() {
        return () =>
          h(
            'div',
            {
              style: {
                colorScheme: context.globals.theme,
                background: context.globals.theme === 'dark' ? '#17191c' : '#fff',
                color: context.globals.theme === 'dark' ? '#eee' : '#202124',
                padding: '24px',
                minHeight: '100vh',
              },
            },
            [h(story())]
          );
      },
    }),
  ],
};
export default preview;
