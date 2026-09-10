import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { play, replay } from '../_shared/replayStories';
const meta: Meta = {
  title: 'Streaming/Streaming Basics',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Replay the shared corpus as accumulated source. The renderer does not own transport, cancellation or retries. Finish, cancel and replacement buttons manipulate producer state; timer cleanup happens on unmount.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;
export const AccumulatedSource: Story = { render: () => replay(false), play };
