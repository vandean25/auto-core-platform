import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchE2eSuitesWithIsolated } from './run-e2e-isolated-suites.mjs';

const batchSize = 12;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.dirname(scriptDirectory);

export function chunkItems(items, size) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('Batch size must be a positive integer.');
  }

  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export function parseJestTestList(output) {
  return output.split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
}

const shardPattern = /^--shard=(\d+)\/(\d+)$/;

export function parseShardOption(args) {
  const option = args.find((arg) => arg === '--shard' || arg.startsWith('--shard='));
  if (option === undefined) {
    return null;
  }

  const match = shardPattern.exec(option);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || count < 1 || index < 1 || index > count) {
    throw new RangeError(
      `Invalid ${option}: expected --shard=<index>/<count> with 1 <= index <= count.`,
    );
  }
  return { index, count };
}

export function buildListTestsArgs(shard = null) {
  const jestPath = path.resolve(apiDirectory, '../../node_modules/jest/bin/jest.js');
  return [
    '--experimental-vm-modules',
    jestPath,
    '--config',
    './test/jest-e2e.json',
    '--ci',
    '--runInBand',
    '--listTests',
    ...(shard ? [`--shard=${shard.index}/${shard.count}`] : []),
  ];
}

export async function discoverE2eBatches(size = batchSize, shard = null) {
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
  const batches = await discoverE2eBatches(batchSize, shard);
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
