/**
 * Ported 1:1 from react-markdown v10's `test.jsx` — only the synchronous
 * `Markdown` suite. The `MarkdownAsync` and `MarkdownHooks` suites are
 * intentionally skipped: this library never went down those paths.
 *
 * Mechanical translation: `node:test` → vitest, `assert.equal` → `expect.toBe`,
 * `assert.deepEqual` → `expect.toEqual`, `assert.throws(fn, re)` →
 * `expect(fn).toThrow(re)`. Test descriptions and assertions are otherwise
 * verbatim.
 *
 * @see https://github.com/remarkjs/react-markdown/blob/main/test.jsx
 */

/* eslint-disable react/no-unescaped-entities */

import type { Root } from 'hast';
import { renderToStaticMarkup } from 'react-dom/server';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkToc from 'remark-toc';
import { visit } from 'unist-util-visit';
import { describe, expect, test } from 'vitest';
import Markdown, { defaultUrlTransform } from '../index';
import type { ExtraProps } from '../index';
import type { ComponentProps } from 'react';

describe('local Markdown wrapper (core)', () => {
  test('should expose the public api', async () => {
    expect(Object.keys(await import('../index')).sort()).toEqual([
      'Markdown',
      'default',
      'defaultUrlTransform',
      'parseStage',
      'renderHastSubtree',
      'transformStage',
    ]);
  });
});

describe('Markdown', () => {
  test('should work', () => {
    expect(renderToStaticMarkup(<Markdown children="a" />)).toBe('<p>a</p>');
  });

  test('should throw w/ `source`', () => {
    expect(() => {
      // @ts-expect-error: check how the runtime handles untyped `source`.
      renderToStaticMarkup(<Markdown source="a" />);
    }).toThrow(/Unexpected `source` prop, use `children` instead/);
  });

  test('should throw w/ non-string children (number)', () => {
    expect(() => {
      // @ts-expect-error: check how the runtime handles invalid `children`.
      renderToStaticMarkup(<Markdown children={1} />);
    }).toThrow(/Unexpected value `1` for `children` prop, expected `string`/);
  });

  test('should throw w/ non-string children (boolean)', () => {
    expect(() => {
      // @ts-expect-error: check how the runtime handles invalid `children`.
      renderToStaticMarkup(<Markdown children={true} />);
    }).toThrow(/Unexpected value `true` for `children` prop, expected `string`/);
  });

  test('should support `null` as children', () => {
    expect(renderToStaticMarkup(<Markdown children={null} />)).toBe('');
  });

  test('should support `undefined` as children', () => {
    expect(renderToStaticMarkup(<Markdown children={undefined} />)).toBe('');
  });

  test('should warn w/ `allowDangerousHtml`', () => {
    expect(() => {
      // @ts-expect-error: check how the runtime handles deprecated `allowDangerousHtml`.
      renderToStaticMarkup(<Markdown allowDangerousHtml />);
    }).toThrow(/Unexpected `allowDangerousHtml` prop, remove it/);
  });

  test('should support a block quote', () => {
    expect(renderToStaticMarkup(<Markdown children="> a" />)).toBe('<blockquote>\n<p>a</p>\n</blockquote>');
  });

  test('should support a break', () => {
    expect(renderToStaticMarkup(<Markdown children={'a\\\nb'} />)).toBe('<p>a<br/>\nb</p>');
  });

  test('should support a code (block, flow; indented)', () => {
    expect(renderToStaticMarkup(<Markdown children="    a" />)).toBe('<pre><code>a\n</code></pre>');
  });

  test('should support a code (block, flow; fenced)', () => {
    expect(renderToStaticMarkup(<Markdown children={'```js\na\n```'} />)).toBe(
      '<pre><code class="language-js">a\n</code></pre>'
    );
  });

  test('should support a delete (GFM)', () => {
    expect(renderToStaticMarkup(<Markdown children="~a~" remarkPlugins={[remarkGfm]} />)).toBe('<p><del>a</del></p>');
  });

  test('should support an emphasis', () => {
    expect(renderToStaticMarkup(<Markdown children="*a*" />)).toBe('<p><em>a</em></p>');
  });

  test('should support a footnote (GFM)', () => {
    expect(renderToStaticMarkup(<Markdown children={'a[^x]\n\n[^x]: y'} remarkPlugins={[remarkGfm]} />)).toBe(
      '<p>a<sup><a href="#user-content-fn-x" id="user-content-fnref-x" data-footnote-ref="true" aria-describedby="footnote-label">1</a></sup></p>\n<section data-footnotes="true" class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2>\n<ol>\n<li id="user-content-fn-x">\n<p>y <a href="#user-content-fnref-x" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>'
    );
  });

  test('should support a heading', () => {
    expect(renderToStaticMarkup(<Markdown children="# a" />)).toBe('<h1>a</h1>');
  });

  test('should support an html (default)', () => {
    expect(renderToStaticMarkup(<Markdown children="<i>a</i>" />)).toBe('<p>&lt;i&gt;a&lt;/i&gt;</p>');
  });

  test('should support an html (w/ `rehype-raw`)', () => {
    expect(renderToStaticMarkup(<Markdown children="<i>a</i>" rehypePlugins={[rehypeRaw]} />)).toBe('<p><i>a</i></p>');
  });

  test('should support an image', () => {
    expect(renderToStaticMarkup(<Markdown children="![a](b)" />)).toBe(
      // Note: React weirdly adds `rel="preload"`.
      '<link rel="preload" as="image" href="b"/><p><img src="b" alt="a"/></p>'
    );
  });

  test('should support an image w/ a title', () => {
    expect(renderToStaticMarkup(<Markdown children="![a](b (c))" />)).toBe(
      '<link rel="preload" as="image" href="b"/><p><img src="b" alt="a" title="c"/></p>'
    );
  });

  test('should support an image reference / definition', () => {
    expect(renderToStaticMarkup(<Markdown children={'![a]\n\n[a]: b'} />)).toBe(
      '<link rel="preload" as="image" href="b"/><p><img src="b" alt="a"/></p>'
    );
  });

  test('should support code (text, inline)', () => {
    expect(renderToStaticMarkup(<Markdown children="`a`" />)).toBe('<p><code>a</code></p>');
  });

  test('should support a link', () => {
    expect(renderToStaticMarkup(<Markdown children="[a](b)" />)).toBe('<p><a href="b">a</a></p>');
  });

  test('should support a link w/ a title', () => {
    expect(renderToStaticMarkup(<Markdown children="[a](b (c))" />)).toBe('<p><a href="b" title="c">a</a></p>');
  });

  test('should support a link reference / definition', () => {
    expect(renderToStaticMarkup(<Markdown children={'[a]\n\n[a]: b'} />)).toBe('<p><a href="b">a</a></p>');
  });

  test('should support prototype poluting identifiers', () => {
    expect(
      renderToStaticMarkup(<Markdown children={'[][__proto__] [][constructor]\n\n[__proto__]: a\n[constructor]: b'} />)
    ).toBe('<p><a href="a"></a> <a href="b"></a></p>');
  });

  test('should support duplicate definitions', () => {
    expect(renderToStaticMarkup(<Markdown children={'[a][]\n\n[a]: b\n[a]: c'} />)).toBe('<p><a href="b">a</a></p>');
  });

  test('should support a list (unordered) / list item', () => {
    expect(renderToStaticMarkup(<Markdown children="* a" />)).toBe('<ul>\n<li>a</li>\n</ul>');
  });

  test('should support a list (ordered) / list item', () => {
    expect(renderToStaticMarkup(<Markdown children="1. a" />)).toBe('<ol>\n<li>a</li>\n</ol>');
  });

  test('should support a paragraph', () => {
    expect(renderToStaticMarkup(<Markdown children="a" />)).toBe('<p>a</p>');
  });

  test('should support a strong', () => {
    expect(renderToStaticMarkup(<Markdown children="**a**" />)).toBe('<p><strong>a</strong></p>');
  });

  test('should support a table (GFM)', () => {
    expect(renderToStaticMarkup(<Markdown children={'| a |\n| - |\n| b |'} remarkPlugins={[remarkGfm]} />)).toBe(
      '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'
    );
  });

  test('should support a table (GFM; w/ align)', () => {
    expect(
      renderToStaticMarkup(
        <Markdown children={'| a | b | c | d |\n| :- | :-: | -: | - |'} remarkPlugins={[remarkGfm]} />
      )
    ).toBe(
      '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:center">b</th><th style="text-align:right">c</th><th>d</th></tr></thead></table>'
    );
  });

  test('should support a thematic break', () => {
    expect(renderToStaticMarkup(<Markdown children="***" />)).toBe('<hr/>');
  });

  test('should support ab absolute path', () => {
    expect(renderToStaticMarkup(<Markdown children="[](/a)" />)).toBe('<p><a href="/a"></a></p>');
  });

  test('should support an absolute URL', () => {
    expect(renderToStaticMarkup(<Markdown children="[](http://a.com)" />)).toBe('<p><a href="http://a.com"></a></p>');
  });

  test('should support a URL w/ uppercase protocol', () => {
    expect(renderToStaticMarkup(<Markdown children="[](HTTPS://A.COM)" />)).toBe('<p><a href="HTTPS://A.COM"></a></p>');
  });

  test('should make a `javascript:` URL safe', () => {
    expect(renderToStaticMarkup(<Markdown children="[](javascript:alert(1))" />)).toBe('<p><a href=""></a></p>');
  });

  test('should make a `vbscript:` URL safe', () => {
    expect(renderToStaticMarkup(<Markdown children="[](vbscript:alert(1))" />)).toBe('<p><a href=""></a></p>');
  });

  test('should make a `VBSCRIPT:` URL safe', () => {
    expect(renderToStaticMarkup(<Markdown children="[](VBSCRIPT:alert(1))" />)).toBe('<p><a href=""></a></p>');
  });

  test('should make a `file:` URL safe', () => {
    expect(renderToStaticMarkup(<Markdown children="[](file:///etc/passwd)" />)).toBe('<p><a href=""></a></p>');
  });

  test('should allow an empty URL', () => {
    expect(renderToStaticMarkup(<Markdown children="[]()" />)).toBe('<p><a href=""></a></p>');
  });

  test('should support search (`?`) in a URL', () => {
    expect(renderToStaticMarkup(<Markdown children="[](a?javascript:alert(1))" />)).toBe(
      '<p><a href="a?javascript:alert(1)"></a></p>'
    );
  });

  test('should support hash (`&`) in a URL', () => {
    expect(renderToStaticMarkup(<Markdown children="[](a?b&c=d)" />)).toBe('<p><a href="a?b&amp;c=d"></a></p>');
  });

  test('should support hash (`#`) in a URL', () => {
    expect(renderToStaticMarkup(<Markdown children="[](a#javascript:alert(1))" />)).toBe(
      '<p><a href="a#javascript:alert(1)"></a></p>'
    );
  });

  test('should support `urlTransform` (`href` on `a`)', () => {
    expect(
      renderToStaticMarkup(
        <Markdown
          children="[a](https://b.com 'c')"
          urlTransform={(url, key, node) => {
            expect(url).toBe('https://b.com');
            expect(key).toBe('href');
            expect(node.tagName).toBe('a');
            return '';
          }}
        />
      )
    ).toBe('<p><a href="" title="c">a</a></p>');
  });

  test('should support `urlTransform` w/ empty URLs', () => {
    expect(
      renderToStaticMarkup(
        <Markdown
          children="[]()"
          urlTransform={(url, key, node) => {
            expect(url).toBe('');
            expect(key).toBe('href');
            expect(node.tagName).toBe('a');
            return '';
          }}
        />
      )
    ).toBe('<p><a href=""></a></p>');
  });

  test('should support `urlTransform` (`src` on `img`)', () => {
    expect(
      renderToStaticMarkup(
        <Markdown
          children="![a](https://b.com 'c')"
          urlTransform={(url, key, node) => {
            expect(url).toBe('https://b.com');
            expect(key).toBe('src');
            expect(node.tagName).toBe('img');
            return null;
          }}
        />
      )
    ).toBe('<p><img alt="a" title="c"/></p>');
  });

  test('should support `skipHtml`', () => {
    expect(renderToStaticMarkup(<Markdown children="a<i>b</i>c" skipHtml />)).toBe('<p>abc</p>');
  });

  test('should support `allowedElements` (drop unlisted nodes)', () => {
    expect(renderToStaticMarkup(<Markdown children={'# *a*\n* b'} allowedElements={['h1', 'li', 'ul']} />)).toBe(
      '<h1></h1>\n<ul>\n<li>b</li>\n</ul>'
    );
  });

  test('should support `allowedElements` as a function', () => {
    expect(
      renderToStaticMarkup(<Markdown children="*a* **b**" allowElement={(element) => element.tagName !== 'em'} />)
    ).toBe('<p> <strong>b</strong></p>');
  });

  test('should support `disallowedElements`', () => {
    expect(renderToStaticMarkup(<Markdown children={'# *a*\n* b'} disallowedElements={['em']} />)).toBe(
      '<h1></h1>\n<ul>\n<li>b</li>\n</ul>'
    );
  });

  test('should fail for both `allowedElements` and `disallowedElements`', () => {
    expect(() => {
      renderToStaticMarkup(<Markdown children="" allowedElements={['p']} disallowedElements={['a']} />);
    }).toThrow(/Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other/);
  });

  test('should support `unwrapDisallowed` w/ `allowedElements`', () => {
    expect(renderToStaticMarkup(<Markdown children="# *a*" unwrapDisallowed allowedElements={['h1']} />)).toBe(
      '<h1>a</h1>'
    );
  });

  test('should support `unwrapDisallowed` w/ `disallowedElements`', () => {
    expect(renderToStaticMarkup(<Markdown children="# *a*" unwrapDisallowed disallowedElements={['em']} />)).toBe(
      '<h1>a</h1>'
    );
  });

  test('should support `remarkRehypeOptions`', () => {
    expect(
      renderToStaticMarkup(
        <Markdown
          children={'[^x]\n\n[^x]: a\n\n'}
          remarkPlugins={[remarkGfm]}
          remarkRehypeOptions={{ clobberPrefix: 'b-' }}
        />
      )
    ).toBe(
      '<p><sup><a href="#b-fn-x" id="b-fnref-x" data-footnote-ref="true" aria-describedby="footnote-label">1</a></sup></p>\n<section data-footnotes="true" class="footnotes"><h2 class="sr-only" id="footnote-label">Footnotes</h2>\n<ol>\n<li id="b-fn-x">\n<p>a <a href="#b-fnref-x" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>'
    );
  });

  test('should support `components`', () => {
    expect(renderToStaticMarkup(<Markdown children="# a" components={{ h1: 'h2' }} />)).toBe('<h2>a</h2>');
  });

  test('should support `components` as functions', () => {
    expect(
      renderToStaticMarkup(
        <Markdown
          children="a"
          components={{
            p(props) {
              const { node, ...rest } = props;
              expect(rest).toEqual({ children: 'a' });
              return <div {...rest} />;
            },
          }}
        />
      )
    ).toBe('<div>a</div>');
  });

  test('should fail on an invalid component', () => {
    expect(() => {
      renderToStaticMarkup(
        <Markdown
          children="# a"
          components={{
            // @ts-expect-error: check how the runtime handles an invalid component.
            h1: 123,
          }}
        />
      );
    }).toThrow(/Element type is invalid/);
  });

  test('should support `components` (headings)', () => {
    let calls = 0;

    function heading(props: ComponentProps<'h1'> & ExtraProps) {
      const { node, ...rest } = props;
      expect(node).toBeTruthy();
      expect(node!.tagName === 'h1' || node!.tagName === 'h2').toBe(true);
      calls++;
      const Tag = node!.tagName as 'h1' | 'h2';
      return <Tag {...rest} />;
    }

    expect(renderToStaticMarkup(<Markdown children={'# a\n## b'} components={{ h1: heading, h2: heading }} />)).toBe(
      '<h1>a</h1>\n<h2>b</h2>'
    );

    expect(calls).toBe(2);
  });

  test('should support `components` (code)', () => {
    let calls = 0;
    expect(
      renderToStaticMarkup(
        <Markdown
          children={'```\na\n```\n\n\tb\n\n`c`'}
          components={{
            code(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('code');
              calls++;
              return <code {...rest} />;
            },
          }}
        />
      )
    ).toBe('<pre><code>a\n</code></pre>\n<pre><code>b\n</code></pre>\n<p><code>c</code></p>');

    expect(calls).toBe(3);
  });

  test('should support `components` (li)', () => {
    let calls = 0;

    expect(
      renderToStaticMarkup(
        <Markdown
          children={'* [x] a\n1. b'}
          components={{
            li(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('li');
              calls++;
              return <li {...rest} />;
            },
          }}
          remarkPlugins={[remarkGfm]}
        />
      )
    ).toBe(
      '<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" disabled="" checked=""/> a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>'
    );

    expect(calls).toBe(2);
  });

  test('should support `components` (ol)', () => {
    let calls = 0;

    expect(
      renderToStaticMarkup(
        <Markdown
          children="1. a"
          components={{
            ol(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('ol');
              calls++;
              return <ol {...rest} />;
            },
          }}
        />
      )
    ).toBe('<ol>\n<li>a</li>\n</ol>');

    expect(calls).toBe(1);
  });

  test('should support `components` (ul)', () => {
    let calls = 0;

    expect(
      renderToStaticMarkup(
        <Markdown
          children="* a"
          components={{
            ul(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('ul');
              calls++;
              return <ul {...rest} />;
            },
          }}
        />
      )
    ).toBe('<ul>\n<li>a</li>\n</ul>');

    expect(calls).toBe(1);
  });

  test('should support `components` (tr)', () => {
    let calls = 0;

    expect(
      renderToStaticMarkup(
        <Markdown
          children={'|a|\n|-|\n|b|'}
          components={{
            tr(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('tr');
              calls++;
              return <tr {...rest} />;
            },
          }}
          remarkPlugins={[remarkGfm]}
        />
      )
    ).toBe('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>');

    expect(calls).toBe(2);
  });

  test('should support `components` (td, th)', () => {
    let tdCalls = 0;
    let thCalls = 0;

    expect(
      renderToStaticMarkup(
        <Markdown
          children={'|a|\n|-|\n|b|'}
          components={{
            td(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('td');
              tdCalls++;
              return <td {...rest} />;
            },
            th(props) {
              const { node, ...rest } = props;
              expect(node).toBeTruthy();
              expect(node!.tagName).toBe('th');
              thCalls++;
              return <th {...rest} />;
            },
          }}
          remarkPlugins={[remarkGfm]}
        />
      )
    ).toBe('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>');

    expect(tdCalls).toBe(1);
    expect(thCalls).toBe(1);
  });

  test('should pass `node` to components', () => {
    let calls = 0;
    expect(
      renderToStaticMarkup(
        <Markdown
          children="*a*"
          components={{
            em(props) {
              const { node, ...rest } = props;
              expect(node).toEqual({
                type: 'element',
                tagName: 'em',
                properties: {},
                children: [
                  {
                    type: 'text',
                    value: 'a',
                    position: {
                      start: { line: 1, column: 2, offset: 1 },
                      end: { line: 1, column: 3, offset: 2 },
                    },
                  },
                ],
                position: {
                  start: { line: 1, column: 1, offset: 0 },
                  end: { line: 1, column: 4, offset: 3 },
                },
              });
              calls++;
              return <em {...rest} />;
            },
          }}
        />
      )
    ).toBe('<p><em>a</em></p>');

    expect(calls).toBe(1);
  });

  test('should support plugins (`remark-gfm`)', () => {
    expect(renderToStaticMarkup(<Markdown children="a ~b~ c" remarkPlugins={[remarkGfm]} />)).toBe(
      '<p>a <del>b</del> c</p>'
    );
  });

  test('should support plugins (`remark-toc`)', () => {
    expect(
      renderToStaticMarkup(<Markdown children={'# a\n## Contents\n## b\n### c\n## d'} remarkPlugins={[remarkToc]} />)
    ).toBe(
      `<h1>a</h1>
<h2>Contents</h2>
<ul>
<li><a href="#b">b</a>
<ul>
<li><a href="#c">c</a></li>
</ul>
</li>
<li><a href="#d">d</a></li>
</ul>
<h2>b</h2>
<h3>c</h3>
<h2>d</h2>`
    );
  });

  test('should support aria properties', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'input',
          properties: { id: 'a', ariaDescribedBy: 'b', required: true },
          children: [],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="c" rehypePlugins={[plugin]} />)).toBe(
      '<input id="a" aria-describedby="b" required=""/><p>c</p>'
    );
  });

  test('should support data properties', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'i',
          properties: { dataWhatever: 'a', dataIgnoreThis: undefined },
          children: [],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="b" rehypePlugins={[plugin]} />)).toBe(
      '<i data-whatever="a"></i><p>b</p>'
    );
  });

  test('should support comma separated properties', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'i',
          properties: { accept: ['a', 'b'] },
          children: [],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="c" rehypePlugins={[plugin]} />)).toBe(
      '<i accept="a, b"></i><p>c</p>'
    );
  });

  test('should support `style` properties', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'i',
          properties: { style: 'color: red; font-weight: bold' },
          children: [],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="a" rehypePlugins={[plugin]} />)).toBe(
      '<i style="color:red;font-weight:bold"></i><p>a</p>'
    );
  });

  test('should support `style` properties w/ vendor prefixes', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'i',
          properties: { style: '-ms-b: 1; -webkit-c: 2' },
          children: [],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="a" rehypePlugins={[plugin]} />)).toBe(
      '<i style="-ms-b:1;-webkit-c:2"></i><p>a</p>'
    );
  });

  test('should support broken `style` properties', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'i',
          properties: { style: 'broken' },
          children: [],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="a" rehypePlugins={[plugin]} />)).toBe('<i></i><p>a</p>');
  });

  test('should support SVG elements', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({
          type: 'element',
          tagName: 'svg',
          properties: {
            viewBox: '0 0 500 500',
            xmlns: 'http://www.w3.org/2000/svg',
          },
          children: [
            {
              type: 'element',
              tagName: 'title',
              properties: {},
              children: [{ type: 'text', value: 'SVG `<circle>` element' }],
            },
            {
              type: 'element',
              tagName: 'circle',
              properties: { cx: 120, cy: 120, r: 100 },
              children: [],
            },
            // `strokeMiterLimit` in hast, `strokeMiterlimit` in React.
            {
              type: 'element',
              tagName: 'path',
              properties: { strokeMiterLimit: -1 },
              children: [],
            },
          ],
        });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="a" rehypePlugins={[plugin]} />)).toBe(
      '<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"><title>SVG `&lt;circle&gt;` element</title><circle cx="120" cy="120" r="100"></circle><path stroke-miterlimit="-1"></path></svg><p>a</p>'
    );
  });

  test('should support comments (ignore them)', () => {
    function plugin() {
      return function (tree: Root) {
        tree.children.unshift({ type: 'comment', value: 'things!' });
      };
    }

    expect(renderToStaticMarkup(<Markdown children="a" rehypePlugins={[plugin]} />)).toBe('<p>a</p>');
  });

  test('should support table cells w/ style', () => {
    function plugin() {
      return function (tree: Root) {
        visit(tree, 'element', (node) => {
          if (node.tagName === 'th') {
            node.properties = { ...node.properties, style: 'color: red' };
          }
        });
      };
    }

    expect(
      renderToStaticMarkup(
        <Markdown children={'| a  |\n| :- |'} remarkPlugins={[remarkGfm]} rehypePlugins={[plugin]} />
      )
    ).toBe('<table><thead><tr><th style="color:red;text-align:left">a</th></tr></thead></table>');
  });

  test('should not fail on a plugin replacing `root`', () => {
    function plugin() {
      return function () {
        // @ts-expect-error: check how non-roots are handled.
        return { type: 'comment', value: 'things!' } as Root;
      };
    }

    expect(renderToStaticMarkup(<Markdown children="a" rehypePlugins={[plugin]} />)).toBe('');
  });

  test('defaultUrlTransform exposes the url-safety logic', () => {
    const stub = { tagName: 'a', type: 'element' as const, properties: {}, children: [] };
    expect(defaultUrlTransform('https://a.com', 'href', stub)).toBe('https://a.com');
    expect(defaultUrlTransform('javascript:alert(1)', 'href', stub)).toBe('');
    expect(defaultUrlTransform('/relative', 'href', stub)).toBe('/relative');
    expect(defaultUrlTransform('mailto:a@b.com', 'href', stub)).toBe('mailto:a@b.com');
  });
});
