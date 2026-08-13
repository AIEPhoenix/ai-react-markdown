import '../../src/components/typography/variants/all.scss';
import AIMarkdown from '../../src/index';
import {
  defaultEnginePlugins,
  definitionList,
  highlight,
  pangu,
  removeComments,
  smartypants,
  type AIMarkdownEnginePlugin,
} from '../../src/plugins';
import { ThemedAIMarkdown } from '../_shared/ThemedAIMarkdown';
import { SideBySide } from '../_shared/layouts';
import { baseCoreMeta, type CoreMeta, type CoreStory } from '../_shared/meta';
import { docsLink } from '../_shared/docsLinks';
import {
  CJK_MIXED_DOC,
  COMMENTS_DOC,
  DEFINITION_LIST_DOC,
  MARK_HIGHLIGHT_DOC,
  SMARTYPANTS_DOC,
} from '../_shared/fixtures';

/**
 * The five selectable parse-chain plugins, each shown against a render with
 * that one plugin removed.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Features/Engine Plugins',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    a11y: { test: 'error' },
    controls: { include: ['content'] },
    docs: {
      description: {
        component: [
          'Five plugins can be switched on and off: `highlight`, `definitionList`,',
          '`smartypants`, `pangu`, and `removeComments`. All five are on by default.',
          'Import them from the `@ai-react-markdown/core/plugins` subpath (these stories',
          'import the same values through a relative path, because they live inside the',
          'repository):',
          '',
          '```tsx',
          "import { defaultEnginePlugins, pangu } from '@ai-react-markdown/core/plugins';",
          '',
          '<AIMarkdown content={md} enginePlugins={defaultEnginePlugins.filter((p) => p !== pangu)} />',
          '```',
          '',
          'The prop is **array-atomic**: omit it and you get all five; pass an array and',
          'that array replaces the default set wholesale. There is no merge and no',
          'per-plugin toggle, which is why the idiom above starts from',
          '`defaultEnginePlugins` and filters. The order of your array is ignored — each',
          "plugin's position in the produced chain comes from a fixed table, so the",
          'pipeline the incremental parser was verified against is the only pipeline it',
          'can ever build.',
          '',
          'The set is **sealed**: plugins are values the library exports, not functions',
          "you write. The incremental parser's boundary scanner has to know the",
          'multiline syntax rules of everything in the chain, so an arbitrary',
          'third-party plugin would void its verification record. Content-level',
          `extension stays open through ${docsLink('content-preprocessors', 'content preprocessors')}`,
          `and ${docsLink('custom-components', 'custom components')}.`,
          '',
          '**`highlight` is not syntax highlighting.** It adds the `==text==` syntax and',
          'turns it into a `<mark>` element. The core package colours no code tokens at',
          'all; it emits `language-*` class names and leaves the rest to you.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/**
 * Both panels render the same markdown. The left one gets the default plugin
 * set; the right one gets that set with a single plugin filtered out.
 */
const PluginComparison = ({ content, omit, name }: { content: string; omit: AIMarkdownEnginePlugin; name: string }) => (
  <SideBySide
    leftLabel="default plugins"
    rightLabel={`without ${name}`}
    left={<ThemedAIMarkdown content={content} enginePlugins={defaultEnginePlugins} />}
    right={<ThemedAIMarkdown content={content} enginePlugins={defaultEnginePlugins.filter((p) => p !== omit)} />}
  />
);

/**
 * `==text==` becomes a `<mark>` element, painted with the
 * `--aim-color-mark-bg` token. Remove the plugin and the equals signs are
 * ordinary characters, so they render literally.
 *
 * The name is the one piece of this catalog that reliably misleads. This
 * plugin has nothing to do with colouring code — it is the `<mark>` syntax,
 * and nothing else.
 */
export const Highlight: CoreStory = {
  args: { content: MARK_HIGHLIGHT_DOC },
  render: (args) => <PluginComparison content={args.content ?? ''} omit={highlight} name="highlight" />,
};

/**
 * A term followed by lines opening with `: ` becomes a `<dl>`. Without the
 * plugin the same source is just paragraphs, and the colons show up as
 * literal text at the start of each line — which is what the right panel
 * shows.
 *
 * This is the plugin most likely to disappear by accident, because it goes
 * missing the moment you pass an `enginePlugins` array that forgot to include
 * it.
 */
export const DefinitionList: CoreStory = {
  args: { content: DEFINITION_LIST_DOC },
  render: (args) => <PluginComparison content={args.content ?? ''} omit={definitionList} name="definitionList" />,
};

/**
 * Straight quotes curl into typographic quotes, `--` becomes a dash, and
 * `...` collapses into a single ellipsis character. A run of three hyphens is
 * left alone, and so is everything inside a code span or a fenced block —
 * the substitution is a text-node transform, so code is never touched.
 *
 * Worth switching off if your content is technical enough that a rewritten
 * apostrophe would be wrong.
 */
export const Smartypants: CoreStory = {
  args: { content: SMARTYPANTS_DOC },
  render: (args) => <PluginComparison content={args.content ?? ''} omit={smartypants} name="smartypants" />,
};

/**
 * A space opens up wherever a Latin word or a number sits directly against a
 * Han character or a kana — the convention Chinese and Japanese typography
 * expects and models rarely produce. The right panel is the raw input.
 *
 * The Korean section is identical in both panels. That is the rule working as
 * specified rather than failing: the spacing convention is defined for Han
 * characters and kana, and Hangul is left as written.
 */
export const Pangu: CoreStory = {
  args: { content: CJK_MIXED_DOC },
  render: (args) => <PluginComparison content={args.content ?? ''} omit={pangu} name="pangu" />,
};

/**
 * **Both panels look the same, and that is the finding.** HTML comments never
 * reach the page whether this plugin runs or not: with it, comment nodes are
 * dropped from the syntax tree before the HTML stage; without it, they reach
 * the sanitizer, which discards comment nodes under the default schema. Two
 * independent stages have to fail before comment text becomes visible.
 *
 * So what does the plugin buy? It removes the nodes one stage earlier, before
 * raw-HTML reconstruction has to reason about them, and it leaves the emitted
 * markup free of the stray whitespace the discarded nodes leave behind. It is
 * a parse-stage tidy-up, not the thing standing between a reviewer's note and
 * your users.
 *
 * Both panels also agree on the last block: `<!-- … -->` inside a fenced code
 * block is source code, not a comment, and stays visible either way.
 */
export const RemoveComments: CoreStory = {
  args: { content: COMMENTS_DOC },
  render: (args) => <PluginComparison content={args.content ?? ''} omit={removeComments} name="removeComments" />,
};
