import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Features/GFM',
  parameters: {
    docs: {
      description: {
        component:
          'GitHub Flavored Markdown via `remark-gfm`: tables (with per-column alignment), ' +
          'task lists, strikethrough, and autolinked URLs.',
      },
    },
  },
};

export default meta;

/** Column alignment is driven by the `:` markers in the delimiter row. */
export const Tables: CoreStory = {
  args: {
    content: `## Plans

| Feature        | Free      |    Pro     |       Enterprise |
| :------------- | :-------- | :--------: | ---------------: |
| Seats          | 1         |     10     |        Unlimited |
| Streaming      | ✓         |     ✓      |                ✓ |
| Priority queue | —         |     ✓      |                ✓ |
| SSO            | —         |     —      |                ✓ |

Left-aligned, center-aligned, and right-aligned columns respectively.`,
  },
};

/** Checked and unchecked items render as (disabled) checkboxes by default. */
export const TaskLists: CoreStory = {
  args: {
    content: `### Release checklist

- [x] Cut the release branch
- [x] Run the full test suite
- [ ] Update the changelog
- [ ] Publish to npm
  - [x] Build the package
  - [ ] Verify the published tarball`,
  },
};

/** Strikethrough and GFM autolinks need no explicit link syntax. */
export const StrikethroughAndAutolinks: CoreStory = {
  args: {
    content: `Pricing was ~~$99/mo~~ now $79/mo for early adopters.

Bare URLs autolink: visit https://github.com/AIEPhoenix/ai-react-markdown for the source.

Email autolinks too: reach the maintainer at hello@example.com.`,
  },
};
