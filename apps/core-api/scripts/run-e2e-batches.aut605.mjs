import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchE2eSuitesWithIsolated } from './run-e2e-isolated-suites.mjs';
import {
  buildListTestsArgs,
  chunkItems,
  parseJestTestList,
  parseShardOption,
} from './run-e2e-batches.mjs';

const batchSize = 12;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.dirname(scriptDirectory);

async function discoverE2eBatchesWithIsolated(size = batchSize, shard = null) {
  const listedTests = spawnSync(process.execPath, buildListTestsArgs(shard), {
    cwd: apiDirectory,
    encoding: 'utf8',
  });

  if (listedTests.error) {
    throw listedTests.error;
  }
  if (listedTests.status !== 0) {
    throw new Error(listedTests.stderr || 'Jest could not list backend E2E suites.');
  }

  const testFiles = parseJestTestList(listedTests.stdout);
  if (testFiles.length === 0) {
    const scope = shard ? ` in shard ${shard.index}/${shard.count}` : '';
    throw new Error(`Jest did not discover any backend E2E suites${scope}.`);
  }

  return batchE2eSuitesWithIsolated(testFiles, size, chunkItems);
}

async function runBatchedE2e() {
  const shard = parseShardOption(process.argv.slice(2));
  const batches = await discoverE2eBatchesWithIsolated(batchSize, shard);
  const suiteCount = batches.reduce((total, batch) => total + batch.length, 0);
  const shardLabel = shard ? ` in shard ${shard.index}/${shard.count}` : '';
  console.log(`Backend E2E: ${suiteCount} suites${shardLabel}.`);
  const jestPath = path.resolve(apiDirectory, '../../node_modules/jest/bin/jest.js');

  for (const [index, batch] of batches.entries()) {
    console.log(
      `Running backend E2E batch ${index + 1}/${batches.length} (${batch.length} suites).`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=6144',
        '--experimental-vm-modules',
        jestPath,
        '--config',
        './test/jest-e2e.json',
        '--ci',
        '--runInBand',
        '--runTestsByPath',
        ...batch,
      ],
      { cwd: apiDirectory, env: process.env, stdio: 'inherit' },
    );

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBatchedE2e().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
