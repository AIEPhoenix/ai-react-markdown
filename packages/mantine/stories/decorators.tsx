import React from 'react';
import type { Decorator } from '@storybook/react-vite';
import { useGlobals } from 'storybook/preview-api';
import { MantineProvider, createTheme } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import './globals.scss';

const theme = createTheme({});
const highlightJsAdapter = createHighlightJsAdapter(hljs);

export const withMantineProvider: Decorator = (Story) => {
  // `useGlobals` is a STORYBOOK preview hook — it must be called directly in the
  // decorator, not a nested component. Subscribing here re-renders on a live theme
  // toggle (so `forceColorScheme` updates) — including inside autodocs Docs pages,
  // where `context.globals` would otherwise stay frozen. The eslint rule below is a
  // false positive (Storybook hook seen as a React hook in a non-component).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [globals] = useGlobals();
  const colorScheme = globals.theme === 'dark' ? 'dark' : 'light';
  return (
    <MantineProvider theme={theme} forceColorScheme={colorScheme}>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <Story />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
};
