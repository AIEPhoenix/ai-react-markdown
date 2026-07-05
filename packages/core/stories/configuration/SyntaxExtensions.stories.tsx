import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import { Columns, Column } from '../_shared/SideBySide';
import { AIMarkdownRenderExtraSyntax } from '../../src/index';

const SAMPLE = `Inline ==highlighted text== uses the HIGHLIGHT extension.

Apple
: A pomaceous fruit.

Browser
: Software for accessing the web.
: Often ships a JavaScript engine.`;

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Configuration/Syntax Extensions',
  parameters: {
    docs: {
      description: {
        component:
          'Two markdown extensions beyond GFM are controlled by `config.extraSyntaxSupported`: ' +
          '`HIGHLIGHT` (`==text==` → `<mark>`) and `DEFINITION_LIST`. Both are on by default. ' +
          'Passing `config` deep-merges with the defaults, but **array values replace entirely** ' +
          '— so `extraSyntaxSupported: []` turns both off and the syntax renders as literal text.',
      },
    },
  },
  args: { content: SAMPLE },
};

export default meta;

/** Both extensions on (the default): the highlight renders and the definition list formats. */
export const Enabled: CoreStory = {
  render: (args) => <ThemedAIMarkdown {...args} />,
};

/** Both off: `==text==` shows its literal equals signs and the term/`:` lines stay plain. */
export const Disabled: CoreStory = {
  render: (args) => <ThemedAIMarkdown {...args} config={{ extraSyntaxSupported: [] }} />,
};

/** Side by side, so the difference is unmistakable. */
export const Comparison: CoreStory = {
  parameters: { docs: { description: { story: 'Left: default (both on). Right: both extensions disabled.' } } },
  render: (args) => (
    <Columns>
      <Column label="extraSyntaxSupported: default">
        <ThemedAIMarkdown {...args} />
      </Column>
      <Column label="extraSyntaxSupported: []">
        <ThemedAIMarkdown {...args} config={{ extraSyntaxSupported: [] }} />
      </Column>
    </Columns>
  ),
};

/** Enable only HIGHLIGHT, leaving definition lists off. */
export const HighlightOnly: CoreStory = {
  render: (args) => (
    <ThemedAIMarkdown {...args} config={{ extraSyntaxSupported: [AIMarkdownRenderExtraSyntax.HIGHLIGHT] }} />
  ),
};
