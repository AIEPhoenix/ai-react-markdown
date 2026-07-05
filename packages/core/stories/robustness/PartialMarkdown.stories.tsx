import { coreMetaBase, type CoreMeta, type CoreStory } from '../_shared/coreMeta';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Robustness/Partial Markdown',
  parameters: {
    docs: {
      description: {
        component:
          'During streaming the renderer is constantly handed **syntactically incomplete** markdown ' +
          '— an open code fence, a half-typed bold, a table with no body yet, a `$$` block that ' +
          "hasn't closed. None of these should throw or corrupt the output. Each story freezes one " +
          'such mid-stream state; the component degrades gracefully every time. For the live version, ' +
          'see **Core / AIMarkdown → Streaming**.',
      },
    },
  },
};

export default meta;

/** A fenced block that never closes still renders as a code block, not raw text. */
export const UnclosedCodeFence: CoreStory = {
  args: {
    streaming: true,
    content: `Here's the implementation so far:

\`\`\`ts
export function partial(n: number) {
  const acc = [];
  for (let i = 0; i < n; i++) {`,
  },
};

/** Half-finished emphasis and a dangling link don't break the surrounding text. */
export const UnclosedInline: CoreStory = {
  args: {
    streaming: true,
    content: `This sentence has **bold that never closes and keeps going.

An incomplete [link label](https://exa

And an unfinished inline \`code span that runs off the edge.`,
  },
};

/** A table mid-construction (header + delimiter, partial row) renders what it can. */
export const TruncatedTable: CoreStory = {
  args: {
    streaming: true,
    content: `| Name | Role |
| ---- | ---- |
| Ada  | Eng`,
  },
};

/**
 * The LaTeX preprocessor truncates an unclosed `$$` block while streaming so a
 * half-arrived formula doesn't swallow the rest of the document into math mode.
 */
export const UnclosedMath: CoreStory = {
  args: {
    streaming: true,
    content: `The integral we're deriving:

$$\\int_{0}^{1} x^2 \\,dx = `,
  },
};

/** All of the above at once — the realistic shape of a single streamed frame. */
export const MixedMidStream: CoreStory = {
  args: {
    streaming: true,
    content: `## Summary so far

We computed the result and found that **the value is

| Metric | Value |
| ------ | ----- |
| Mean   |

\`\`\`python
def estimate(xs):
    return sum(xs) /`,
  },
};
