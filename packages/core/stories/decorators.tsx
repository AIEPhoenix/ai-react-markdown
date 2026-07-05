import React from 'react';
import type { Decorator } from '@storybook/react-vite';
import { useGlobals } from 'storybook/preview-api';
import { ColorSchemeContext } from './_shared/colorScheme';

export const withThemedBackground: Decorator = (Story) => {
  // `useGlobals` is a STORYBOOK preview hook — it must be called directly in the
  // decorator (not a nested React component, which throws "preview hooks can only
  // be called inside decorators and story functions"). The eslint rule below is a
  // false positive: it sees a Storybook hook as a React hook in a non-component.
  // Subscribing here re-renders the decorator on a live theme toggle — in Canvas
  // AND in autodocs Docs pages, where a story's own render reading
  // `context.globals` would stay frozen. The scheme is published through context
  // so every nested component picks it up with `useColorScheme`.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [globals] = useGlobals();
  const theme = globals.theme === 'dark' ? 'dark' : 'light';
  document.body.style.backgroundColor = theme === 'dark' ? 'rgb(36, 36, 36)' : '';
  return (
    <ColorSchemeContext.Provider value={theme}>
      <Story />
    </ColorSchemeContext.Provider>
  );
};
