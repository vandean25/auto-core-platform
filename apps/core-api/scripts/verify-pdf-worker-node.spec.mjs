import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const nvmrcVersion = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
const verifyScript = path.join(scriptDir, 'verify-pdf-worker-node.sh');
const dockerfile = readFileSync(
  path.join(scriptDir, '..', 'Dockerfile'),
  'utf8',
);
const buildWorkflow = readFileSync(
  path.join(scriptDir, '..', '..', '..', '.github', 'workflows', 'build.yaml'),
  'utf8',
);

test('verify-pdf-worker-node.sh passes when every node binary matches Node 26 major', () => {
  const nodeDir = path.dirname(process.execPath);
  const output = execFileSync('/bin/bash', [verifyScript], {
    env: {
      ...process.env,
      PDF_WORKER_NODE_MAJOR: String(Number(nvmrcVersion.split('.')[0])),
      PDF_WORKER_NODE_CHECK_SYSTEM_DIRS: '0',
      PATH: nodeDir,
    },
    encoding: 'utf8',
  });
  const nodeVersionLine = output
    .split('\n')
    .find((line) => line.startsWith('node -v:'));
  assert.equal(nodeVersionLine, `node -v: v${process.versions.node}`);
  assert.match(output, /^npm -v: /m);
  assert.match(output, /^which -a node: /m);
});

test('Dockerfile pins digest Node from .nvmrc for builder/api and uses Playwright Node 26 in worker', () => {
  const builderPin = dockerfile.match(
    /^FROM node:([0-9.]+)-slim@sha256:[a-f0-9]{64} AS builder$/m,
  );
  assert.equal(builderPin?.[1], nvmrcVersion);
  const apiPin = dockerfile.match(
    /^FROM node:([0-9.]+)-slim@sha256:[a-f0-9]{64} AS api$/m,
  );
  assert.equal(apiPin?.[1], nvmrcVersion);
  const workerStage = dockerfile.slice(
    dockerfile.indexOf('AS worker'),
    dockerfile.indexOf('AS api'),
  );
  assert.doesNotMatch(workerStage, /PDF_WORKER_NODE_VERSION/);
  assert.doesNotMatch(workerStage, /COPY --from=builder \/usr\/local\/bin\//);
  assert.doesNotMatch(workerStage, /rm -f \/usr\/bin\/node/);
  assert.doesNotMatch(workerStage, /apt-get/);
  assert.match(workerStage, /verify-pdf-worker-node\.sh/);
});

test('build workflow builds api and pdf-worker images and runs Node 26 checks', () => {
  assert.match(buildWorkflow, /pdf-worker-image:/);
  assert.match(buildWorkflow, /--target worker/);
  assert.match(buildWorkflow, /--target api/);
  assert.match(buildWorkflow, /pdf-worker-image-smoke\.mjs/);
  assert.match(buildWorkflow, /verify-pdf-worker-node\.sh/);
});
