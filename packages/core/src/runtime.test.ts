import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
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
