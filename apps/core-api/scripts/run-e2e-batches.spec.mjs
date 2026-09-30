import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkItems,
  discoverE2eBatches,
  parseJestTestList,
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
