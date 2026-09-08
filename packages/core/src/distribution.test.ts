import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

for (const entry of ['index.js', 'index.cjs']) {
  test(`published ${entry} renders Markdown through the shared runtime in Node`, () => {
    const entryPath = fileURLToPath(new URL(`../dist/${entry}`, import.meta.url));
    const coreDirectory = fileURLToPath(new URL('..', import.meta.url));
    const html = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const require = createRequire(pathToFileURL(process.argv[1]));
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const imported = await import(pathToFileURL(process.argv[1]).href);
      const Markdown = process.argv[1].endsWith('.cjs') ? imported.default.default : imported.default;
      process.stdout.write(renderToStaticMarkup(React.createElement(Markdown, {
        content: 'Hello **world**.\\n\\nClaim[^a].\\n\\n[^a]: Shared note',
      })));
    `,
        entryPath,
      ],
      { cwd: coreDirectory, encoding: 'utf8' }
    );
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('Shared note');
    expect(html).toContain('data-footnotes');
  });
}
