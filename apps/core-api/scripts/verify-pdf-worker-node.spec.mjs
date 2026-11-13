import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function withTempNvmrc(version, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'verify-pdf-worker-'));
  const nvmrcPath = path.join(dir, '.nvmrc');
  writeFileSync(nvmrcPath, `${version}\n`, 'utf8');
  try {
    return fn(dir, nvmrcPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verify-pdf-worker-node.sh passes when the single node binary matches .nvmrc exactly', () => {
  const nodeDir = path.dirname(process.execPath);
  withTempNvmrc(process.versions.node, (_dir, nvmrcPath) => {
    const output = execFileSync('/bin/bash', [verifyScript], {
      env: {
        ...process.env,
        PDF_WORKER_NVMRC_PATH: nvmrcPath,
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
});

test('verify-pdf-worker-node.sh fails when node differs from .nvmrc in patch version', () => {
  const nodeDir = path.dirname(process.execPath);
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  const mismatchedPatch = `${major}.${minor}.${patch + 1}`;
  withTempNvmrc(mismatchedPatch, (_dir, nvmrcPath) => {
    assert.throws(
      () =>
        execFileSync('/bin/bash', [verifyScript], {
          env: {
            ...process.env,
            PDF_WORKER_NVMRC_PATH: nvmrcPath,
            PDF_WORKER_NODE_CHECK_SYSTEM_DIRS: '0',
            PATH: nodeDir,
          },
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      /Expected Node v/,
    );
  });
});

test('verify-pdf-worker-node.sh fails when more than one node binary is on PATH', () => {
  const nodeDir = path.dirname(process.execPath);
  withTempNvmrc(process.versions.node, (dir, nvmrcPath) => {
    const extraBinDir = path.join(dir, 'extra-bin');
    execFileSync('mkdir', ['-p', extraBinDir]);
    const extraNode = path.join(extraBinDir, 'node');
    writeFileSync(extraNode, `#!/bin/sh\necho "v${process.versions.node}"\n`, 'utf8');
    chmodSync(extraNode, 0o755);
    assert.throws(
      () =>
        execFileSync('/bin/bash', [verifyScript], {
          env: {
            ...process.env,
            PDF_WORKER_NVMRC_PATH: nvmrcPath,
            PDF_WORKER_NODE_CHECK_SYSTEM_DIRS: '0',
            PATH: `${nodeDir}:${extraBinDir}`,
          },
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      /Expected exactly one node binary/,
    );
  });
});

test('Dockerfile pins digest Node from .nvmrc for builder/api and purges+copies exact Node into worker', () => {
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
  assert.match(workerStage, /apt-get purge -y nodejs\b/);
  assert.doesNotMatch(workerStage, /apt-get purge[^\n]*\|\| true/);
  assert.doesNotMatch(workerStage, /apt-get (update|install)/);
  assert.match(workerStage, /COPY --from=builder \/usr\/local\/bin\/node\b/);
  assert.match(
    workerStage,
    /COPY --from=builder \/usr\/local\/lib\/node_modules\b/,
  );
  assert.match(workerStage, /COPY \.nvmrc /);
  assert.match(workerStage, /verify-pdf-worker-node\.sh/);
});

test('build workflow builds api and pdf-worker images and runs Node 26 checks', () => {
  assert.match(buildWorkflow, /pdf-worker-image:/);
  assert.match(buildWorkflow, /--target worker/);
  assert.match(buildWorkflow, /--target api/);
  assert.match(buildWorkflow, /pdf-worker-image-smoke\.mjs/);
  assert.match(buildWorkflow, /verify-pdf-worker-node\.sh/);
});
