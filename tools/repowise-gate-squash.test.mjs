import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyWorkingTreeAtMergeBase } from './repowise-gate.mjs';

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
  gitIn(dir, ['commit', '-q', '-m', 'base snapshot']);
  return dir;
}

function headWorktree(dir, baseSha, mergeBase) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repowise-head-'));
  const worktree = path.join(workRoot, 'head');
  gitIn(dir, ['worktree', 'add', '--detach', worktree, baseSha]);
  applyWorkingTreeAtMergeBase(dir, worktree, mergeBase);
  return { workRoot, worktree };
}

function removeHeadWorktree(dir, workRoot, worktree) {
  try {
    gitIn(dir, ['worktree', 'remove', '--force', worktree]);
  } catch {
    // removed with the temp dir either way
  }
  fs.rmSync(workRoot, { recursive: true, force: true });
}

test('head worktree stays at the base commit while file bytes match the PR tree', () => {
  const tracked = 'tools/noisy-history.mjs';
  const dir = makeRepo({
    [tracked]: 'export const v = 1;\n',
    [DOC]: 'docs\n',
  });
  const baseSha = gitIn(dir, ['rev-parse', 'HEAD']);
  const baseSubject = gitIn(dir, ['log', '-1', '--format=%s']);
  for (let index = 1; index <= 4; index += 1) {
    writeFiles(dir, { [tracked]: `export const v = ${index + 1};\n` });
    gitIn(dir, ['add', tracked]);
    gitIn(dir, ['commit', '-q', '-m', `wip ${index}`]);
  }
  writeFiles(dir, { [tracked]: 'export const v = 99;\nexport const extra = 2;\n' });
  gitIn(dir, ['add', tracked]);
  gitIn(dir, ['commit', '-q', '-m', 'final']);

  const { workRoot, worktree } = headWorktree(dir, baseSha, baseSha);
  try {
    assert.equal(
      fs.readFileSync(path.join(worktree, tracked), 'utf8'),
      fs.readFileSync(path.join(dir, tracked), 'utf8'),
    );
    assert.equal(gitIn(dir, ['rev-list', '--count', 'HEAD']), '6');
    assert.equal(gitIn(worktree, ['rev-parse', 'HEAD']), baseSha);
    assert.equal(gitIn(worktree, ['rev-list', '--count', 'HEAD']), '1');
    assert.equal(gitIn(worktree, ['log', '-1', '--format=%s']), baseSubject);
  } finally {
    removeHeadWorktree(dir, workRoot, worktree);
  }
});

test('applyWorkingTreeAtMergeBase handles rename, deletion, binary, untracked, and uncommitted edits', () => {
  const oldPath = 'tools/old-name.mjs';
  const newPath = 'tools/renamed.mjs';
  const deleted = 'tools/remove-me.mjs';
  const binaryPath = 'tools/payload.bin';
  const untracked = 'tools/brand-new.mjs';
  const dirty = 'tools/dirty.mjs';
  const dir = makeRepo({
    [oldPath]: 'export const old = 1;\n',
    [deleted]: 'export const gone = 1;\n',
    [dirty]: 'export const dirty = 1;\n',
    [binaryPath]: Buffer.from([0, 1, 2, 255]),
    [DOC]: 'docs\n',
  });
  const baseSha = gitIn(dir, ['rev-parse', 'HEAD']);
  gitIn(dir, ['mv', oldPath, newPath]);
  writeFiles(dir, { [newPath]: 'export const renamed = 2;\n' });
  gitIn(dir, ['rm', deleted]);
  writeFiles(dir, { [binaryPath]: Buffer.from([9, 8, 7, 6]) });
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'tracked rename delete binary']);
  writeFiles(dir, {
    [untracked]: 'export const fresh = 1;\n',
    [dirty]: 'export const dirty = 99;\n',
  });

  const { workRoot, worktree } = headWorktree(dir, baseSha, baseSha);
  try {
    assert.equal(fs.existsSync(path.join(worktree, oldPath)), false);
    assert.equal(fs.readFileSync(path.join(worktree, newPath), 'utf8'), 'export const renamed = 2;\n');
    assert.equal(fs.existsSync(path.join(worktree, deleted)), false);
    assert.deepEqual(fs.readFileSync(path.join(worktree, binaryPath)), Buffer.from([9, 8, 7, 6]));
    assert.equal(fs.readFileSync(path.join(worktree, untracked), 'utf8'), 'export const fresh = 1;\n');
    assert.equal(fs.readFileSync(path.join(worktree, dirty), 'utf8'), 'export const dirty = 99;\n');
    assert.equal(gitIn(worktree, ['rev-parse', 'HEAD']), baseSha);
  } finally {
    removeHeadWorktree(dir, workRoot, worktree);
  }
});
