/** Prove the freeze/splice module split preserved every declaration from v2.12.0.
 * This is migration evidence, deliberately outside the ongoing test suite. */
import process from 'node:process';
import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'packages/engine/src/components/incrementalParse/';
const printer = ts.createPrinter({ removeComments: true });
function declarations(text) {
  const source = ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest, true);
  const result = new Map();
  for (const node of source.statements) {
    const names = ts.isVariableStatement(node)
      ? node.declarationList.declarations.map((d) => d.name.getText(source))
      : node.name
        ? [node.name.getText(source)]
        : [];
    const canonical = printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/^export /, '');
    for (const name of names) result.set(name, canonical);
  }
  return result;
}
const splits = {
  spliceParse: ['spliceParse', 'prefixInjection', 'spliceCoordinates', 'spliceHtmlGuards', 'prefixAlignment'],
  computeFreezeBoundary: ['computeFreezeBoundary', 'freezeScanState', 'freezeLineSyntax', 'freezeLineTransition'],
};
for (const [entry, modules] of Object.entries(splits)) {
  const before = declarations(
    execFileSync('git', ['show', `v2.12.0:${base}${entry}.ts`], { cwd: root, encoding: 'utf8' })
  );
  const after = new Map();
  for (const name of modules) {
    for (const [key, value] of declarations(readFileSync(`${root}${base}${name}.ts`, 'utf8'))) {
      if (after.has(key)) throw new Error(`Duplicated declaration: ${key}`);
      after.set(key, value);
    }
  }
  for (const [name, declaration] of before) {
    if (after.get(name) !== declaration) throw new Error(`Changed or missing declaration: ${name}`);
  }
  if (after.size !== before.size) throw new Error('Unexpected added declarations');
  process.stdout.write(
    `PASS ${entry}: ${before.size} declarations unchanged, ignoring export modifiers and comments.\n`
  );
}
