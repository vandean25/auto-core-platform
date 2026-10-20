import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateGate } from './repowise-gate-lib.mjs';
import { applyWorkingTreeAtMergeBase, commitSquashSnapshot } from './repowise-gate.mjs';

const DOC = 'docs/internal/05-Runbooks/lint-prisma-tenant.ts';

function gitIn(cwd, args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=Repowise Gate Test', '-c', 'user.email=gate-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function writeFiles(dir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
}

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repowise-gate-'));
  gitIn(dir, ['init', '-q']);
  writeFiles(dir, files);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

test('squash head worktree applies the merge-base diff and records one synthetic commit', () => {
  const tracked = 'tools/noisy-history.mjs';
  const dir = makeRepo({
    [tracked]: 'export const v = 1;\n',
    [DOC]: 'docs\n',
  });
  const baseSha = gitIn(dir, ['rev-parse', 'HEAD']);
  for (let index = 1; index <= 4; index += 1) {
    writeFiles(dir, { [tracked]: `export const v = ${index + 1};\n` });
    gitIn(dir, ['add', tracked]);
    gitIn(dir, ['commit', '-q', '-m', `wip ${index}`]);
  }
  writeFiles(dir, { [tracked]: 'export const v = 99;\nexport const extra = 2;\n' });
  gitIn(dir, ['add', tracked]);
  gitIn(dir, ['commit', '-q', '-m', 'final']);

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repowise-squash-'));
  const worktree = path.join(workRoot, 'head');
  try {
    gitIn(dir, ['worktree', 'add', worktree, baseSha]);
    applyWorkingTreeAtMergeBase(dir, worktree, baseSha);
    commitSquashSnapshot(worktree);
    assert.equal(
      fs.readFileSync(path.join(worktree, tracked), 'utf8'),
      fs.readFileSync(path.join(dir, tracked), 'utf8'),
    );
    assert.equal(gitIn(dir, ['rev-list', '--count', 'HEAD']), '6');
    assert.equal(gitIn(worktree, ['rev-list', '--count', 'HEAD']), '2');
    assert.match(gitIn(worktree, ['log', '-1', '--format=%s']), /squash snapshot/);
  } finally {
    try {
      gitIn(dir, ['worktree', 'remove', '--force', worktree]);
    } catch {
      // removed with the temp dir either way
    }
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
});

test('history-only score drop on a new file passes under squash-equivalent head scores', () => {
  const newController = 'apps/core-api/src/workshop/workshop-orders.controller.ts';
  const pass = evaluateGate({
    changes: [{ status: 'A', path: newController }],
    baseScores: new Map(),
    headScores: new Map([[newController, 9.05]]),
    baseline: { files: {} },
  });
  assert.deepEqual(pass.violations, []);

  const fail = evaluateGate({
    changes: [{ status: 'A', path: newController }],
    baseScores: new Map(),
    headScores: new Map([[newController, 5.55]]),
    baseline: { files: {} },
  });
  assert.equal(fail.violations[0]?.kind, 'new-below-floor');
});
