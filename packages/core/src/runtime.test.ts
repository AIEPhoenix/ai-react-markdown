import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { visit } from 'unist-util-visit';
import {
  buildCoreRemarkPlugins,
  buildCoreRehypePlugins,
  buildCoreRemarkRehypeOptions,
  collectDefLabels,
  createRegistry,
  parseStage,
  sanitizeSchema,
  transformStage,
} from '@ai-markdown/engine';
import {
  buildAggregateTree,
  createBlockPlanner,
  createContributionSession,
  createPipelineSession,
  deriveTailSignal,
  type PipelineFrameOptions,
} from './index';

const prefix = 'runtime-test-';
const options: PipelineFrameOptions = {
  content: '',
  targetPhantoms: { missingFootnotes: new Set(), missingLinks: new Set() },
  remarkPlugins: buildCoreRemarkPlugins([]),
  rehypePlugins: buildCoreRehypePlugins(sanitizeSchema, prefix),
  remarkRehypeOptions: buildCoreRemarkRehypeOptions(false),
  preserveForBodyHarvest: false,
  documentId: 'headless',
  provenance: 'runtime-test',
  incrementalParse: true,
  defListEnabled: false,
};

function full(content: string) {
  const parsed = parseStage({ ...options, children: content });
  return { mdast: parsed.mdast, hast: transformStage(parsed) };
}

describe('framework-neutral pipeline consumer', () => {
  test('incremental frames match an independent full engine parse, including rewrites', () => {
    const session = createPipelineSession();
    const plan = createBlockPlanner();
    const source = 'Opening.\n\nSecond.\n\nClaim[^n].\n\n[^n]: Note with **formatting**\n\nTail.';
    for (let length = 1; length <= source.length; length++) {
      const content = source.slice(0, length);
      const actual = session.parse({ ...options, content });
      expect(actual).toEqual(full(content));
      const items = plan(actual.mdast, actual.hast, content).plan;
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    }
    for (const content of [source, source.replace('Opening', 'Rewritten'), 'Replacement']) {
      expect(session.parse({ ...options, content })).toEqual(full(content));
    }
  });

  test('reset and a one-shot frame both discard retained parse trees', () => {
    const session = createPipelineSession();
    const content = 'First.\n\nSecond.\n\n';
    const a = session.parse({ ...options, content });
    const b = session.parse({ ...options, content: content + 'Tail.\n\n' });
    expect(b.mdast.children[0]).toBe(a.mdast.children[0]);
    session.reset();
    const c = session.parse({ ...options, content: content + 'Tail.\n\n' });
    expect(c.mdast.children[0]).not.toBe(b.mdast.children[0]);
    session.parse({ ...options, content, incrementalParse: false });
    const d = session.parse({ ...options, content: content + 'Tail.\n\n' });
    expect(d.mdast.children[0]).not.toBe(c.mdast.children[0]);
    expect(d).toEqual(full(content + 'Tail.\n\n'));
  });

  test('a failed incremental frame falls back and the following frame starts clean', () => {
    const session = createPipelineSession();
    const content = 'First.\n\nSecond.\n\n';
    session.parse({ ...options, content });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failed = false;
    try {
      const actual = session.parse({
        ...options,
        content: content + 'Tail.',
        measure: (stage, fn) => {
          if (stage === 'scan' && !failed) {
            failed = true;
            throw new Error('injected scan failure');
          }
          return fn();
        },
      });
      expect(failed).toBe(true);
      expect(actual).toEqual(full(content + 'Tail.'));
      expect(session.parse({ ...options, content: content + 'Tail grows.' })).toEqual(full(content + 'Tail grows.'));
    } finally {
      error.mockRestore();
    }
  });

  test('a full parse that throws renders the content as one plain-text paragraph instead of crashing', () => {
    // Thousands of nested raw `<div>` tags overflow the recursive
    // hast-util-from-parse5 walk (RangeError: Maximum call stack size
    // exceeded) inside rehype-raw. The incremental path's fallback IS the
    // full parse, so nothing above it caught the throw and the adapter
    // subtree crashed. The session now degrades one hostile message to
    // plain text and keeps the surface alive.
    const content = '<div>'.repeat(3000) + 'x';
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => full(content)).toThrow(RangeError);
      for (const incremental of [true, false]) {
        const session = createPipelineSession();
        const trees = session.parse({ ...options, content, incrementalParse: incremental });
        expect(trees.mdast.type).toBe('root');
        expect(trees.hast.type).toBe('root');
        expect(trees.hast.children).toHaveLength(1);
        const p = trees.hast.children[0];
        expect(p.type === 'element' && p.tagName).toBe('p');
        expect(p.type === 'element' && p.children).toEqual([
          { type: 'text', value: content, position: expect.anything() },
        ]);
        expect(p.position).toEqual({
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: content.length + 1, offset: content.length },
        });
        expect(trees.mdast.children).toEqual([
          {
            type: 'paragraph',
            children: [{ type: 'text', value: content, position: p.position }],
            position: p.position,
          },
        ]);
        // The plan can be built from the fallback trees too.
        const items = createBlockPlanner()(trees.mdast, trees.hast, content).plan;
        expect(items.map((item) => item.key)).toEqual(['block-0']);
        // The next healthy frame parses normally again.
        expect(session.parse({ ...options, content: 'Recovered.', incrementalParse: incremental })).toEqual(
          full('Recovered.')
        );
      }
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test('contributions publish at explicit commit and invalidate on policy or registration changes', () => {
    const registry = createRegistry();
    const content = 'Claim[^a].\n\n[^a]: Shared **body**';
    const ownLabels = collectDefLabels(content);
    const sym = registry.registerChunk('first', ownLabels.footnoteLabels, ownLabels.linkLabels);
    const pipeline = createPipelineSession().parse({ ...options, content, incrementalParse: false });
    const session = createContributionSession();
    const commitOptions = {
      pipeline,
      ownLabels,
      registry,
      targetPhantoms: options.targetPhantoms,
      sym,
      clobberPrefix: prefix,
      chain: [options.remarkPlugins, options.rehypePlugins],
    };
    // Preparing a parse and allocating a publisher have no publication effect.
    expect(registry.globalNumber('A')).toBeNull();
    session.commit({ ...commitOptions, sym: null });
    expect(registry.globalNumber('A')).toBeNull();
    session.commit(commitOptions);
    expect(registry.globalNumber('A')).toBe(1);
    const version = registry.version;
    session.commit({ ...commitOptions, pipeline: full(content) });
    expect(registry.version).toBe(version);
    session.commit({ ...commitOptions, chain: [Symbol('changed policy')] });
    expect(registry.version).toBeGreaterThan(version);
    const other = createRegistry();
    const otherSym = other.registerChunk('other', ownLabels.footnoteLabels, ownLabels.linkLabels);
    session.commit({ ...commitOptions, registry: other, sym: otherSym });
    expect(other.globalNumber('A')).toBe(1);
    expect(deriveTailSignal(pipeline.mdast, content.length)).toEqual({ kind: 'footnote-def', identifier: 'a' });
  });

  test('a link definition nested inside a footnote body is published for sibling chunks', () => {
    // PASS 0 claims the nested label (so a sibling phantom-injects `[x]`);
    // the publisher must contribute the definition or the sibling's
    // placeholder never resolves.
    const registry = createRegistry();
    const content = '[^a]: see [x]\n\n    [x]: /url "T"\n\nflow [^a]\n';
    const ownLabels = collectDefLabels(content);
    expect([...ownLabels.linkLabels]).toEqual(['X']);
    const sym = registry.registerChunk('owner', ownLabels.footnoteLabels, ownLabels.linkLabels);
    expect([...registry.labelSet.linkLabels]).toEqual(['X']);
    createContributionSession().commit({
      pipeline: full(content),
      ownLabels,
      registry,
      targetPhantoms: options.targetPhantoms,
      sym,
      clobberPrefix: prefix,
      chain: [],
    });
    expect(registry.canonicalLinkFor('X')).toBe(sym);
    expect(registry.resolveLinkDef('x')).toEqual({ identifier: 'X', url: '/url', title: 'T' });
    // The `[x]` inside the body is not a flow ref of the chunk.
    expect(registry.chunkData.get(sym)!.refs).toEqual([{ label: 'A', kind: 'footnote', referenceType: undefined }]);
  });

  test('a footnote referenced only from another footnote body reaches the aggregate with standalone numbering', () => {
    // Standalone renders B (referenced only inside A's body) as footnote 2.
    // Contributions used to skip definition bodies, so B had no global
    // number and the coordinated footer dropped it.
    const registry = createRegistry();
    const content = 'flow [^a]\n\n[^a]: see [^b]\n\n[^b]: B body\n';
    const ownLabels = collectDefLabels(content);
    const sym = registry.registerChunk('chunk', ownLabels.footnoteLabels, ownLabels.linkLabels);
    const pipeline = full(content);
    createContributionSession().commit({
      pipeline,
      ownLabels,
      registry,
      targetPhantoms: options.targetPhantoms,
      sym,
      clobberPrefix: prefix,
      chain: [],
    });
    expect(registry.chunkData.get(sym)!.refs).toEqual([
      { label: 'A', kind: 'footnote', referenceType: undefined },
      { label: 'B', kind: 'footnote', referenceType: undefined, nestedIn: 'A' },
    ]);
    expect([registry.globalNumber('A'), registry.globalNumber('B')]).toEqual([1, 2]);
    expect([registry.getRefsForLabel('A'), registry.getRefsForLabel('B')]).toEqual([1, 0]);

    const tree = buildAggregateTree(registry, prefix)!;
    const items: [string, string, string[]][] = [];
    const markIds = new Set<string>();
    visit(tree, 'element', (node) => {
      if (typeof node.properties.id === 'string' && node.tagName === 'a') markIds.add(node.properties.id);
      if (node.tagName !== 'li') return;
      const backrefs: string[] = [];
      visit(node, 'element', (inner) => {
        if (inner.properties.dataFootnoteBackref !== undefined) backrefs.push(String(inner.properties.href));
      });
      items.push([String(node.properties.id), String(node.properties.value), backrefs]);
    });
    // Same entries, in the same order, as the standalone footer.
    const standalone: [string, string[]][] = [];
    visit(pipeline.hast, 'element', (node) => {
      if (node.tagName !== 'li') return;
      const backrefs: string[] = [];
      visit(node, 'element', (inner) => {
        if (inner.properties.dataFootnoteBackref !== undefined) backrefs.push(String(inner.properties.href));
      });
      standalone.push([String(node.properties.id), backrefs]);
    });
    expect(standalone).toEqual([
      [`${prefix}fn-a`, [`#${prefix}fnref-a`]],
      [`${prefix}fn-b`, [`#${prefix}fnref-b`]],
    ]);
    expect(items).toEqual([
      [`${prefix}fn-a`, '1', [`#${prefix}fnref-a`]],
      [`${prefix}fn-b`, '2', [`#${prefix}fnref-b`]],
    ]);
    // Every backref in the aggregate points at a mark that exists: A's in
    // flow text (outside the tree), B's inside A's harvested body.
    expect(markIds.has(`${prefix}fnref-b`)).toBe(true);
    expect(JSON.stringify(tree)).not.toContain('fnref-b-2');
  });

  test('an authored raw footnote section or list item is content, not a harvested body', () => {
    // The synthesized footer has no source position; an author's raw
    // `<section data-footnotes>` comes out of rehype-raw with one. A raw
    // `<li id="fn-a">` inside a body is hoisted out of the footer's `<li>` by
    // HTML parsing (it becomes the next `<ol>` sibling) and sanitize gives it
    // the same clobbered id as the generated item. Neither may replace the
    // definition body the aggregate renders.
    const registry = createRegistry();
    const content =
      '<section data-footnotes><ol><li id="fn-a">authored</li></ol></section>\n\n' +
      'flow [^a]\n\n[^a]: real <li id="fn-a">stomp</li>\n';
    const ownLabels = collectDefLabels(content);
    const sym = registry.registerChunk('chunk', ownLabels.footnoteLabels, ownLabels.linkLabels);
    const pipeline = full(content);
    // Premise: the authored section item and the hoisted item both carry
    // the generated id, so only the position rule and the first-wins rule
    // tell them apart from the real item.
    const liIds: string[] = [];
    visit(pipeline.hast, 'element', (node) => {
      if (node.tagName === 'li') liIds.push(String(node.properties.id));
    });
    expect(liIds).toEqual([`${prefix}fn-a`, `${prefix}fn-a`, `${prefix}fn-a`]);
    createContributionSession().commit({
      pipeline,
      ownLabels,
      registry,
      targetPhantoms: options.targetPhantoms,
      sym,
      clobberPrefix: prefix,
      chain: [],
    });
    const body = JSON.stringify(registry.chunkData.get(sym)!.defs.get('A')!.bodyHast);
    expect(body).toContain('real');
    expect(body).not.toContain('stomp');
    expect(body).not.toContain('authored');
    const tree = JSON.stringify(buildAggregateTree(registry, prefix));
    expect(tree).toContain('real');
    expect(tree).not.toContain('stomp');
    expect(tree).not.toContain('authored');
  });

  test('a label containing a valid percent-escape keeps its harvested body', () => {
    // `[^a%41]` is minted as `<li id="…fn-a%41">` (normalizeUri keeps a
    // well-formed escape). Decoding that id gave `aA`, which never matched
    // the registry key `A%41`, so the aggregate `<li>` rendered empty. Both
    // sides now key by the encoded fragment.
    const registry = createRegistry();
    const content =
      'Escaped[^a%41] and literal[^a%b] and cjk[^中文].\n\n[^a%41]: body 41\n\n[^a%b]: body b\n\n[^中文]: body cjk';
    const ownLabels = collectDefLabels(content);
    const sym = registry.registerChunk('chunk', ownLabels.footnoteLabels, ownLabels.linkLabels);
    createContributionSession().commit({
      pipeline: full(content),
      ownLabels,
      registry,
      targetPhantoms: options.targetPhantoms,
      sym,
      clobberPrefix: prefix,
      chain: [],
    });
    const defs = registry.chunkData.get(sym)!.defs;
    expect([...defs.keys()]).toEqual(['A%41', 'A%B', '中文']);
    for (const [label, text] of [
      ['A%41', 'body 41'],
      ['A%B', 'body b'],
      ['中文', 'body cjk'],
    ] as const) {
      expect(JSON.stringify(defs.get(label)!.bodyHast), label).toContain(text);
    }
    const encoded = JSON.stringify(buildAggregateTree(registry, prefix));
    expect(encoded).toContain(`${prefix}fn-a%41`);
    expect(encoded).toContain('body 41');
    expect(encoded).toContain(`${prefix}fn-a%25b`);
    expect(encoded).toContain('body b');
    expect(encoded).toContain('body cjk');
  });

  test('aggregating footnotes preserves registry bodies and gives every occurrence a backref', () => {
    const registry = createRegistry();
    const content = 'First[^a] and again[^a].\n\n[^a]: Shared **body**';
    const ownLabels = collectDefLabels(content);
    const sym = registry.registerChunk('chunk', ownLabels.footnoteLabels, ownLabels.linkLabels);
    createContributionSession().commit({
      pipeline: full(content),
      ownLabels,
      registry,
      targetPhantoms: options.targetPhantoms,
      sym,
      clobberPrefix: prefix,
      chain: [],
    });
    const before = JSON.stringify(registry.chunkData.get(sym)?.defs.get('A')?.bodyHast);
    const tree = buildAggregateTree(registry, prefix);
    const encoded = JSON.stringify(tree);
    expect(encoded).toContain(`${prefix}fnref-a`);
    expect(encoded).toContain(`${prefix}fnref-a-2`);
    expect(encoded).toContain('Shared ');
    expect(JSON.stringify(registry.chunkData.get(sym)?.defs.get('A')?.bodyHast)).toBe(before);
    expect(buildAggregateTree(registry, prefix)).toEqual(tree);
  });
});

// An actual Node consumer of each distribution entry. Reject framework
// resolution transitively; importing the root must also work without DOM globals.
for (const entry of ['index.js', 'index.cjs', 'index.dev.js', 'index.dev.cjs']) {
  test(`headless distribution entry ${entry} never loads a UI framework`, () => {
    const entryPath = fileURLToPath(new URL(`../dist/${entry}`, import.meta.url));
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { registerHooks } from 'node:module';
      import { pathToFileURL } from 'node:url';
      import assert from 'node:assert/strict';
      registerHooks({ resolve(specifier, context, next) {
        if (/^(react|react-dom|vue|svelte|solid-js)(\\/|$)/.test(specifier) ||
            /^@ai-markdown\\/(react|react-mantine)(\\/|$)/.test(specifier)) {
          throw new Error('Framework dependency: ' + specifier);
        }
        return next(specifier, context);
      }});
      assert.equal(typeof window, 'undefined');
      assert.equal(typeof document, 'undefined');
      const runtime = await import(pathToFileURL(process.argv[1]).href);
      const frame = runtime.createPipelineSession().parse({
        content: '**Headless**', targetPhantoms: { missingFootnotes: new Set(), missingLinks: new Set() },
        preserveForBodyHarvest: false, documentId: 'node', provenance: 'node',
        incrementalParse: false, defListEnabled: false,
      });
      assert.equal(frame.hast.children[0].tagName, 'p');
      assert.equal(runtime.createBlockPlanner()(frame.mdast, frame.hast, '**Headless**').plan[0].key, 'block-0');
      const queue = runtime.createSmoothCoordinator();
      queue.register('a'); queue.register('b');
      assert.equal(queue.isReleased('b'), false);
      queue.markDone('a'); assert.equal(queue.isReleased('b'), true);
    `,
        entryPath,
      ],
      { stdio: 'pipe' }
    );
  });
}
