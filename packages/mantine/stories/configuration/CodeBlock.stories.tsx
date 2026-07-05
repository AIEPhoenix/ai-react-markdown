import { mantineMetaBase, type MantineMeta, type MantineStory } from '../_shared/mantineMeta';

const LONG_CODE = `\`\`\`ts
// A deliberately long block to show the collapse behavior.
export function quicksort(xs: number[]): number[] {
  if (xs.length <= 1) return xs;
  const [pivot, ...rest] = xs;
  const left = rest.filter((x) => x < pivot);
  const right = rest.filter((x) => x >= pivot);
  return [...quicksort(left), pivot, ...quicksort(right)];
}

export function mergesort(xs: number[]): number[] {
  if (xs.length <= 1) return xs;
  const mid = Math.floor(xs.length / 2);
  const l = mergesort(xs.slice(0, mid));
  const r = mergesort(xs.slice(mid));
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < l.length && j < r.length) out.push(l[i] <= r[j] ? l[i++] : r[j++]);
  return [...out, ...l.slice(i), ...r.slice(j)];
}
\`\`\``;

const meta: MantineMeta = {
  ...mantineMetaBase,
  tags: ['autodocs'],
  title: 'Mantine/Configuration/Code Block',
  parameters: {
    docs: {
      description: {
        component:
          'Mantine-only `config.codeBlock` options. `defaultExpanded` (default `true`) controls ' +
          'whether long blocks start expanded or collapsed behind an expand button. ' +
          '`autoDetectUnknownLanguage` (default `false`) highlights untagged fences via ' +
          'highlight.js language detection.',
      },
    },
  },
  args: { content: LONG_CODE },
};

export default meta;

/** Default: code blocks start expanded. */
export const Expanded: MantineStory = {
  args: { config: { codeBlock: { defaultExpanded: true } } },
};

/** Collapsed by default — long blocks show an expand control instead of the full body. */
export const Collapsed: MantineStory = {
  args: { config: { codeBlock: { defaultExpanded: false } } },
};
