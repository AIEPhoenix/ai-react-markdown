import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import { Columns, Column } from '../_shared/SideBySide';
import { AIMarkdownRenderDisplayOptimizeAbility as Ability } from '../../src/index';

const SMARTY = `"Smart quotes" and 'single quotes' become curly. An em-dash --- and an
en-dash -- get real glyphs. Ellipses... collapse to a single character.`;

const PANGU = `在 React19 项目里使用 AIMarkdown 渲染 LLM 输出的 Markdown，2026年 上线。`;

// The comment shares its raw-HTML block with stray same-line text — the case
// where the ability makes a VISIBLE difference. A well-formed comment standing
// alone is invisible either way: the raw-HTML pass parses it into a hast
// comment node, and comment nodes never render.
const COMMENTS = `Visible paragraph.

<!-- internal note the model emitted --> stray annotation on the comment's line

Another visible paragraph.`;

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Configuration/Display Optimizations',
  parameters: {
    docs: {
      description: {
        component:
          'Three display optimizations run via `config.displayOptimizeAbilities`, all on by ' +
          'default: `SMARTYPANTS` (curly quotes, real dashes, ellipses), `PANGU` (auto-spacing ' +
          'between CJK and half-width characters), and `REMOVE_COMMENTS` (strip HTML comments). ' +
          'Each story compares the same input with the ability on vs off. Remember: `config` ' +
          'arrays replace, so list exactly the abilities you want.',
      },
    },
  },
};

export default meta;

function Compare({
  content,
  onLabel,
  abilitiesWhenOff,
}: {
  content: string;
  onLabel: string;
  abilitiesWhenOff: Ability[];
}) {
  return (
    <Columns>
      <Column label={onLabel}>
        <ThemedAIMarkdown content={content} />
      </Column>
      <Column label="disabled">
        <ThemedAIMarkdown content={content} config={{ displayOptimizeAbilities: abilitiesWhenOff }} />
      </Column>
    </Columns>
  );
}

/** Typographic punctuation: straight quotes/dashes/ellipses on the left, raw on the right. */
export const SmartyPants: CoreStory = {
  render: () => (
    <Compare content={SMARTY} onLabel="SMARTYPANTS on" abilitiesWhenOff={[Ability.PANGU, Ability.REMOVE_COMMENTS]} />
  ),
};

/** CJK ↔ Latin spacing: notice the gaps around `React19` and `2026年` appear only on the left. */
export const Pangu: CoreStory = {
  render: () => (
    <Compare content={PANGU} onLabel="PANGU on" abilitiesWhenOff={[Ability.SMARTYPANTS, Ability.REMOVE_COMMENTS]} />
  ),
};

/**
 * With the ability on (left), the whole raw-HTML block containing the comment is stripped at
 * the markdown stage — stray text on the comment's line goes with it. Off (right), the comment
 * itself still never renders (it becomes a hast comment node), but the stray text leaks into
 * the output as bare text between the paragraphs.
 */
export const RemoveComments: CoreStory = {
  render: () => (
    <Compare content={COMMENTS} onLabel="REMOVE_COMMENTS on" abilitiesWhenOff={[Ability.SMARTYPANTS, Ability.PANGU]} />
  ),
};
