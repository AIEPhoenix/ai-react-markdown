import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Features/Code Blocks',
  parameters: {
    docs: {
      description: {
        component:
          'Fenced code blocks render as semantic, language-tagged `<pre><code class="language-…">` ' +
          'styled by the typography tokens. **Core does not tokenize** — it deliberately ships no ' +
          'syntax-highlighting engine, so the output stays small and you choose the tokenizer ' +
          '(or use the `@ai-react-markdown/mantine` subpackage, which adds highlighting). ' +
          'See **Extending / Custom Components** to wire in your own highlighter or copy button.',
      },
    },
  },
};

export default meta;

/** Inline code and a fenced block with a language tag. */
export const Basic: CoreStory = {
  args: {
    content: `Install with \`pnpm add @ai-react-markdown/core\`, then:

\`\`\`tsx
import AIMarkdown from '@ai-react-markdown/core';

export function Message({ content }: { content: string }) {
  return <AIMarkdown content={content} colorScheme="light" />;
}
\`\`\``,
  },
};

/** The `language-*` class is preserved per fence, ready for any CSS theme or tokenizer. */
export const MultipleLanguages: CoreStory = {
  args: {
    content: `\`\`\`python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

\`\`\`sql
SELECT id, name FROM users WHERE active = true ORDER BY created_at DESC;
\`\`\`

\`\`\`bash
curl -s https://api.example.com/v1/models | jq '.data[].id'
\`\`\``,
  },
};

/** A fence with no language info string still renders as a clean monospace block. */
export const NoLanguage: CoreStory = {
  args: {
    content: `\`\`\`
packages/
  core/
  mantine/
pnpm-workspace.yaml
\`\`\``,
  },
};
