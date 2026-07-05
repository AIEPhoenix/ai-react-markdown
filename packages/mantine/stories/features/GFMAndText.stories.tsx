import { mantineMetaBase, type MantineMeta, type MantineStory } from '../_shared/mantineMeta';

const meta: MantineMeta = {
  ...mantineMetaBase,
  tags: ['autodocs'],
  title: 'Mantine/Features/GFM & Text',
  parameters: {
    docs: {
      description: {
        component:
          'GFM (tables, task lists, strikethrough) and the full text/heading scale, rendered ' +
          'through Mantine typography so spacing, headings, and table styling match the Mantine ' +
          'design system. Same markdown surface as **Core / Features**, Mantine-themed.',
      },
    },
  },
};

export default meta;

/** Tables with alignment and a task list, Mantine-styled. */
export const TablesAndTaskLists: MantineStory = {
  args: {
    content: `## Plans

| Feature   | Free | Pro |  Enterprise |
| :-------- | :--: | :-: | ----------: |
| Seats     |  1   | 10  |   Unlimited |
| Streaming |  ✓   |  ✓  |           ✓ |
| SSO       |  —   |  —  |           ✓ |

### Checklist

- [x] Install \`@ai-react-markdown/mantine\`
- [x] Wrap the app in \`MantineProvider\`
- [ ] Ship to production`,
  },
};

/** Headings, emphasis, blockquotes, and highlight through Mantine typography. */
export const TextScale: MantineStory = {
  args: {
    content: `# Heading 1
## Heading 2
### Heading 3

Body text with **bold**, *italic*, ~~strikethrough~~, ==highlight==, and \`inline code\`.

> A blockquote, styled by Mantine.
>
> > Nested for good measure.`,
  },
};
