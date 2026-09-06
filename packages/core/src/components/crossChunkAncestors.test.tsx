import { test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIMarkdown, { AIMarkdownDocuments } from '../index';
import { sanitizeSchema } from '@ai-react-markdown/engine';
test('coordinated links respect the actual paragraph ancestor', () => {
  const props = {
    documentId: 'ancestor',
    content: '[go][ref]\n\n[ref]: /target',
    sanitizeSchema: { ...sanitizeSchema, ancestors: { ...sanitizeSchema.ancestors, a: ['p'] } },
  };
  const standalone = renderToStaticMarkup(createElement(AIMarkdown, props));
  const coordinated = renderToStaticMarkup(createElement(AIMarkdownDocuments, null, createElement(AIMarkdown, props)));
  expect(standalone).toContain('href="/target"');
  expect(coordinated).toContain('href="/target"');
});

test.each([
  ['heading unwrap', '# [go][ref]\n\n[ref]: /target', 'a', ['p'], false],
  ['heading strip', '# [go][ref]\n\n[ref]: /target', 'a', ['p'], true],
  ['raw parent', '<div>\n\n[go][ref]\n\n</div>\n\n[ref]: /target', 'a', ['div'], false],
  ['image allowed', '> words ![alt][ref]\n\n[ref]: /target', 'img', ['blockquote'], false],
  ['image forbidden', 'words ![alt][ref]\n\n[ref]: /target', 'img', ['blockquote'], false],
  ['image in reference link', '[words ![alt][img]][ref]\n\n[img]: /image\n\n[ref]: /target', 'img', ['a'], false],
  ['empty ancestor allowlist', '[go][ref]\n\n[ref]: /target', 'a', [], false],
] as const)('ancestor policies match standalone: %s', (_name, content, tag, ancestors, strip) => {
  const schema = {
    ...sanitizeSchema,
    ancestors: { ...sanitizeSchema.ancestors, [tag]: [...ancestors] },
    strip: [...(sanitizeSchema.strip ?? []), ...(strip ? [tag] : [])],
  };
  const props = { documentId: 'ancestor', content, sanitizeSchema: schema };
  expect(renderToStaticMarkup(createElement(AIMarkdownDocuments, null, createElement(AIMarkdown, props)))).toBe(
    renderToStaticMarkup(createElement(AIMarkdown, props))
  );
});

test('matches sanitizer ancestry even when the parent itself is unwrapped', () => {
  const schema = {
    ...sanitizeSchema,
    tagNames: sanitizeSchema.tagNames!.filter((t) => t !== 'p'),
    ancestors: { ...sanitizeSchema.ancestors, a: ['p'] },
  };
  const props = { documentId: 'ancestor', content: '[go][ref]\n\n[ref]: /target', sanitizeSchema: schema };
  const standalone = renderToStaticMarkup(createElement(AIMarkdown, props));
  expect(standalone).toContain('href="/target"');
  expect(renderToStaticMarkup(createElement(AIMarkdownDocuments, null, createElement(AIMarkdown, props)))).toBe(
    standalone
  );
});
