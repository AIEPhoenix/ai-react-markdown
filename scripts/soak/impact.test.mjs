import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, dependencyGraph } from './impact.mjs';
const check = (file, a, b) =>
  classify(
    [file],
    () => a,
    () => b
  ).required;
test('adapter, core, documentation, version and type-only changes do not require engine soak', () => {
  for (const p of [
    'packages/vue/src/render.ts',
    'packages/core/src/contribution.ts',
    'docs/architecture.md',
    'packages/react/src/index.ts',
  ])
    assert.equal(check(p, 'a', 'b'), false);
  assert.equal(check('packages/engine/package.json', '{"version":"1"}', '{"version":"2"}'), false);
  assert.equal(
    check('packages/engine/src/index.ts', 'export type { A } from "./x";', 'export type { B } from "./x";'),
    false
  );
  assert.equal(
    check(
      'packages/engine/src/x.ts',
      'export function x(a: string) { return a; }',
      'export function x(a: unknown) { return a; }'
    ),
    false
  );
});
test('algorithm, plugin, build and verification changes require soak', () => {
  for (const p of [
    'packages/engine/src/x.ts',
    'packages/remark-mark-highlight/src/index.ts',
    'packages/engine/tsup.config.ts',
    'scripts/soak/coverage-map.json',
    'pnpm-workspace.yaml',
  ])
    assert.equal(check(p, 'const a=1;', 'const a=2;'), true);
  assert.equal(check('packages/engine/package.json', '{"dependencies":{"x":"1"}}', '{"dependencies":{"x":"2"}}'), true);
  assert.equal(check('package.json', '{"packageManager":"pnpm@1"}', '{"packageManager":"pnpm@2"}'), true);
});
const lock = (engineVersion = '1', unrelated = '1', transitive = '1') =>
  JSON.stringify({
    importers: {
      'packages/engine': { dependencies: { a: { specifier: engineVersion, version: engineVersion } } },
      'packages/core': { devDependencies: { unused: { version: unrelated } } },
    },
    snapshots: { [`a@${engineVersion}`]: { dependencies: { child: transitive } }, [`child@${transitive}`]: {} },
    packages: {
      [`a@${engineVersion}`]: { resolution: { integrity: 'parent' } },
      [`child@${transitive}`]: { resolution: { integrity: `child-${transitive}` } },
    },
  });
test('lockfile impact follows engine transitive dependencies, not unrelated importers', () => {
  assert.equal(dependencyGraph(lock()), dependencyGraph(lock('1', '2')));
  assert.equal(check('pnpm-lock.yaml', lock(), lock('1', '2')), false);
  assert.equal(check('pnpm-lock.yaml', lock(), lock('2')), true);
  assert.equal(check('pnpm-lock.yaml', lock(), lock('1', '1', '2')), true);
  assert.equal(check('pnpm-lock.yaml', lock(), '{}'), true);
});

test('runtime exports and release Node changes require soak', () => {
  assert.equal(check('packages/engine/src/index.ts', 'export * from "./x";', 'export * from "./y";'), true);
  assert.equal(check('.github/workflows/release.yml', 'runtime: node@22', 'runtime: node@24'), true);
});

test('publication fails closed for failed checks, missing impact, rejected or cancelled approval', async () => {
  const { readFileSync } = await import('node:fs');
  const { parse } = await import('yaml');
  const { runInNewContext } = await import('node:vm');
  const workflow = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const { verify, release, 'soak-approval': approval } = workflow.jobs;
  assert.equal(approval.environment, 'soak-approval');
  assert.equal(approval.needs, 'verify');
  assert.equal(approval.if, "needs.verify.outputs.soak_required == 'true'");
  assert.deepEqual(release.needs, ['verify', 'soak-approval']);
  assert(!verify.steps.some((step) => step.run?.includes('publish-packages.mjs')));
  assert(release.steps.some((step) => step.run?.includes('publish-packages.mjs')));
  assert.equal(release.steps[0].with.ref, '${{ github.sha }}');
  for (const required of ['true', 'false', '']) {
    for (const verified of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const reviewed of ['success', 'failure', 'cancelled', 'skipped']) {
        for (const cancelled of [false, true]) {
          const expression = release.if
            .replaceAll('always()', 'true')
            .replaceAll('cancelled()', String(cancelled))
            .replaceAll('needs.verify.outputs.soak_required', JSON.stringify(required))
            .replaceAll('needs.verify.result', JSON.stringify(verified))
            .replaceAll('needs.soak-approval.result', JSON.stringify(reviewed));
          const expected =
            !cancelled &&
            verified === 'success' &&
            ((required === 'true' && reviewed === 'success') || (required === 'false' && reviewed === 'skipped'));
          assert.equal(
            runInNewContext(expression),
            expected,
            JSON.stringify({ required, verified, reviewed, cancelled })
          );
        }
      }
    }
  }
});

test('Git evidence ranges allow adapter follow-ups but invalidate engine changes', async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { inspect } = await import('./impact.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'aimd-impact-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init');
    mkdirSync(join(dir, 'packages/engine/src'), { recursive: true });
    writeFileSync(join(dir, 'packages/engine/src/x.ts'), 'export const x = 1;');
    const tested = commit();
    assert.equal(inspect(undefined, tested, dir).required, true);
    git('tag', 'v1.0.0');
    writeFileSync(join(dir, 'README.md'), 'Reader documentation');
    const docs = commit();
    assert.equal(inspect(undefined, docs, dir).required, false);
    writeFileSync(join(dir, 'packages/engine/src/x.ts'), 'export const x = 2;');
    const changed = commit();
    assert.equal(inspect(tested, changed, dir).required, true);
    assert.throws(() => inspect(changed, tested, dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
