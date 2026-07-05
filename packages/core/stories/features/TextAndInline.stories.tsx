import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Features/Text & Inline',
  parameters: {
    docs: {
      description: {
        component:
          'Block and inline text rendering: the full heading scale, nested blockquotes, ' +
          '`==highlight==` (the HIGHLIGHT extra syntax, on by default), and raw inline HTML ' +
          '(`<sub>`, `<sup>`, `<ins>`) — allowed through because `rehype-raw` runs but ' +
          '`rehype-sanitize` still strips anything dangerous.',
      },
    },
  },
};

export default meta;

/** All six heading levels share a weight token but scale down in size. */
export const Headings: CoreStory = {
  args: {
    content: `# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

Body text for reference, with **bold**, *italic*, and \`inline code\`.`,
  },
};

/** Emphasis, highlight, and inline HTML composed together in running prose. */
export const InlineFormatting: CoreStory = {
  args: {
    content: `Combine **bold**, *italic*, ***bold italic***, ~~strikethrough~~, and
==highlighted text== in one sentence.

Scientific notation needs inline HTML: H<sub>2</sub>O and E = mc<sup>2</sup>.
Track edits with <ins>inserted</ins> text.

Use \`npm install\` to add a dependency; the \`--save-dev\` flag marks it as a dev dependency.`,
  },
};

/** Blockquotes nest, and a horizontal rule separates sections. */
export const BlockquotesAndRules: CoreStory = {
  args: {
    content: `> A single-level blockquote with **bold** and \`code\`.
>
> > Nested blockquotes work too, for quoting a reply within a quote.

---

> Attribution-style quote.
>
> — someone worth quoting`,
  },
};
