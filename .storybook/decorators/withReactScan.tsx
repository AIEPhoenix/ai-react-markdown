import type { Decorator } from '@storybook/react-vite';
import { setOptions } from 'react-scan';

let lastEnabled: boolean | null = null;

const sync = (enabled: boolean) => {
  if (enabled === lastEnabled) return;
  setOptions({ enabled, showToolbar: enabled });
  lastEnabled = enabled;
};

export const withReactScan: Decorator = (Story, context) => {
  sync(context.globals.reactScan === 'on');
  return <Story />;
};
