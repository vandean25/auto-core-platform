import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  collectDynamicImportChunkFiles,
  parseIndexHtmlReferencedPaths,
  verifyBuildChunks,
} from './verify-build-chunks-lib.mjs';

const fixturesRoot = path.join(import.meta.dirname, 'verify-build-chunks-fixtures');
const cliPath = path.join(import.meta.dirname, 'verify-build-chunks.mjs');

test('collectDynamicImportChunkFiles walks lazy import closure including static imports', () => {
  const { files, unresolved } = collectDynamicImportChunkFiles({
    'index.html': {
      dynamicImports: ['src/a.tsx'],
    },
    'src/a.tsx': {
      file: 'assets/a.js',
      isDynamicEntry: true,
      imports: ['_vendor.js'],
    },
    '_vendor.js': { file: 'assets/vendor.js' },
    'src/b.tsx': { file: 'assets/b.js', isDynamicEntry: true },
  });
  assert.deepEqual([...files].sort(), ['assets/a.js', 'assets/b.js', 'assets/vendor.js']);
  assert.equal(unresolved.size, 0);
});

test('collectDynamicImportChunkFiles records unresolved manifest keys separately', () => {
  const { files, unresolved } = collectDynamicImportChunkFiles({
    'index.html': {
      dynamicImports: ['src/missing.tsx'],
    },
  });
  assert.equal(files.size, 0);
  assert.deepEqual([...unresolved], ['src/missing.tsx']);
});

test('parseIndexHtmlReferencedPaths extracts module entry, modulepreload, and stylesheet', () => {
  const html = `<!doctype html>
<script type="module" crossorigin src="/assets/index.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor.js">
<link rel="stylesheet" crossorigin href="/assets/app.css">`;
  assert.deepEqual(parseIndexHtmlReferencedPaths(html), [
    '/assets/index.js',
    '/assets/vendor.js',
    '/assets/app.css',
  ]);
});

test('verifyBuildChunks passes on valid fixture dist', () => {
  const distDir = path.join(fixturesRoot, 'valid');
  const result = verifyBuildChunks({ distDir });
  assert.equal(result.dynamicChunkCount, 2);
  assert.equal(result.indexReferenceCount, 3);
});

test('verifyBuildChunks fails when a dynamic-import chunk file is missing', () => {
  const distDir = path.join(fixturesRoot, 'missing-chunk');
  assert.throws(() => verifyBuildChunks({ distDir }), /missing dynamic-import chunk: assets\/lazy-page\.js/);
});

test('verifyBuildChunks fails when a lazy route static import chunk is missing', () => {
  const distDir = path.join(fixturesRoot, 'missing-static-import');
  assert.throws(
    () => verifyBuildChunks({ distDir }),
    /missing dynamic-import chunk: assets\/shared\.js/,
  );
});

test('verifyBuildChunks fails when a lazy-route JS chunk is empty', () => {
  const distDir = path.join(fixturesRoot, 'empty-chunk');
  assert.throws(() => verifyBuildChunks({ distDir }), /empty dynamic-import chunk: assets\/lazy-page\.js/);
});

test('verifyBuildChunks fails when index.html references a missing file', () => {
  const distDir = path.join(fixturesRoot, 'missing-index-ref');
  assert.throws(
    () => verifyBuildChunks({ distDir }),
    /index\.html references missing file: \/assets\/does-not-exist\.js/,
  );
});

test('CLI exits non-zero on deliberately broken missing-chunk fixture', () => {
  const distDir = path.join(fixturesRoot, 'missing-chunk');
  const result = spawnSync(process.execPath, [cliPath, '--dist', distDir], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /missing dynamic-import chunk/);
});
