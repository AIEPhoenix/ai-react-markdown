import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import AIMarkdown, { type AIMarkdownProps } from '../../src/index';
import { useColorScheme } from './colorScheme';

// Side-effect CSS every core story needs: KaTeX glyphs + the bundled
// `default` typography variant (which also defines the `light`/`dark` token
// scopes). Imported once here so individual story files don't repeat it.
import 'katex/dist/katex.min.css';
import '../../src/components/typography/variants/all.scss';

import { withThemedBackground } from '../decorators';

export type CoreMeta = Meta<typeof AIMarkdown>;
export type CoreStory = StoryObj<typeof AIMarkdown>;

/**
 * Shared `argTypes` for the `<AIMarkdown>` Controls panel. Function-typed and
 * advanced props are hidden from the table so the common surface stays
 * approachable; the Extending/* stories opt those back in where relevant.
 */
export const coreArgTypes: CoreMeta['argTypes'] = {
  content: { control: 'text', description: 'Raw markdown content to render.' },
  streaming: { control: 'boolean', description: 'Whether content is actively being streamed.' },
  fontSize: {
    control: 'text',
    description: 'Base font size (e.g. `"0.9375rem"`, `"14px"`, or a number for px). Scales every token.',
  },
  variant: { control: 'select', options: ['default'], description: 'Typography variant name.' },
  config: {
    control: 'object',
    description: 'Partial render config, deep-merged with defaults. Array values are replaced entirely.',
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

export { useColorScheme };

/**
 * `<AIMarkdown>` with `colorScheme` wired to the live Storybook theme (read from
 * {@link useColorScheme}). Use this anywhere you'd render `<AIMarkdown>` in a
 * story so the light/dark toolbar switch drives it — in Canvas and Docs alike —
 * without each render having to thread the scheme through manually.
 */
export function ThemedAIMarkdown(props: Omit<AIMarkdownProps, 'colorScheme'>) {
  const colorScheme = useColorScheme();
  return <AIMarkdown {...props} colorScheme={colorScheme} />;
}

/**
 * Default theme-aware `render`: renders {@link ThemedAIMarkdown} so the toolbar's
 * light/dark switch drives the component in both Canvas and Docs.
 */
export const themedRender: CoreMeta['render'] = (args) => <ThemedAIMarkdown {...args} />;

/**
 * Shared meta fields for a core showcase story group. Spread this into each
 * story file's default export, then add the (statically required) `title` and
 * `tags` literals plus any per-group `parameters`/`args`:
 *
 * ```ts
 * const meta: CoreMeta = {
 *   ...coreMetaBase,
 *   title: 'Core/Features/Math',
 *   tags: ['autodocs'],
 *   parameters: { docs: { description: { component: '…' } } },
 * };
 * ```
 *
 * Use the explicit `: CoreMeta` annotation (not `satisfies`) — with an
 * inferred export type, declaration builds hit TS2742 ("cannot be named").
 *
 * `title` and `tags` must be object-literal properties in the file itself —
 * Storybook's static CSF indexer can't see them through a spread or a factory.
 */
export const coreMetaBase: Partial<CoreMeta> = {
  component: AIMarkdown,
  decorators: [withThemedBackground],
  argTypes: coreArgTypes,
  render: themedRender,
};

export { AIMarkdown };
