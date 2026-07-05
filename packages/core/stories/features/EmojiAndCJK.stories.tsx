import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Features/Emoji & CJK',
  parameters: {
    docs: {
      description: {
        component:
          '`:shortcode:` emoji via `remark-emoji`, plus first-class CJK handling: ' +
          '`remark-cjk-friendly` makes `**bold**` work even when it touches CJK punctuation ' +
          '(stock markdown fails here), and the pangu display optimization auto-inserts spacing ' +
          'between CJK and half-width Latin/numbers.',
      },
    },
  },
};

export default meta;

/** Emoji shortcodes expand to Unicode emoji. */
export const Emoji: CoreStory = {
  args: {
    content: `Ship it :rocket: — tests are green :white_check_mark: and the team is happy :tada:.

Reactions inline: :thumbsup: :heart: :eyes: :fire:`,
  },
};

/**
 * The canonical CJK emphasis bug: stock markdown won't treat `**…**` as bold
 * when an asterisk is adjacent to a full-width quote or paren. `remark-cjk-friendly`
 * fixes it, so every line below renders the intended emphasis.
 */
export const CJKEmphasisFix: CoreStory = {
  args: {
    content:
      '这是一个**“会引起”**渲染错误的**“已知问题”**，当加重符号遇到某些中文标点时，可能就会出现**“识别不了”**的情况。\n\n' +
      '**このアスタリスクは強調記号として認識されます。**この文のおかげで。\n\n' +
      '**해당 별표는 강조 표시로 인식됩니다(이 괄호에도 불구하고).**이 문장 덕분에.\n\n' +
      '删除线同理：**~~该星号会被正确识别~~**这是因为它被识别为强调符号。',
  },
};

/**
 * Pangu auto-spacing (a default display optimization) inserts a thin gap between
 * CJK characters and adjacent Latin words or numbers, matching typographic
 * convention. Toggle it off in **Configuration / Display Optimizations**.
 */
export const PanguSpacing: CoreStory = {
  args: {
    content:
      '使用 AIMarkdown 渲染 LLM 输出的 Markdown，支持 GFM 和 LaTeX 公式。\n\n' +
      '当 CJK 文本紧贴 ASCII 单词或数字（如 React19 与 2026年）时，pangu 会补上正确的间距。',
  },
};
