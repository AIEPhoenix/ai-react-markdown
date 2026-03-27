import React from 'react';
import type { Decorator } from '@storybook/react-vite';
import { MantineProvider, createTheme } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import './globals.css';

const theme = createTheme({});
const highlightJsAdapter = createHighlightJsAdapter(hljs);

export const withMantineProvider: Decorator = (Story, context) => {
  const colorScheme = context.globals.theme === 'dark' ? 'dark' : 'light';
  return (
    <MantineProvider theme={theme} forceColorScheme={colorScheme}>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <Story />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  );
};
