/* global Buffer */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { channel, verifyStatement } from './check-published-release.mjs';

const bytes = Buffer.from('actual downloaded tarball');
const statement = () => ({
  predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{ digest: { sha512: createHash('sha512').update(bytes).digest('hex') } }],
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          repository: 'https://github.com/ai-markdown/ai-markdown',
          path: '.github/workflows/release.yml',
          ref: 'refs/tags/v3.0.0-rc.1',
        },
      },
      resolvedDependencies: [
        {
          uri: 'git+https://github.com/ai-markdown/ai-markdown@refs/tags/v3.0.0-rc.1',
          digest: { gitCommit: 'a'.repeat(40) },
        },
      ],
    },
    runDetails: {
      metadata: { invocationId: 'https://github.com/ai-markdown/ai-markdown/actions/runs/123/attempts/1' },
    },
  },
});
test('release channels support beta, RC, stable and independent versions', () => {
  assert.equal(channel('3.0.0-beta.2'), 'beta');
  assert.equal(channel('3.0.0-rc.1'), 'rc');
  assert.equal(channel('3.0.0'), 'latest');
  assert.equal(channel('1.0.2'), 'latest');
});
test('retry preserves original publication invocation', () => {
  const source = verifyStatement(statement(), bytes);
  assert.equal(source.invocation, 'https://github.com/ai-markdown/ai-markdown/actions/runs/123/attempts/1');
});
for (const [name, mutate] of [
  [
    'other repository',
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.repository += '-fork';
    },
  ],
  [
    'other workflow',
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/untrusted.yml';
    },
  ],
  [
    'branch source',
    (s) => {
      s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/main';
    },
  ],
  [
    'missing source',
    (s) => {
      s.predicate.buildDefinition.resolvedDependencies = [];
    },
  ],
  [
    'other invocation',
    (s) => {
      s.predicate.runDetails.metadata.invocationId = 'https://github.com/other/repo/actions/runs/123';
    },
  ],
])
  test(`reject ${name}`, () => {
    const s = statement();
    mutate(s);
    assert.throws(() => verifyStatement(s, bytes));
  });
test('reject tarball bytes differing from provenance subject', () => {
  assert.throws(() => verifyStatement(statement(), Buffer.from('different tarball')));
});
