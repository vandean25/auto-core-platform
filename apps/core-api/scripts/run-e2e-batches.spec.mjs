import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildListTestsArgs,
  chunkItems,
  discoverE2eBatches,
  parseJestTestList,
  parseShardOption,
} from './run-e2e-batches.mjs';

test('chunks E2E files in order without dropping a partial final batch', () => {
  assert.deepEqual(chunkItems(['a', 'b', 'c', 'd', 'e'], 2), [
    ['a', 'b'],
    ['c', 'd'],
    ['e'],
  ]);
});

test('returns no batches when there are no E2E files', () => {
  assert.deepEqual(chunkItems([], 12), []);
});

test('discovers every backend E2E suite in sequential batches', async () => {
  const batches = await discoverE2eBatches();
  const files = batches.flat();

  assert.ok(files.length > 0);
  assert.ok(batches.every((batch) => batch.length <= 12));
  assert.ok(files.every((file) => file.endsWith('.e2e-spec.ts')));
});

test('preserves Jest test sequencer order when parsing its list', () => {
  assert.deepEqual(
    parseJestTestList(
      '/path/long-suite.e2e-spec.ts\n/path/short-suite.e2e-spec.ts\n',
    ),
    ['/path/long-suite.e2e-spec.ts', '/path/short-suite.e2e-spec.ts'],
  );
});

test('requires a positive integer batch size', () => {
  assert.throws(() => chunkItems(['a'], 0), RangeError);
  assert.throws(() => chunkItems(['a'], 1.5), RangeError);
});

test('parses a --shard=<index>/<count> option', () => {
  assert.deepEqual(parseShardOption(['--ci', '--shard=2/4']), {
    index: 2,
    count: 4,
  });
});

test('returns no shard when the option is absent', () => {
  assert.equal(parseShardOption([]), null);
  assert.equal(parseShardOption(['--ci', '--foo=bar']), null);
});

test('rejects a malformed or out-of-range shard option', () => {
  for (const option of [
    '--shard=0/4',
    '--shard=5/4',
    '--shard=1/0',
    '--shard=1',
    '--shard=a/b',
  ]) {
    assert.throws(() => parseShardOption([option]), RangeError, option);
  }
});

test('passes the shard to jest --listTests only when one is set', () => {
  assert.ok(!buildListTestsArgs().some((arg) => arg.startsWith('--shard')));
  assert.ok(buildListTestsArgs({ index: 3, count: 4 }).includes('--shard=3/4'));
});

test('shards cover every backend E2E suite exactly once', async () => {
  const everySuite = (await discoverE2eBatches()).flat().sort();
  const shardedSuites = [];

  for (let index = 1; index <= 4; index += 1) {
    const batches = await discoverE2eBatches(12, { index, count: 4 });
    assert.ok(batches.flat().length > 0, `shard ${index}/4 is empty`);
    shardedSuites.push(...batches.flat());
  }

  assert.deepEqual(shardedSuites.sort(), everySuite);
});
