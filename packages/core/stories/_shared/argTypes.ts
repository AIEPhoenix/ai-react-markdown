import type { Meta } from '@storybook/react-vite';
import AIMarkdown from '../../src/index';

type CoreArgTypes = NonNullable<Meta<typeof AIMarkdown>['argTypes']>;

/**
 * Controls-panel definitions for the props both packages expose. The Mantine
 * meta spreads this and adds its own `codeBlock` group; core's *Playground*
 * meta spreads it and adds `variant` (core ships the typography variants;
 * the Mantine wrapper substitutes its own Typography, so the control would
 * be misleading there — and `baseCoreMeta` deliberately leaves it out).
 *
 * Hiding the live `streaming` control in replay stories: use ONE mechanism —
 * a `controls.include` whitelist where the story/meta already has one,
 * otherwise `argTypes.streaming.table.disable` (hides it from the controls
 * panel and the docs table alike). Do not stack `controls.exclude` on top.
 *
 * Explicit annotation rather than `satisfies` — this package builds with
 * `declaration: true`, where `satisfies` on an exported const trips TS2742.
 */
export const coreArgTypes: CoreArgTypes = {
  content: { control: 'text', description: 'Raw markdown content to render.' },
  streaming: { control: 'boolean', description: 'Whether content is actively being streamed.' },
  fontSize: { control: 'text', description: 'Base font size (e.g. `"0.9375rem"`, `"14px"`, or a number for px).' },
  colorScheme: { table: { disable: true } },
  // Behaviors-system flat props.
  blockMemo: { control: 'boolean', description: 'Block-level memoization (output-invariant). Default `true`.' },
  incrementalParse: {
    control: 'boolean',
    description: 'Incremental (prefix-freeze) parsing for streaming appends (output-invariant). Default `true`.',
  },
  preserveOrphanReferences: {
    control: 'boolean',
    description: 'Protect orphan reference definitions in incomplete/streaming documents. Default `true`.',
  },
  enginePlugins: { table: { disable: true } },
  metadata: { control: 'object', description: 'Arbitrary data passed to custom components via context.' },
  contentPreprocessors: { table: { disable: true } },
  customComponents: { table: { disable: true } },
  Typography: { table: { disable: true } },
  ExtraStyles: { table: { disable: true } },
};
