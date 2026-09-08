import { createRegistry } from '../../../packages/engine/src/components/documentRegistry';
import { createRenderer, createSSRApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { expect, test } from 'vitest';

import { useMarkdownChunk, type ChunkInput } from './useMarkdownChunk';

interface HostNode {
  parent: HostNode | null;
  children: HostNode[];
  text: string;
}
const node = (text = ''): HostNode => ({ parent: null, children: [], text });
const host = createRenderer<HostNode, HostNode>({
  createElement: () => node(),
  createText: node,
  createComment: node,
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.text = text;
    n.children = [];
  },
  patchProp: () => {},
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
    parent.children.splice(index, 0, n);
  },
  remove(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    n.parent = null;
  },
});
async function settle() {
  for (let i = 0; i < 8; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

test('Vue post-commit publication coordinates two chunks, updates definitions and releases switched documents', async () => {
  const first = createRegistry();
  const second = createRegistry();
  const inputs = shallowRef<ChunkInput[]>([
    {
      content: 'Claim[^n] and [site][u].',
      documentId: 'doc',
      registry: first,
      preserveOrphanReferences: false,
      incrementalParse: true,
    },
    {
      content: '[^n]: Shared **body**\n\n[u]: https://example.com',
      documentId: 'doc',
      registry: first,
      preserveOrphanReferences: false,
      incrementalParse: true,
    },
  ]);
  const chunks: ReturnType<typeof useMarkdownChunk>[] = [];
  const Probe = defineComponent({
    props: { index: { type: Number, required: true } },
    setup(props) {
      const chunk = useMarkdownChunk(() => inputs.value[props.index]);
      chunks[props.index] = chunk;
      // Preparation during setup must neither register nor publish.
      void chunk.prepared.value;
      expect(first.chunkOrder).toHaveLength(0);
      return () => h('output', JSON.stringify([chunk.prepared.value.trees.hast, chunk.aggregate.value]));
    },
  });
  const app = host.createApp({ render: () => h('main', [h(Probe, { index: 0 }), h(Probe, { index: 1 })]) });
  try {
    app.mount(node());
    await settle();
    expect(first.chunkOrder).toHaveLength(2);
    expect(first.globalNumber('N')).toBe(1);
    expect(first.resolveLinkDef('U')?.url).toBe('https://example.com');
    expect(JSON.stringify(chunks[1].aggregate.value)).toContain('Shared ');
    expect(chunks[0].prepared.value.targets.missingFootnotes.has('N')).toBe(true);
    const unchangedTrees = chunks[0].prepared.value.trees;
    inputs.value = inputs.value.map((input, i) =>
      i === 1 ? { ...input, content: '[^n]: Changed body\n\n[u]: https://example.org' } : input
    );
    await settle();
    expect(first.resolveLinkDef('U')?.url).toBe('https://example.org');
    expect(JSON.stringify(chunks[1].aggregate.value)).toContain('Changed body');
    expect(chunks[0].prepared.value.trees.mdast).toBe(unchangedTrees.mdast);
    inputs.value = inputs.value.map((input) => ({ ...input, documentId: 'other', registry: second }));
    await settle();
    expect(first.chunkData.size).toBe(0);
    expect(second.chunkOrder).toHaveLength(2);
    expect(second.globalNumber('N')).toBe(1);
    for (const chunk of chunks) expect(chunk.prepared.value.registry).toBe(second);
  } finally {
    app.unmount();
  }
  await settle();
  expect(second.chunkData.size).toBe(0);
  expect(first._subscribers.size).toBe(0);
  expect(second._subscribers.size).toBe(0);
});

test('Vue SSR prepares local footnotes without publishing or allocating a chunk', async () => {
  const registry = createRegistry();
  const App = defineComponent({
    setup() {
      const chunk = useMarkdownChunk(() => ({
        content: 'Claim[^n].\n\n[^n]: Local body',
        documentId: 'ssr',
        registry,
        preserveOrphanReferences: true,
        incrementalParse: false,
      }));
      return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
    },
  });
  const html = await renderToString(createSSRApp(App));
  expect(html).toContain('Local body');
  expect(html).toContain('dataFootnotes');
  expect(registry.chunkOrder).toHaveLength(0);
  expect(registry.chunkData.size).toBe(0);
  expect(registry._subscribers.size).toBe(0);
});
