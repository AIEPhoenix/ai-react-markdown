import { expect, test } from 'vitest';
import { advanceIncrementalParse, type IncrementalParseState } from '@ai-react-markdown/engine';
import { buildAdvanceOptions, CATALOG } from '../../../engine/src/components/incrementalParse/testPluginCatalog';
import { buildBlocks } from './blockMemo';
import { createBlockPlanner } from './blockPlanner';

const docs = [
  'Stable **prefix**.\n\nSecond paragraph.\n\nThird.\n\n',
  'Prefix.\n\n- first\n- second\n\n```js\nx();\n```\n\nTail.',
  'Prefix.\n\nClaim[^a] and [link][b].\n\n[^a]: Footnote\n\n[b]: #target\n\nTail.',
  'Prefix.\n\n<details>\n\nClaim[^a]\n\n[^a]: Note\n\n</details>\n\nTail.',
  'Prefix.\n\nTerm\n: definition\n\n$$x^2$$\n\nTail.',
];

test.each(CATALOG)('retained-prefix plans equal full plans at every append seam: $label', (config) => {
  const options = buildAdvanceOptions(config);
  for (const source of docs) {
    const plan = createBlockPlanner();
    let state: IncrementalParseState | null = null;
    for (let length = 1; length <= source.length; length++) {
      const text = source.slice(0, length);
      const result = advanceIncrementalParse(state, text, options);
      state = result.nextState;
      expect(plan(result.mdast, result.hast, text), `prefix ${JSON.stringify(text)}`).toEqual(
        buildBlocks(result.mdast, result.hast, text)
      );
    }
    // Equal content, a replacement, and a plugin-dependency change must all
    // remain equivalent, even after the planner has retained a long prefix.
    for (const text of [source, source.replace('Prefix', 'Edited'), 'replacement']) {
      const result = advanceIncrementalParse(state, text, { ...options, depsKey: [Symbol()] });
      state = result.nextState;
      expect(plan(result.mdast, result.hast, text)).toEqual(buildBlocks(result.mdast, result.hast, text));
    }
  }
});

test('actually reuses retained block information, but resets on phantom-policy change', () => {
  const options = buildAdvanceOptions(CATALOG[0]);
  const plan = createBlockPlanner();
  const source = 'Stable prefix.\n\nSecond.\n\n';
  const first = advanceIncrementalParse(null, source, options);
  const a = plan(first.mdast, first.hast, source);
  const text = source + 'Tail.\n\n';
  const next = advanceIncrementalParse(first.nextState, text, options);
  const b = plan(next.mdast, next.hast, text);
  expect(b.blocks[0]).toBe(a.blocks[0]);
  const policy = { phantomFootnoteLabels: new Set(['A']) };
  const c = plan(next.mdast, next.hast, text, policy);
  expect(c.blocks[0]).not.toBe(b.blocks[0]);
  expect(c).toEqual(buildBlocks(next.mdast, next.hast, text, policy));
});
