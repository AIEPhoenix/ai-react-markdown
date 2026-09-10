import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../../src/index';
import { reactArgTypes } from '@ai-markdown/storybook-kit/react/argTypes';
import { renderThemed } from './ThemedAIMarkdown';

export type ReactMeta = Meta<typeof AIMarkdown>;
export type ReactStory = StoryObj<typeof AIMarkdown>;

/**
 * Everything a core meta shares. Spread it, then write `title` and `tags` as
 * literal properties — the CSF indexer parses the file instead of executing
 * it, so those two can never arrive through a spread:
 *
 * ```ts
 * const meta: ReactMeta = { ...baseReactMeta, title: 'Thing', tags: ['autodocs'] };
 * ```
 *
 * Annotate metas explicitly (`const meta: ReactMeta =`) rather than using
 * `satisfies`: this package builds with `declaration: true`, where `satisfies`
 * on an exported const trips TS2742.
 */
export const baseReactMeta: Partial<ReactMeta> = {
  component: AIMarkdown,
  argTypes: reactArgTypes,
  render: renderThemed,
};
