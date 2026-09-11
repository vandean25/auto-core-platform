import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDocsChrome } from './verify-mintlify-site-assertions.mjs';

test('accepts docs chrome when the assistant is absent and search is available', () => {
  assert.doesNotThrow(() =>
    assertDocsChrome({
      hasAskAssistant: false,
      hasSearchButton: true,
    }),
  );
});

test('rejects docs chrome when the floating assistant is present', () => {
  assert.throws(
    () =>
      assertDocsChrome({
        hasAskAssistant: true,
        hasSearchButton: true,
      }),
    /floating Ask assistant remains enabled/,
  );
});

test('rejects docs chrome when search is unavailable', () => {
  assert.throws(
    () =>
      assertDocsChrome({
        hasAskAssistant: false,
        hasSearchButton: false,
      }),
    /header search is unavailable/,
  );
});
