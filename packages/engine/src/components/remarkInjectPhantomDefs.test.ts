import { describe, test, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';
import {
  buildPhantomSuffix,
  phantomSuffixCloser,
  SENTINEL_LINK_URL,
  SENTINEL_FN_CONTENT,
} from './remarkInjectPhantomDefs';
import type { Root as MdastRoot } from 'mdast';

function parseAugmented(source: string, missingFootnotes: Set<string>, missingLinks: Set<string>): MdastRoot {
  const augmented = source + buildPhantomSuffix({ missingFootnotes, missingLinks });
  return unified().use(remarkParse).use(remarkGfm).parse(augmented) as MdastRoot;
}

describe('buildPhantomSuffix', () => {
  test('returns source unchanged when no labels missing', () => {
    expect(buildPhantomSuffix({ missingFootnotes: new Set(), missingLinks: new Set() })).toBe('');
  });

  test('appends sentinel link def for missing link label', () => {
    const out =
      'hello' +
      buildPhantomSuffix({
        missingFootnotes: new Set(),
        missingLinks: new Set(['X']),
      });
    expect(out.endsWith(`[X]: ${SENTINEL_LINK_URL}\n`)).toBe(true);
  });

  test('appends sentinel footnote def for missing footnote label', () => {
    const out =
      'hello' +
      buildPhantomSuffix({
        missingFootnotes: new Set(['X']),
        missingLinks: new Set(),
      });
    expect(out.endsWith(`[^X]: ${SENTINEL_FN_CONTENT}\n`)).toBe(true);
  });

  test('multi label batch', () => {
    const out =
      'hello' +
      buildPhantomSuffix({
        missingFootnotes: new Set(['A']),
        missingLinks: new Set(['B', 'C']),
      });
    expect(out).toContain(`[B]: ${SENTINEL_LINK_URL}`);
    expect(out).toContain(`[C]: ${SENTINEL_LINK_URL}`);
    expect(out).toContain(`[^A]: ${SENTINEL_FN_CONTENT}`);
  });
});

describe('buildPhantomSuffix integration with remark-parse', () => {
  test('linkReference is parsed when phantom def is appended', () => {
    const tree = parseAugmented('[click][X]', new Set(), new Set(['X']));
    let found = false;
    visit(tree, 'linkReference', (n) => {
      if ((n.identifier as string).toUpperCase() === 'X') found = true;
    });
    expect(found).toBe(true);
  });

  test('footnoteReference is parsed when phantom footnote def is appended', () => {
    const tree = parseAugmented('See [^X].', new Set(['X']), new Set());
    let found = false;
    visit(tree, 'footnoteReference', () => {
      found = true;
    });
    expect(found).toBe(true);
  });

  test('without augmentation, orphan ref is dropped to literal text', () => {
    const tree = parseAugmented('See [^X].', new Set(), new Set());
    let found = false;
    visit(tree, 'footnoteReference', () => {
      found = true;
    });
    expect(found).toBe(false); // micromark dropped the ref
  });
});

describe('phantomSuffixCloser (core-render-01: suffix swallowed by an open fence/math block)', () => {
  const SUFFIX = buildPhantomSuffix({ missingFootnotes: new Set(['F']), missingLinks: new Set(['X']) });
  const parse = (src: string): MdastRoot =>
    unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src) as MdastRoot;

  /** Every top-level or nested definition identifier in the tree. */
  function defIds(root: MdastRoot): string[] {
    const ids: string[] = [];
    visit(root, (n) => {
      if (n.type === 'definition') ids.push((n as { identifier: string }).identifier);
      if (n.type === 'footnoteDefinition') ids.push('^' + (n as { identifier: string }).identifier);
    });
    return ids.sort();
  }
  /** Value of the first code/math node (the block being streamed). */
  function blockValue(root: MdastRoot): string | null {
    let v: string | null = null;
    visit(root, (n) => {
      if (v === null && (n.type === 'code' || n.type === 'math')) v = (n as { value: string }).value;
    });
    return v;
  }
  /** The contract: closer + suffix registers both phantom defs AND leaves
   *  the streamed block's value exactly as the bare content parses it. */
  function expectClosedAndNeutral(content: string, swallowedWithout = true): void {
    const closer = phantomSuffixCloser(content);
    expect(closer, `closer for ${JSON.stringify(content)}`).not.toBe('');
    const bare = parse(content);
    const augmented = parse(content + closer + SUFFIX);
    expect(defIds(augmented)).toEqual(['^f', 'x']);
    expect(blockValue(augmented)).toBe(blockValue(bare));
    // Sanity: without the closer the suffix really is swallowed (the bug) —
    // except inside a list item, where the column-0 suffix already ends the
    // item (and the block with it); the closer is merely neutral there.
    expect(defIds(parse(content + SUFFIX))).toEqual(swallowedWithout ? [] : ['^f', 'x']);
  }

  test('open backtick fence, with and without a trailing newline', () => {
    expectClosedAndNeutral('intro\n\n```js\nconst a = 1;');
    expectClosedAndNeutral('intro\n\n```js\nconst a = 1;\n');
    expectClosedAndNeutral('intro\n\n```js\nconst a = 1;\n\n');
    expect(phantomSuffixCloser('intro\n\n```js\nconst a = 1;')).toBe('\n```');
    expect(phantomSuffixCloser('intro\n\n```js\nconst a = 1;\n')).toBe('```');
  });

  test('longer / tilde fences close with a matching run', () => {
    expectClosedAndNeutral('x\n\n`````md\n```js\ninner\n```\n');
    expect(phantomSuffixCloser('x\n\n`````md\n```js\ninner\n```\n')).toBe('`````');
    expectClosedAndNeutral('x\n\n~~~~\nfoo');
    expect(phantomSuffixCloser('x\n\n~~~~\nfoo')).toBe('\n~~~~');
  });

  test('open $$ flow math (remark-math swallows to EOF)', () => {
    expectClosedAndNeutral('intro\n\n$$\ne = mc^2');
    expectClosedAndNeutral('intro\n\n$$\ne = mc^2\n');
    expect(phantomSuffixCloser('intro\n\n$$\ne = mc^2')).toBe('\n$$');
    // A 4-dollar opener needs a ≥4-dollar closer.
    expectClosedAndNeutral('intro\n\n$$$$\ne = mc^2\n');
    expect(phantomSuffixCloser('intro\n\n$$$$\ne = mc^2\n')).toBe('$$$$');
  });

  test('a fence opened INSIDE a list item is closed at the opener indent (a column-0 closer would open a new block)', () => {
    const content = '- item\n\n  ```js\n  code';
    expect(phantomSuffixCloser(content)).toBe('\n  ```');
    expectClosedAndNeutral(content, false);
    // Same rule for math in a list item.
    const math = '- item\n\n  $$\n  e = mc^2\n';
    expect(phantomSuffixCloser(math)).toBe('  $$');
    expectClosedAndNeutral(math, false);
    // Regression guard for the failure mode: a column-0 closer ends the
    // item and OPENS a fresh fence around the suffix.
    const bad = parse(content + '\n```' + SUFFIX);
    expect(defIds(bad)).toEqual([]);
  });

  test('a top-level fence with 1-3 spaces of indent is closed at that indent', () => {
    const content = 'para\n\n   ```js\n   code';
    expect(phantomSuffixCloser(content)).toBe('\n   ```');
    expectClosedAndNeutral(content);
  });

  test('nothing to close → empty string (no scan side effects on plain content)', () => {
    for (const content of ['', 'plain prose', 'para\n\n```js\ncode\n```\n', '$$\nx\n$$\n\ntail', 'a\n\n> ```\n> q']) {
      expect(phantomSuffixCloser(content), JSON.stringify(content)).toBe('');
      // The plain suffix registers the defs on its own here.
      expect(defIds(parse(content + SUFFIX))).toEqual(['^f', 'x']);
    }
  });

  test('a fence line glued to an html-flow run poisons the phase → no closer (status quo, never a wrong one)', () => {
    // `<embed` is an ambiguous starter: whether the ``` line is raw text or
    // a real fence is container-dependent, so the scanner refuses to guess.
    expect(phantomSuffixCloser('<embed\n```js\ncode')).toBe('');
  });

  test('CRLF content ends with a newline → closer without a leading newline', () => {
    expect(phantomSuffixCloser('a\r\n\r\n```js\r\ncode\r\n')).toBe('```');
  });
});
