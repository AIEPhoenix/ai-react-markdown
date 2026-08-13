import React, { type ReactNode } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { MantineProvider } from '@mantine/core';
import { CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight';
import hljs from 'highlight.js';
import { useStoryColorScheme } from '../../core/stories/_shared/colorScheme';
import { storyTheme } from './_shared/theme';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import './globals.scss';

const highlightJsAdapter = createHighlightJsAdapter(hljs);

/**
 * Inner component so the context read is an ordinary React hook call. This
 * renders inside `withColorScheme`, which is a global decorator and therefore
 * always wraps outside component-level decorators like this one.
 */
const MantineScope = ({ children }: { children: ReactNode }) => {
  const colorScheme = useStoryColorScheme();
  return (
    <MantineProvider theme={storyTheme} forceColorScheme={colorScheme}>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>{children}</CodeHighlightAdapterProvider>
    </MantineProvider>
  );
};

export const withMantineProvider: Decorator = (Story) => (
  <MantineScope>
    <Story />
  </MantineScope>
);
