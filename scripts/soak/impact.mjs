/* global process, console */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { parse } from 'yaml';

const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );
const manifestInputs = (text) => {
  const p = JSON.parse(text);
  return canonical(
    Object.fromEntries(
      [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
        'peerDependenciesMeta',
        'scripts',
        'engines',
        'type',
        'exports',
        'main',
        'module',
        'sideEffects',
      ].map((key) => [key, p[key]])
    )
  );
};
function executable(text) {
  // Compare emitted JavaScript: comments and erased types cannot affect runtime.
  // Runtime re-exports remain significant because they may load different modules.
  const source = text;
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true },
  }).outputText;
}
export function dependencyGraph(lockText) {
  const lock = parse(lockText),
    visited = new Set(),
    result = { settings: lock.settings, overrides: lock.overrides, patchedDependencies: lock.patchedDependencies };
  function snapshot(name, version, importer) {
    if (version.startsWith('link:')) {
      workspace(path.posix.normalize(path.posix.join(importer, version.slice(5))));
      return;
    }
    const key = [`${name}@${version}`, version.replace(/^npm:/, '')].find((candidate) => lock.snapshots?.[candidate]);
    if (!key) throw new Error(`Unresolved dependency ${name}@${version}`);
    if (visited.has(key)) return;
    visited.add(key);
    const snap = lock.snapshots[key];
    result[key] = { snapshot: snap, package: lock.packages?.[key.split('(')[0]] };
    for (const [child, v] of Object.entries({ ...snap.dependencies, ...snap.optionalDependencies }))
      snapshot(child, v, importer);
  }
  function workspace(importer) {
    const key = `workspace:${importer}`;
    if (visited.has(key)) return;
    visited.add(key);
    const item = lock.importers?.[importer];
    if (!item) throw new Error(`Missing importer ${importer}`);
    // Engine test/build dependencies affect the verification mechanism too.
    const deps = { ...item.dependencies, ...item.optionalDependencies, ...item.devDependencies };
    result[key] = deps;
    for (const [name, data] of Object.entries(deps)) snapshot(name, data.version, importer);
  }
  workspace('packages/engine');
  const root = lock.importers?.['.'];
  for (const name of ['typescript', 'tsup', 'vitest', '@vitest/coverage-v8', 'yaml']) {
    const dep = root?.devDependencies?.[name];
    if (dep) {
      result[`tool:${name}`] = dep;
      snapshot(name, dep.version, '.');
    }
  }
  return canonical(result);
}
/** Workspace globs affect soak only when they stop including one of its local
 * inputs. All other install/resolution options remain significant. Resolve the
 * local dependency closure from each historical lockfile, never from node_modules.
 * Corpus documents are read directly by engine verification outside that graph. */
export function workspaceInputs(text, lockText) {
  const config = parse(text);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid workspace config');
  const { packages = ['**'], ...options } = config;
  if (!Array.isArray(packages) || !packages.every((pattern) => typeof pattern === 'string' && pattern.length > 0))
    throw new Error('Invalid workspace patterns');
  const graph = JSON.parse(dependencyGraph(lockText));
  const inputs = [
    ...new Set([
      'packages/engine',
      'packages/remark-mark-highlight',
      'corpus',
      ...Object.keys(graph)
        .filter((key) => key.startsWith('workspace:'))
        .map((key) => key.slice('workspace:'.length)),
    ]),
  ].sort();
  const positive = packages.filter((pattern) => !pattern.startsWith('!'));
  const negative = packages.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  const included = inputs.map((directory) => [
    directory,
    positive.some((pattern) => path.posix.matchesGlob(directory, pattern)) &&
      !negative.some((pattern) => path.posix.matchesGlob(directory, pattern)),
  ]);
  if (included.some(([, present]) => !present)) throw new Error('Engine verification workspace is excluded');
  return canonical({ options, included });
}
export function classify(paths, before, after) {
  const reasons = [];
  for (const file of paths) {
    const a = before(file),
      b = after(file);
    if (a === b) continue;
    if (file === 'pnpm-lock.yaml') {
      try {
        if (dependencyGraph(a) !== dependencyGraph(b))
          reasons.push(`${file}: engine/test/build dependency graph changed`);
      } catch {
        reasons.push(`${file}: dependency impact could not be resolved`);
      }
    } else if (file === 'pnpm-workspace.yaml') {
      try {
        if (workspaceInputs(a, before('pnpm-lock.yaml')) !== workspaceInputs(b, after('pnpm-lock.yaml')))
          reasons.push(`${file}: engine workspace membership or installation settings changed`);
      } catch {
        reasons.push(`${file}: engine workspace impact could not be resolved`);
      }
    } else if (file === 'package.json') {
      const inputs = (text) => {
        const manifest = JSON.parse(text || '{}');
        return canonical({
          packageManager: manifest.packageManager,
          soakScripts: Object.fromEntries(
            Object.entries(manifest.scripts ?? {}).filter(([name]) =>
              /^(check:soak|check:release-soak|test:soak-control)/.test(name)
            )
          ),
        });
      };
      if (inputs(a) !== inputs(b)) reasons.push(`${file}: package manager or soak entry points changed`);
    } else if (/^\.github\/workflows\/(release|ci)\.yml$/.test(file)) {
      // Compare the set of Node versions the workflow runs on, not which job
      // runs them: adding or renaming a job that keeps the existing pin does
      // not change the runtime the engine is verified under.
      const runtimes = (text) => {
        const workflow = parse(text) ?? {};
        return [
          ...new Set(
            Object.values(workflow.jobs ?? {}).flatMap((job) => [
              ...(job.steps ?? []).filter((step) => step.with?.runtime).map((step) => String(step.with.runtime)),
              ...(job.strategy?.matrix?.node ?? []).map((node) => `node@${node}`),
            ])
          ),
        ].sort();
      };
      if (canonical(runtimes(a)) !== canonical(runtimes(b))) reasons.push(`${file}: Node runtime changed`);
    } else if (/^packages\/(engine|remark-mark-highlight)\/package.json$/.test(file)) {
      if (!a || !b || manifestInputs(a) !== manifestInputs(b))
        reasons.push(`${file}: runtime or build contract changed`);
    } else if (/^packages\/(engine|remark-mark-highlight)\//.test(file)) {
      if (/\.(md|txt)$|\/LICENSE$/.test(file)) continue;
      if (/\.[cm]?[jt]sx?$/.test(file) && a && b && executable(a) === executable(b)) continue;
      reasons.push(`${file}: engine/plugin implementation or verification changed`);
    } else if (/^corpus\/documents\//.test(file)) {
      reasons.push(`${file}: engine differential verification input changed`);
    } else if (/^scripts\/soak\/|^tsconfig\.base\.json$|^patches\//.test(file)) {
      // The node:test suites under scripts/soak/ check the control scripts;
      // they are not part of the soak mechanism the evidence was produced by.
      if (!/\.md$|\.test\.mjs$/.test(file)) reasons.push(`${file}: shared toolchain or soak mechanism changed`);
    }
  }
  // Root vitest.config.ts hosts unit/Storybook projects for normal CI. The
  // six soak legs start in packages/engine and load its own vitest.config.ts,
  // already covered by the engine path rule. Do not couple evidence to UI setup.
  return { required: reasons.length > 0, reasons };
}
export function inspect(base, head = 'HEAD', cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const target = git(['rev-parse', '--verify', `${head}^{commit}`]);
  if (!base) {
    try {
      base = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${target}^`]);
    } catch {
      return {
        base: null,
        head: target,
        required: true,
        reasons: ['No preceding train tag; initial verification is required'],
      };
    }
  }
  base = git(['rev-parse', '--verify', `${base}^{commit}`]);
  git(['merge-base', '--is-ancestor', base, target]);
  const paths = git(['diff', '--name-only', '--no-renames', base, target]).split('\n').filter(Boolean);
  const read = (ref) => (file) => {
    try {
      return git(['show', `${ref}:${file}`]);
    } catch {
      return '';
    }
  };
  return { base, head: target, ...classify(paths, read(base), read(target)) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = (flag) => {
    const i = process.argv.indexOf(flag);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const result = inspect(value('--base'), value('--head'));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(
      result.required
        ? '::notice title=Engine soak required::Full local release-profile soak and maintainer approval are required before publication. See the job summary for the baseline and reasons.'
        : '::notice title=Engine soak not required::No engine impact was detected in this candidate range. Normal core and adapter gates still apply; release CI reassesses the final candidate.'
    );
  }
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `required=${result.required}\nhead=${result.head}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Engine soak impact\n\nDecision: **${result.required ? 'REQUIRED before publication' : 'NOT REQUIRED for this range'}**\n\nBase: \`${result.base}\`\nCandidate: \`${result.head}\`\n\n${result.reasons.map((r) => `- ${r}`).join('\n') || 'No engine behavior, dependency, or verification changes.'}\n\nThis report is informational: a successful check means the assessment completed, not that soak passed. The default range is cumulative since the preceding train tag. PR checks assess the checked-out merge candidate; release CI reassesses the final candidate and requests approval when required.\n`
    );
}
