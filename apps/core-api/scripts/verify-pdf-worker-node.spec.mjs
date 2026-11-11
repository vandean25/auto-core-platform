import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
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
      PDF_WORKER_NODE_VERSION: '24.22.2',
      PATH: `${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    },
    encoding: 'utf8',
  });
  assert.match(output, /^node -v: v24\.22\.2$/m);
  assert.match(output, /^npm -v: /m);
  assert.match(output, /^which -a node: /m);
  for (const line of output.split('\n')) {
    if (line.startsWith('which -a node:')) {
      const paths = line.replace('which -a node:', '').trim().split(/\s+/);
      assert.ok(paths.length >= 1);
    }
  }
});

test('Dockerfile pins exact Node 24.22.2 and runs verify-pdf-worker-node.sh', () => {
  assert.match(dockerfile, /ARG PDF_WORKER_NODE_VERSION=24\.22\.2/);
  assert.match(dockerfile, /^FROM node:24\.22\.2-slim AS builder$/m);
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
