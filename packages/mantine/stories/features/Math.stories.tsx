import { mantineMetaBase, type MantineMeta, type MantineStory } from '../_shared/mantineMeta';

const meta: MantineMeta = {
  ...mantineMetaBase,
  tags: ['autodocs'],
  title: 'Mantine/Features/Math',
  parameters: {
    docs: {
      description: {
        component:
          'The Mantine build inherits Core’s full math pipeline (KaTeX + the LaTeX ' +
          'preprocessor), rendered inside Mantine typography. Inline and display math, currency ' +
          'disambiguation, and `mhchem` all work exactly as in **Core / Features / Math**.',
      },
    },
  },
};

export default meta;

/** Inline and display math, themed by Mantine. */
export const InlineAndDisplay: MantineStory = {
  args: {
    content: String.raw`Euler's identity inline: $e^{i\pi} + 1 = 0$.

A display block:

$$\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$$

Currency stays text — the plan costs $9.99/mo — while $a^2 + b^2 = c^2$ is math.`,
  },
};
