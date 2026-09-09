/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ts from 'typescript';
const update = process.argv.includes('--update');
mkdirSync('docs/api', { recursive: true });
for (const name of ['engine', 'core', 'vue']) {
  const declaration = readFileSync(`packages/${name}/dist/index.d.ts`, 'utf8');
  const ast = ts.createSourceFile(`${name}.d.ts`, declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const printed = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(ast);
  const snapshot = `// Generated from the built public declaration. Review changes before updating.\n${printed}`;
  const file = `docs/api/${name}.api.txt`;
  assert(
    !/RegistryInternal|SmoothCoordinatorInternal|_refcounts|_subscribers|node_modules\//.test(snapshot),
    `${name}: implementation storage or local path in public declarations`
  );
  if (name !== 'vue') assert(!/from ['"](?:vue|react|react-dom)['"]/.test(snapshot), `${name}: framework dependency`);
  const entry = readFileSync(`packages/${name}/src/index.ts`, 'utf8');
  assert(!/export\s+\*\s+from/.test(entry), `${name}: public root requires explicit exports`);
  if (update) writeFileSync(file, snapshot);
  else
    assert.equal(readFileSync(file, 'utf8'), snapshot, `${name}: public declaration changed; review and run --update`);
  console.log(`${name}: public API ${update ? 'snapshot written' : 'verified'}`);
}
