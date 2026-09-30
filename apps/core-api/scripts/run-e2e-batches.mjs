import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export async function discoverE2eBatches(size = batchSize) {
  const jestPath = path.resolve(apiDirectory, '../../node_modules/jest/bin/jest.js');
  const listedTests = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      jestPath,
      '--config',
      './test/jest-e2e.json',
      '--ci',
      '--runInBand',
      '--listTests',
    ],
    { cwd: apiDirectory, encoding: 'utf8' },
  );

  if (listedTests.error) {
    throw listedTests.error;
  }
  if (listedTests.status !== 0) {
    throw new Error(listedTests.stderr || 'Jest could not list backend E2E suites.');
  }

  const testFiles = parseJestTestList(listedTests.stdout);

  if (testFiles.length === 0) {
    throw new Error('Jest did not discover any backend E2E suites.');
  }

  return chunkItems(testFiles, size);
}

async function runBatchedE2e() {
  const batches = await discoverE2eBatches();
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
