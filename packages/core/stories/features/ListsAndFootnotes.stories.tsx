import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Features/Lists & Footnotes',
  parameters: {
    docs: {
      description: {
        component:
          'Ordered, unordered, and nested lists; definition lists (the DEFINITION_LIST extra ' +
          'syntax, on by default); and footnotes with auto back-references. Footnote ids are ' +
          'namespaced per document — see **Robustness / Document Isolation** for why that matters.',
      },
    },
  },
};

export default meta;

/** Mixed ordered/unordered nesting to several levels. */
export const NestedLists: CoreStory = {
  args: {
    content: `1. First step
2. Second step
   - Sub-point A
   - Sub-point B
     1. Deeply nested ordered item
     2. Another one
3. Third step

- Top-level bullet
  - Nested bullet
    - Even deeper`,
  },
};

/**
 * Definition lists use the PHP-Markdown-Extra syntax: a term line followed by
 * one or more `: definition` lines.
 */
export const DefinitionLists: CoreStory = {
  args: {
    content: `Token System
: A set of CSS custom properties that define colors, spacing, and typography.

Design Token
: An individual variable (e.g. \`--aim-color-anchor\`) you can override to retheme.
: A term may have multiple definitions, each on its own line.`,
  },
};

/** Footnote references link down to definitions, which link back up. */
export const Footnotes: CoreStory = {
  args: {
    content: `The token system[^tokens] enables full theme customization without forking[^fork].

Multiple references to the same note[^tokens] resolve to one definition.

[^tokens]: See the Design Tokens story for the complete token reference.
[^fork]: You override CSS custom properties in your own stylesheet — no source changes.`,
  },
};
