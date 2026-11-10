import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shardCount = 4;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.dirname(scriptDirectory);
const ciRunner = path.resolve(scriptDirectory, 'run-e2e-batches.aut605.mjs');

export function resolveAgentDatabaseUrl(env = process.env) {
  const e2eUrl = env.ACP_E2E_DATABASE_URL?.trim();
  const current = env.DATABASE_URL?.trim();
  const url = e2eUrl || current;
  if (!url) {
    throw new Error(
      'DATABASE_URL or ACP_E2E_DATABASE_URL is required for test:e2e:agent.',
    );
  }
  if (
    /\/core_platform(\?|$)/.test(url) &&
    e2eUrl &&
    /\/core_platform(\?|$)/.test(e2eUrl) === false
  ) {
    return e2eUrl;
  }
  if (/\/core_platform(\?|$)/.test(url)) {
    throw new Error(
      'test:e2e:agent refuses to run against core_platform. Set DATABASE_URL to ACP_E2E_DATABASE_URL (auto_core_test).',
    );
  }
  return e2eUrl && !/\/core_platform(\?|$)/.test(e2eUrl) ? e2eUrl : url;
}

export function buildAgentShardArgs(count = shardCount) {
  return Array.from({ length: count }, (_, i) => `--shard=${i + 1}/${count}`);
}

/** Child-process env aligned with backend-e2e in `.github/workflows/build.yaml`. */
export function buildAgentChildEnv(env = process.env) {
  const databaseUrl = resolveAgentDatabaseUrl(env);
  const brandingDir =
    env.DOCUMENT_BRANDING_VISUAL_ARTIFACT_DIR?.trim() ||
    path.join(os.tmpdir(), 'document-branding-visual-fixtures');
  return {
    ...env,
    DATABASE_URL: databaseUrl,
    INVOICE_BRANDING_WRITER_ENABLED: env.INVOICE_BRANDING_WRITER_ENABLED ?? 'true',
    DOCUMENT_BRANDING_VISUAL_ARTIFACT_DIR: brandingDir,
  };
}

function runAgentE2e() {
  const env = buildAgentChildEnv();
  const shardSummaries = [];
  console.log(
    `Backend E2E agent: CI-parity runner, ${shardCount} sequential shards, DATABASE_URL forced to the e2e database.`,
  );

  for (const shardArg of buildAgentShardArgs()) {
    const shardLabel = shardArg.replace('--shard=', '');
    console.log(`Backend E2E agent: starting ${shardArg} (--runInBand batches).`);
    const result = spawnSync(process.execPath, [ciRunner, shardArg], {
      cwd: apiDirectory,
      env,
      stdio: 'inherit',
    });
    if (result.error) {
      throw result.error;
    }
    const exitCode = result.status ?? 1;
    const status = exitCode === 0 ? 'PASS' : 'FAIL';
    shardSummaries.push({ shard: shardLabel, status, exitCode });
    console.log(`Backend E2E agent: shard ${shardLabel} ${status} (exit ${exitCode}).`);
    if (exitCode !== 0) {
      console.error('Backend E2E agent: shard summary:');
      for (const entry of shardSummaries) {
        console.error(`  ${entry.shard}: ${entry.status}`);
      }
      process.exit(exitCode);
    }
  }

  console.log(`Backend E2E agent: all ${shardCount} shards passed.`);
  console.log('Backend E2E agent: shard summary:');
  for (const entry of shardSummaries) {
    console.log(`  ${entry.shard}: ${entry.status}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runAgentE2e();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
