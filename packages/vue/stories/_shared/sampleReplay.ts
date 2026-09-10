import { h } from 'vue';
import AIMarkdown from '../../src';
import { useCorpusReplay } from '@ai-markdown/storybook-kit/vue/replay';
/** Replay one capability fixture without duplicating timer ownership. */
export function sampleReplay(source: string) {
  return {
    setup() {
      const replay = useCorpusReplay(source);
      return () =>
        h('section', [
          h('button', { onClick: replay.restart }, 'Replay sample'),
          h('button', { onClick: replay.finish }, 'Complete sample'),
          h('button', { onClick: replay.cancel }, 'Cancel replay'),
          h('output', { 'data-replay-state': '' }, replay.streaming.value ? 'Receiving' : 'Idle'),
          h(AIMarkdown, { content: replay.content.value, streaming: replay.streaming.value }),
        ]);
    },
  };
}
