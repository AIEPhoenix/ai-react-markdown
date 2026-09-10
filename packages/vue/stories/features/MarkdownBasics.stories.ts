import { GFM_BASICS, TABLES_DOC, TASK_LIST_DOC } from '@ai-markdown/storybook-kit/common/fixtures';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, waitFor } from 'storybook/test';
import { h } from 'vue';
import AIMarkdown from '../../src';
const meta: Meta = {
  title: 'Basics/Markdown Basics',
  tags: ['autodocs'],
  component: AIMarkdown,
  render: (args) => ({ setup: () => () => h(AIMarkdown, { ...args, content: args.content ?? '' }) }),
  argTypes: { content: { control: 'text' } },
  parameters: {
    docs: {
      description: {
        component:
          'Headings, emphasis, tables, task lists and quotes use the same corpus excerpts as React. Edit the complete Markdown source in Controls. Code fences are plain pre/code elements; syntax highlighting requires an application integration.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof AIMarkdown>;
export const GFM: Story = {
  args: { content: GFM_BASICS },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('table')).not.toBeNull());
    expect(canvasElement.querySelector('input[type="checkbox"][disabled]')).not.toBeNull();
  },
};

export const Tables: Story = {
  args: { content: TABLES_DOC },
  parameters: {
    docs: {
      description: {
        story:
          'The same corpus table as React: left, center, right and default alignment, uneven widths and empty cells. Edit content in Controls; alignment belongs to individual cells rather than the surrounding container.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelectorAll('th')).toHaveLength(4));
    expect(Array.from(canvasElement.querySelectorAll('th')).map((cell) => cell.getAttribute('align'))).toEqual([
      'left',
      'center',
      'right',
      null,
    ]);
    expect(canvasElement.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(canvasElement.querySelector('tbody tr:last-child td')?.textContent).toBe('');
  },
};
export const TaskLists: Story = {
  args: { content: TASK_LIST_DOC },
  parameters: {
    docs: {
      description: {
        story:
          'Corpus task items render as disabled checkboxes, not editable form controls. Checked and unchecked items preserve their authored state. The application should edit Markdown source to change a task.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('input[type="checkbox"]')).not.toBeNull());
    const boxes = Array.from(canvasElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.some((box) => box.checked)).toBe(true);
    expect(boxes.some((box) => !box.checked)).toBe(true);
    for (const box of boxes) expect(box).toBeDisabled();
  },
};
