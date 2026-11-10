import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentChildEnv,
  buildAgentShardArgs,
  resolveAgentDatabaseUrl,
} from './run-e2e-agent.mjs';

const e2eUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/auto_core_test';
const devUrl = 'postgresql://acp_cloud:acp_cloud_local_only@127.0.0.1:5432/core_platform';

test('buildAgentShardArgs returns four CI-style shard options', () => {
  assert.deepEqual(buildAgentShardArgs(), [
    '--shard=1/4',
    '--shard=2/4',
    '--shard=3/4',
    '--shard=4/4',
  ]);
});

test('resolveAgentDatabaseUrl prefers ACP_E2E_DATABASE_URL over core_platform DATABASE_URL', () => {
  assert.equal(
    resolveAgentDatabaseUrl({
      DATABASE_URL: devUrl,
      ACP_E2E_DATABASE_URL: e2eUrl,
    }),
    e2eUrl,
  );
});

test('resolveAgentDatabaseUrl accepts DATABASE_URL when it is auto_core_test', () => {
  assert.equal(resolveAgentDatabaseUrl({ DATABASE_URL: e2eUrl }), e2eUrl);
});

test('resolveAgentDatabaseUrl refuses core_platform when no e2e override exists', () => {
  assert.throws(
    () => resolveAgentDatabaseUrl({ DATABASE_URL: devUrl }),
    /refuses to run against core_platform/,
  );
});

test('resolveAgentDatabaseUrl requires a database URL', () => {
  assert.throws(() => resolveAgentDatabaseUrl({}), /required/);
});

test('buildAgentChildEnv forces the e2e database and CI branding defaults', () => {
  const child = buildAgentChildEnv({
    DATABASE_URL: devUrl,
    ACP_E2E_DATABASE_URL: e2eUrl,
  });
  assert.equal(child.DATABASE_URL, e2eUrl);
  assert.equal(child.INVOICE_BRANDING_WRITER_ENABLED, 'true');
  assert.ok(child.DOCUMENT_BRANDING_VISUAL_ARTIFACT_DIR?.length);
});
