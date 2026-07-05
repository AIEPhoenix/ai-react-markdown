import { mantineMetaBase, type MantineMeta, type MantineStory } from '../_shared/mantineMeta';

const meta: MantineMeta = {
  ...mantineMetaBase,
  tags: ['autodocs'],
  title: 'Mantine/Features/Code Highlighting',
  parameters: {
    docs: {
      description: {
        component:
          'The headline difference from Core: fenced code blocks are **tokenized and ' +
          'syntax-highlighted** via `@mantine/code-highlight` (highlight.js), wrapped in ' +
          "Mantine's `CodeHighlightTabs` with a language label and copy button. Core ships no " +
          'tokenizer — it emits semantic `language-*` classes only. The highlight.js theme ' +
          'follows the Mantine color scheme (atom-one-light / agate).',
      },
    },
  },
};

export default meta;

/** Several languages, each tokenized with a language label and copy button. */
export const ManyLanguages: MantineStory = {
  args: {
    content: `\`\`\`tsx
import MantineAIMarkdown from '@ai-react-markdown/mantine';

export function Message({ content }: { content: string }) {
  return <MantineAIMarkdown content={content} />;
}
\`\`\`

\`\`\`python
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

/** A unified diff highlights additions and deletions. */
export const Diff: MantineStory = {
  args: {
    content: `\`\`\`diff
 function greet(name) {
-  return 'Hello ' + name;
+  return \`Hello, \${name}!\`;
 }
\`\`\``,
  },
};

/**
 * With `autoDetectUnknownLanguage: true`, a fence that lacks a language tag is
 * still highlighted — highlight.js guesses the language. Default is `false`
 * (untagged blocks render as plain monospace).
 */
export const AutoDetectLanguage: MantineStory = {
  args: {
    config: { codeBlock: { autoDetectUnknownLanguage: true } },
    content: `No language tag on this fence, yet it gets highlighted:

\`\`\`
const compiled = template.replace(/\\{(\\w+)\\}/g, (_, k) => vars[k]);
export default compiled;
\`\`\``,
  },
};
