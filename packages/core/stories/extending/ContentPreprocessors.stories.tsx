import { coreMetaBase, type CoreMeta, type CoreStory, ThemedAIMarkdown } from '../_shared/coreMeta';
import { Columns, Column } from '../_shared/SideBySide';
import type { AIMDContentPreprocessor } from '../../src/index';

const meta: CoreMeta = {
  ...coreMetaBase,
  tags: ['autodocs'],
  title: 'Core/Extending/Content Preprocessors',
  parameters: {
    docs: {
      description: {
        component:
          'Preprocessors are `(content: string) => string` transforms applied to the raw markdown ' +
          '**before** the remark/rehype pipeline. Use them for string-level fixes that are simpler ' +
          'than a remark plugin: frontmatter stripping, dialect normalization, model-quirk regexes. ' +
          'They run after the built-in LaTeX preprocessor, left-to-right (`c(b(a(x)))`). Each story ' +
          'compares raw input (no preprocessor) against the transformed output.',
      },
    },
  },
};

export default meta;

function Compare({ raw, preprocessors }: { raw: string; preprocessors: AIMDContentPreprocessor[] }) {
  return (
    <Columns>
      <Column label="raw (no preprocessor)">
        <ThemedAIMarkdown content={raw} />
      </Column>
      <Column label="with preprocessor">
        <ThemedAIMarkdown content={raw} contentPreprocessors={preprocessors} />
      </Column>
    </Columns>
  );
}

/** Rewrite Obsidian-style `[[wikilinks]]` into real markdown links. */
const wikiLinks: AIMDContentPreprocessor = (content) =>
  content.replace(/\[\[([^\]]+)\]\]/g, (_m, name) => `[${name}](/wiki/${encodeURIComponent(name)})`);

export const WikiLinks: CoreStory = {
  render: () => (
    <Compare
      preprocessors={[wikiLinks]}
      raw={`See [[Design Tokens]] and [[Custom Components]] for details.

Without the preprocessor these stay as literal double-bracket text.`}
    />
  ),
};

/** Strip a leading YAML frontmatter block the model echoed into the message. */
const stripFrontmatter: AIMDContentPreprocessor = (content) => {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  return end === -1 ? content : content.slice(end + 5);
};

export const StripFrontmatter: CoreStory = {
  render: () => (
    <Compare
      preprocessors={[stripFrontmatter]}
      raw={`---
title: Draft
tags: [a, b]
---

# Actual content

The frontmatter above is noise — strip it before rendering.`}
    />
  ),
};

/** Chain transforms: collapse excess blank lines, then drop a stream sentinel. */
const normalizeBlankLines: AIMDContentPreprocessor = (content) => content.replace(/\n{3,}/g, '\n\n');
const stripStreamMarker: AIMDContentPreprocessor = (content) => content.replace(/\s*\[end of stream\]\s*$/i, '');

export const ChainedPipeline: CoreStory = {
  parameters: {
    docs: {
      description: { story: 'Preprocessors compose left-to-right: blank-line collapse, then sentinel removal.' },
    },
  },
  render: () => (
    <Compare
      preprocessors={[normalizeBlankLines, stripStreamMarker]}
      raw={'First paragraph.\n\n\n\n\nSecond paragraph after too many blanks.\n\nDone. [end of stream]'}
    />
  ),
};
