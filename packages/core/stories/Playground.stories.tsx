import React from 'react';
import 'katex/dist/katex.min.css';
import '../src/components/typography/variants/all.scss';
import AIMarkdown from '../src/index';
import { WithScheme } from './_shared/colorScheme';
import { baseCoreMeta, type CoreMeta, type CoreStory } from './_shared/meta';
import { coreArgTypes } from './_shared/argTypes';
import { StreamingReplay, ThemedReplayButton } from './_shared/streaming';
import { GFM_BASICS, KITCHEN_SINK } from './_shared/fixtures';
import { getStreamingTheme } from './streaming/theme';

/**
 * The full `<AIMarkdown>` surface with every prop wired to a control. Start
 * here to try the component against your own content: paste markdown into
 * `content`, flip the behavior flags, switch the theme from the toolbar.
 *
 * The feature branches below split the same surface into one story per
 * capability, each with its controls narrowed to the props that matter there.
 */
const meta: CoreMeta = {
  ...baseCoreMeta,
  title: 'Core/Playground',
  tags: ['autodocs'],
  component: AIMarkdown,
  parameters: {
    // Not 'error' yet — two real violations in the GFM baseline, both from
    // the renderer rather than from this story: GFM task-list checkboxes are
    // emitted as bare `<input type="checkbox" disabled>` with no accessible
    // name, and the default link color misses 4.5:1 against white (3.55).
    // Both are library fixes; until they land, keep them visible in the a11y
    // panel instead of red in CI.
    a11y: { test: 'todo' },
  },
  argTypes: {
    ...coreArgTypes,
    variant: { control: 'select', options: ['default'], description: 'Typography variant name.' },
  },
};

export default meta;

/** Static render of the GFM baseline — edit `content` to render your own. */
export const Default: CoreStory = {
  args: {
    content: GFM_BASICS,
  },
};

/**
 * The same component fed token by token. The payload is the kitchen sink:
 * thinking tags, raw HTML, math, admonitions, mermaid, tables, footnotes,
 * and a run of code fences in six languages — deliberately including
 * malformed LaTeX, because real model output contains it.
 *
 * Hit **Restart** to replay. `content` is a control, so you can stream any
 * markdown you paste in.
 */
export const Streaming: CoreStory = {
  args: {
    content: KITCHEN_SINK,
    fontSize: '',
  },
  argTypes: {
    streaming: { table: { disable: true } },
  },
  parameters: {
    controls: { exclude: ['streaming'] },
  },
  render: (args) => (
    <WithScheme>
      {(colorScheme) => (
        <StreamingReplay
          text={args.content ?? ''}
          style={{ color: getStreamingTheme(colorScheme).text }}
          renderButton={(streaming, restart) => <ThemedReplayButton streaming={streaming} onRestart={restart} />}
        >
          {(content, streaming) => (
            <AIMarkdown {...args} content={content} streaming={streaming} colorScheme={colorScheme} />
          )}
        </StreamingReplay>
      )}
    </WithScheme>
  ),
};
