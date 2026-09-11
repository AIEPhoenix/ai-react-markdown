import { sanitizeSchema } from '@ai-markdown/engine';
import { createRegistry } from '../../engine/src/components/documentRegistry';
import { createRenderer, createSSRApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useMarkdownChunk, type ChunkInput } from './useMarkdownChunk';
import { AIMarkdown } from './AIMarkdown';
import { AIMarkdownDocuments } from './documents';

/** Pipeline runs per session, in session creation (= chunk setup) order.
 * The wrapper is transparent; it only counts `parse` calls. */
const parseCounts: number[] = [];
vi.mock('@ai-markdown/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@ai-markdown/core')>();
  return {
    ...core,
    createPipelineSession: () => {
      const session = core.createPipelineSession();
      const index = parseCounts.push(0) - 1;
      return {
        reset: () => session.reset(),
        parse: (options: Parameters<typeof session.parse>[0]) => {
          parseCounts[index] += 1;
          return session.parse(options);
        },
      };
    },
  };
});

interface HostNode {
  parent: HostNode | null;
  children: HostNode[];
  text: string;
  tag?: string;
  props: Record<string, unknown>;
}
const node = (text = ''): HostNode => ({ parent: null, children: [], text, props: {} });
const host = createRenderer<HostNode, HostNode>({
  createElement: (tag) => ({ ...node(), tag }),
  createText: node,
  createComment: node,
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.text = text;
    n.children = [];
  },
  patchProp: (n, key, _prev, next) => {
    n.props[key] = next;
  },
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
const anchors = (n: HostNode): HostNode[] => [...(n.tag === 'a' ? [n] : []), ...n.children.flatMap(anchors)];
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
      clobberPrefix: 'doc-',
      enginePlugins: [],
      sanitizeSchema,
    },
    {
      content: '[^n]: Shared **body**\n\n[u]: https://example.com',
      documentId: 'doc',
      registry: first,
      preserveOrphanReferences: false,
      incrementalParse: true,
      clobberPrefix: 'doc-',
      enginePlugins: [],
      sanitizeSchema,
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
        clobberPrefix: 'ssr-',
        enginePlugins: [],
        sanitizeSchema,
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

test('standalone chunks skip the definition-label scan until a registry is supplied', async () => {
  const registry = createRegistry();
  const input = shallowRef<ChunkInput>({
    content: 'Claim[^n] and [site][u].\n\n[^n]: body\n\n[u]: https://example.com',
    documentId: 'doc',
    registry: null,
    preserveOrphanReferences: false,
    incrementalParse: true,
    clobberPrefix: 'doc-',
    enginePlugins: [],
    sanitizeSchema,
  });
  let chunk!: ReturnType<typeof useMarkdownChunk>;
  const Probe = defineComponent({
    setup() {
      chunk = useMarkdownChunk(() => input.value);
      return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
    },
  });
  const app = host.createApp({ render: () => h(Probe) });
  try {
    app.mount(node());
    await settle();
    // Nobody reads the labels without a registry, so the second parse that
    // produces them is skipped and the frame carries stable empty sets.
    expect(chunk.prepared.value.ownLabels.footnoteLabels.size).toBe(0);
    expect(chunk.prepared.value.ownLabels.linkLabels.size).toBe(0);
    expect(JSON.stringify(chunk.prepared.value.trees.hast)).toContain('body');
    const standaloneLabels = chunk.prepared.value.ownLabels;
    input.value = { ...input.value, content: input.value.content + '\n\nMore prose.' };
    await settle();
    expect(chunk.prepared.value.ownLabels).toBe(standaloneLabels);
    // Coordinating later scans the full current content and registers it.
    input.value = { ...input.value, registry };
    await settle();
    expect(chunk.prepared.value.ownLabels.footnoteLabels.has('N')).toBe(true);
    expect(chunk.prepared.value.ownLabels.linkLabels.has('U')).toBe(true);
    expect(registry.chunkOrder).toHaveLength(1);
    expect(registry.globalNumber('N')).toBe(1);
    expect(registry.resolveLinkDef('U')?.url).toBe('https://example.com');
    input.value = { ...input.value, registry: null };
    await settle();
    expect(registry.chunkData.size).toBe(0);
    expect(chunk.prepared.value.ownLabels.footnoteLabels.size).toBe(0);
  } finally {
    app.unmount();
  }
  await settle();
  expect(registry._subscribers.size).toBe(0);
});

describe('chunk identity without crypto.randomUUID', () => {
  const realCrypto = globalThis.crypto;
  const setCrypto = (value: unknown) =>
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
  afterEach(() => {
    setCrypto(realCrypto);
    vi.restoreAllMocks();
  });
  const standalone = (): ChunkInput => ({
    content: 'Claim[^n] and [site][u].',
    documentId: 'doc',
    registry: null,
    preserveOrphanReferences: false,
    incrementalParse: false,
    clobberPrefix: 'doc-',
    enginePlugins: [],
    sanitizeSchema,
  });
  const Probe = defineComponent({
    props: { sink: { type: Array as () => string[], required: true } },
    setup(props) {
      const chunk = useMarkdownChunk(standalone);
      props.sink.push(chunk.provenance);
      return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
    },
  });

  test('a non-secure browser context (getRandomValues without randomUUID) mounts and SSR-renders', async () => {
    setCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mounted: string[] = [];
    const app = host.createApp({ render: () => h('main', [h(Probe, { sink: mounted }), h(Probe, { sink: mounted })]) });
    expect(() => app.mount(node())).not.toThrow();
    await settle();
    app.unmount();
    const server: string[] = [];
    const html = await renderToString(createSSRApp({ render: () => h(Probe, { sink: server }) }));
    expect(html).toContain('Claim');
    expect(mounted).toHaveLength(2);
    expect(mounted[0]).not.toBe(mounted[1]);
    for (const value of [...mounted, ...server]) expect(value).toMatch(/^[0-9a-f]{32}$/);
    expect(error).not.toHaveBeenCalled();
  });

  test('a runtime without Web Crypto falls back to a unique value and reports it once per instance', async () => {
    setCrypto(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mounted: string[] = [];
    const app = host.createApp({ render: () => h('main', [h(Probe, { sink: mounted }), h(Probe, { sink: mounted })]) });
    expect(() => app.mount(node())).not.toThrow();
    await settle();
    app.unmount();
    expect(mounted).toHaveLength(2);
    expect(mounted[0]).not.toBe(mounted[1]);
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0][0])).toContain('getRandomValues');
  });

  test('registry registrations stay distinct per instance without randomUUID', async () => {
    setCrypto(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = createRegistry();
    const Chunk = defineComponent({
      setup() {
        const chunk = useMarkdownChunk(() => ({ ...standalone(), registry }));
        return () => h('pre', JSON.stringify(chunk.prepared.value.trees.hast));
      },
    });
    const app = host.createApp({ render: () => h('main', [h(Chunk), h(Chunk)]) });
    app.mount(node());
    await settle();
    expect(registry.chunkOrder).toHaveLength(2);
    expect(registry.chunkOrder[0]).not.toBe(registry.chunkOrder[1]);
    app.unmount();
    await settle();
    expect(registry.chunkData.size).toBe(0);
    expect(registry._subscribers.size).toBe(0);
  });
});

describe('registry notifications do not re-run unaffected chunk pipelines', () => {
  for (const incrementalParse of [true, false]) {
    test(`incrementalParse=${incrementalParse}: one append runs only the appended chunk`, async () => {
      parseCounts.length = 0;
      const chunks = shallowRef([
        'Intro with a [site][u] link and a claim[^n].',
        'Second section, plain prose.',
        'Third section, plain prose.',
        '[^n]: Shared footnote body',
        'Tail with a claim[^n].',
      ]);
      // Render-function executions per chunk: the vnode update hook fires
      // once per re-render of the component. Hooks and slot objects are
      // created once and the slots marked stable; otherwise every parent
      // render would force every child to update and hide what the registry
      // alone triggers.
      const renders: number[] = chunks.value.map(() => 0);
      const updated = chunks.value.map((_, index) => () => {
        renders[index] += 1;
      });
      const slots = chunks.value.map(() => ({ $stable: true }));
      const app = host.createApp({
        render: () =>
          h(AIMarkdownDocuments, null, {
            $stable: true,
            default: () =>
              chunks.value.map((content, index) =>
                h(
                  AIMarkdown,
                  {
                    key: index,
                    content,
                    documentId: 'doc',
                    documentIndex: index,
                    incrementalParse,
                    onVnodeUpdated: updated[index],
                  },
                  slots[index]
                )
              ),
          }),
      });
      const delta = (now: number[], before: number[]) => now.map((n, i) => n - before[i]);
      const root = node();
      try {
        app.mount(root);
        await settle();
        expect(anchors(root).map((a) => a.props.href)).not.toContain('https://example.com');
        const parsesAtMount = [...parseCounts];
        const rendersAtMount = [...renders];
        expect(parsesAtMount).toHaveLength(5);
        // A second reference appended to the last chunk changes its
        // contribution (ordered refs), so it publishes and the registry
        // notifies every chunk. No label changes anywhere: every other
        // chunk's phantom targets stay identity-stable and its frame is
        // kept, so only the appended chunk's session parses again.
        chunks.value = chunks.value.map((c, i) => (i === 4 ? c + ' And again[^n].' : c));
        await settle();
        expect(delta(parseCounts, parsesAtMount)).toEqual([0, 0, 0, 0, 1]);
        // The notification carries a new occurrence for [^n] in the last
        // chunk only; chunks whose resolved references did not change are
        // not re-rendered either. The last chunk renders for its append and
        // once more for the notification, which rebuilds the aggregate
        // footer it owns.
        expect(delta(renders, rendersAtMount)).toEqual([0, 0, 0, 0, 2]);
        const parsesBeforeDef = [...parseCounts];
        const rendersBeforeDef = [...renders];
        // A definition appended to the last chunk resolves chunk 0's link.
        // Chunk 0 legitimately parses again: its phantom targets change (the
        // label is no longer missing), so its frame must be rebuilt. The
        // last chunk parses twice: once for the append and once more after
        // its label set changes and it re-registers under a fresh symbol.
        // Chunks 1-3 reference nothing and stay untouched.
        chunks.value = chunks.value.map((c, i) => (i === 4 ? c + '\n\n[u]: https://example.com' : c));
        await settle();
        expect(delta(parseCounts, parsesBeforeDef)).toEqual([1, 0, 0, 0, 2]);
        // Chunk 0 re-renders once with the resolved link. The last chunk
        // re-renders for the append, the re-registration and each
        // notification of that churn, which rebuilds the footer it owns.
        const rendersAfterDef = delta(renders, rendersBeforeDef);
        expect(rendersAfterDef.slice(0, 4)).toEqual([1, 0, 0, 0]);
        expect(rendersAfterDef[4]).toBeGreaterThanOrEqual(2);
        expect(anchors(root).map((a) => a.props.href)).toContain('https://example.com');
        const parsesBeforeMove = [...parseCounts];
        const rendersBeforeMove = [...renders];
        // Moving the destination changes no label set, so no phantom target
        // moves and nobody but the edited chunk parses. Chunk 0 still shows
        // the destination, so the notification must re-render it (and only
        // it) with the new href.
        chunks.value = chunks.value.map((c) => c.replace('https://example.com', 'https://example.org'));
        await settle();

        expect(delta(parseCounts, parsesBeforeMove)).toEqual([0, 0, 0, 0, 1]);
        expect(delta(renders, rendersBeforeMove).slice(0, 4)).toEqual([1, 0, 0, 0]);
        expect(anchors(root).map((a) => a.props.href)).toContain('https://example.org');
      } finally {
        app.unmount();
      }
    });
  }
});
