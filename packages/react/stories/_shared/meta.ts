import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown from '../../src/index';
import { coreArgTypes } from './argTypes';
import { renderThemed } from './ThemedAIMarkdown';

export type CoreMeta = Meta<typeof AIMarkdown>;
export type CoreStory = StoryObj<typeof AIMarkdown>;

/**
 * Everything a core meta shares. Spread it, then write `title` and `tags` as
 * literal properties — the CSF indexer parses the file instead of executing
 * it, so those two can never arrive through a spread:
 *
 * ```ts
 * const meta: CoreMeta = { ...baseCoreMeta, title: 'Core/Thing', tags: ['autodocs'] };
 * ```
 *
 * Annotate metas explicitly (`const meta: CoreMeta =`) rather than using
 * `satisfies`: this package builds with `declaration: true`, where `satisfies`
 * on an exported const trips TS2742.
 */
export const baseCoreMeta: Partial<CoreMeta> = {
  component: AIMarkdown,
  argTypes: coreArgTypes,
  render: renderThemed,
};
