/* global process, console */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { inspect } from './impact.mjs';
const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Release soak validation requires a clean worktree. Commit the candidate first.');
}
const result = inspect(value('--base'), value('--head') ?? 'HEAD', root);
console.log(JSON.stringify(result, null, 2));
if (!result.required) {
  console.log('Release soak: NOT REQUIRED for this change range. Core and adapter gates still apply.');
} else {
  const at = args.indexOf('--evidence');
  const directories = at < 0 ? [] : args.slice(at + 1).map((dir) => resolve(dir));
  if (!directories.length)
    throw new Error('Engine soak required. Run the release profile locally, then provide --evidence <run-dir>...');
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    const tested = manifest.repository?.commit;
    if (!tested) throw new Error('Evidence has no source commit');
    // Allow documentation/adapter-only follow-ups to the clean tested commit,
    // but never reuse evidence after an engine/dependency/oracle change.
    const followup = inspect(tested, result.head, root);
    if (followup.required)
      throw new Error(`Soak evidence does not cover the candidate: ${followup.reasons.join('; ')}`);
  }
  execFileSync(
    process.execPath,
    [resolve(root, 'scripts/soak/soak-aggregate.mjs'), '--profile', 'release', ...directories],
    { cwd: root, stdio: 'inherit' }
  );
  console.log('Release soak: candidate covered by validated local evidence.');
}
