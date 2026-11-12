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

test('verify-pdf-worker-node.sh passes on the pinned Node runtime', () => {
  const nodeDir = path.dirname(process.execPath);
  const output = execFileSync('/bin/bash', [verifyScript], {
    env: {
      ...process.env,
      PDF_WORKER_NODE_VERSION: nvmrcVersion,
      PATH: `${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    },
    encoding: 'utf8',
  });
  assert.match(output, new RegExp(`^node -v: v${nvmrcVersion.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(output, /^npm -v: /m);
  assert.match(output, /^which -a node: /m);
  for (const line of output.split('\n')) {
    if (line.startsWith('which -a node:')) {
      const paths = line.replace('which -a node:', '').trim().split(/\s+/);
      assert.ok(paths.length >= 1);
    }
  }
});

test('Dockerfile pins digest Node from .nvmrc and runs verify-pdf-worker-node.sh', () => {
  const versionPattern = nvmrcVersion.replace(/\./g, '\\.');
  assert.match(dockerfile, new RegExp(`ARG PDF_WORKER_NODE_VERSION=${versionPattern}`));
  assert.match(
    dockerfile,
    new RegExp(
      `^FROM node:${versionPattern}-slim@sha256:[a-f0-9]{64} AS builder$`,
      'm',
    ),
  );
  assert.match(dockerfile, /COPY --from=builder \/usr\/local\/bin\//);
  assert.match(dockerfile, /COPY --from=builder \/usr\/local\/include\//);
  assert.match(dockerfile, /COPY --from=builder \/usr\/local\/lib\//);
  assert.match(dockerfile, /verify-pdf-worker-node\.sh/);
  assert.doesNotMatch(dockerfile, /setup_24\.x/);
  const workerStage = dockerfile.slice(dockerfile.indexOf('AS worker'));
  assert.doesNotMatch(workerStage, /apt-get/);
});

test('build workflow builds the pdf worker image and runs smoke', () => {
  assert.match(buildWorkflow, /pdf-worker-image:/);
  assert.match(buildWorkflow, /--target worker/);
  assert.match(buildWorkflow, /pdf-worker-image-smoke\.mjs/);
  assert.match(buildWorkflow, /verify-pdf-worker-node\.sh/);
});
