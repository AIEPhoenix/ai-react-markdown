import type { Preview } from '@storybook/react-vite';
import { setOptions, start } from 'react-scan';
import { getUserPreferredColorTheme } from './utils/sb-theme';
import { withReactScan } from './decorators/withReactScan';

// `scan()` short-circuits when running inside an iframe (Storybook preview is one)
// and also bails when called with both `enabled: false` and `showToolbar: false`.
// Calling `start()` directly bypasses both guards so the renderer hook is armed
// from the very first commit, regardless of toggle state.
//
// NOTE: outlines only render in Storybook's *standalone* iframe view
// (http://localhost:6006/iframe.html?id=...). In the default canvas view the
// nested manager→preview iframe layout breaks react-scan's overlay positioning.
// See https://github.com/aidenybai/react-scan/issues/419 — open as of 2025-12.
setOptions({ enabled: false, showToolbar: false, dangerouslyForceRunInProduction: true });
start();

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
  },
  initialGlobals: {
    theme: getUserPreferredColorTheme(),
    reactScan: 'off',
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
  decorators: [withReactScan],
};

export default preview;
