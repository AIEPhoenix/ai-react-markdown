import { mantineMetaBase, type MantineMeta, type MantineStory } from '../_shared/mantineMeta';

const meta: MantineMeta = {
  ...mantineMetaBase,
  tags: ['autodocs'],
  title: 'Mantine/Features/Rich Document',
  parameters: {
    docs: {
      description: {
        component:
          'A realistic assistant message exercising the whole Mantine surface at once: prose, a ' +
          'highlighted code block, display math, a GFM table, a task list, and a live Mermaid ' +
          'diagram — the kind of mixed output an LLM actually streams into a chat UI.',
      },
    },
  },
};

export default meta;

/** Everything composed together, the way a real answer arrives. */
export const KitchenSink: MantineStory = {
  args: {
    content: String.raw`# Implementing debounce

A **debounce** delays invoking a function until input settles. Here's a typed implementation:

\`\`\`ts
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
\`\`\`

## Cost model

If events arrive at rate $\lambda$ and the wait is $w$, the expected number of
deferred calls before one fires is:

$$E[N] = \frac{1}{1 - e^{-\lambda w}}$$

## When to reach for it

| Scenario          | Debounce | Throttle |
| :---------------- | :------: | :------: |
| Search-as-you-type |    ✓     |    —     |
| Scroll handler     |    —     |    ✓     |
| Window resize      |    ✓     |    —     |

### Follow-ups

- [x] Implement the helper
- [ ] Add a leading-edge option
- [ ] Write tests

## Control flow

\`\`\`mermaid
graph LR
    E[event] --> C{timer running?}
    C -->|yes| R[reset timer]
    C -->|no| S[start timer]
    R --> W[wait w ms]
    S --> W
    W --> F[fire fn]
\`\`\`

That's the complete picture. :rocket:`,
  },
};
