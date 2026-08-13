import React from 'react';
import type { Meta } from '@storybook/react-vite';
import AIMarkdown from '../../src/index';
import { useStoryColorScheme } from './colorScheme';

type AIMarkdownStoryProps = React.ComponentProps<typeof AIMarkdown>;

/**
 * `<AIMarkdown>` with the toolbar's color scheme already wired in. Stories
 * should never pass `colorScheme` themselves — the toolbar owns it, and a
 * hardcoded value silently ignores the theme switch.
 */
export const ThemedAIMarkdown = (props: AIMarkdownStoryProps) => {
  const colorScheme = useStoryColorScheme();
  return <AIMarkdown {...props} colorScheme={colorScheme} />;
};

/**
 * The default `render` for core metas (see `baseCoreMeta`). A story only needs
 * its own `render` when it wraps `<AIMarkdown>` in something else — streaming
 * replay, a comparison layout, a benchmark harness.
 */
export const renderThemed: NonNullable<Meta<typeof AIMarkdown>['render']> = (args) => <ThemedAIMarkdown {...args} />;
