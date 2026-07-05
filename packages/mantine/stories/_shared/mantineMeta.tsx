import type { Meta, StoryObj } from '@storybook/react-vite';
import MantineAIMarkdown from '../../src/index';

// KaTeX glyphs for math stories. Mantine core + code-highlight + highlight.js
// theme CSS are imported by the `withMantineProvider` decorator.
import 'katex/dist/katex.min.css';

import { withMantineProvider } from '../decorators';

export type MantineMeta = Meta<typeof MantineAIMarkdown>;
export type MantineStory = StoryObj<typeof MantineAIMarkdown>;

/**
 * Shared Controls config. `colorScheme` is hidden because the Mantine build
 * resolves it from `MantineProvider` (the toolbar Theme switch drives
 * `forceColorScheme` in the decorator); function-typed props are hidden too.
 */
export const mantineArgTypes: MantineMeta['argTypes'] = {
  content: { control: 'text', description: 'Raw markdown content to render.' },
  streaming: { control: 'boolean', description: 'Whether content is actively being streamed.' },
  fontSize: { control: 'text', description: 'Base font size (e.g. `"0.9375rem"`, `"14px"`, or a number for px).' },
  config: {
    control: 'object',
    description:
      'Partial render config, deep-merged with defaults. Adds Mantine-only ' +
      '`codeBlock.defaultExpanded` and `codeBlock.autoDetectUnknownLanguage` on top of the ' +
      'core `extraSyntaxSupported` / `displayOptimizeAbilities`.',
  },
  metadata: { control: 'object', description: 'Arbitrary data passed to custom components via context.' },
  colorScheme: { table: { disable: true } },
  contentPreprocessors: { table: { disable: true } },
  customComponents: { table: { disable: true } },
  Typography: { table: { disable: true } },
  ExtraStyles: { table: { disable: true } },
  defaultConfig: { table: { disable: true } },
  sanitizeSchema: { table: { disable: true } },
  urlTransform: { table: { disable: true } },
};

/**
 * Shared meta fields for the Mantine showcase groups. Spread into each file's
 * default export, then add the (statically required) `title` and `tags`
 * literals — the CSF indexer can't read them through a spread or factory.
 *
 * ```ts
 * const meta: MantineMeta = {
 *   ...mantineMetaBase,
 *   tags: ['autodocs'],
 *   title: 'Mantine/Features/Code Highlighting',
 * };
 * ```
 */
export const mantineMetaBase: Partial<MantineMeta> = {
  component: MantineAIMarkdown,
  decorators: [withMantineProvider],
  argTypes: mantineArgTypes,
  render: (args) => <MantineAIMarkdown {...args} />,
};

export { MantineAIMarkdown };
