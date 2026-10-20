#!/usr/bin/env node
/**
 * Repowise health gate (AUT-462). Compares `repowise health --format json` for the
 * PR base (a git worktree of the base commit) with the head tree patched onto the same
 * base commit in a second worktree (no extra commit — repowise reads file bytes from disk),
 * for the source files the change touches. Rules: see tools/repowise-gate-lib.mjs
 * and the Repowise section of agents.md.
 *
 * Exit codes: 0 passed (or nothing gated changed), 1 violations, 2 usage or setup error.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BASELINE_FILE,
  applyBaselineUpdate,
  evaluateGate,
  formatBaselineChanges,
  formatGateReport,
  parseBaseline,
  parseHealthJson,
  parseNameStatusZ,
  serializeBaseline,
  touchesGateSource,
} from './repowise-gate-lib.mjs';

const REPOWISE_PACKAGE = 'repowise==0.49.0';
const HEALTH_TIMEOUT_MS = 20 * 60 * 1000;

const USAGE = `Usage: node tools/repowise-gate.mjs [options]

  --base <ref>          Base commit to compare against (default: origin/main)
  --update              Record improved legacy scores in ${BASELINE_FILE}
  --baseline <file>     Baseline file (default: ${BASELINE_FILE} at the repo root)
  --base-health <json>  Saved \`repowise health --format json\` output for the base
  --head-health <json>  Saved \`repowise health --format json\` output for the head
`;

function parseArgs(argv) {
  const options = {
    base: 'origin/main',
    update: false,
    baseline: BASELINE_FILE,
    baseHealth: null,
    headHealth: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case '--base':
        options.base = value();
        break;
      case '--update':
        options.update = true;
        break;
      case '--baseline':
        options.baseline = value();
        break;
      case '--base-health':
        options.baseHealth = value();
        break;
      case '--head-health':
        options.headHealth = value();
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return options;
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function resolveBase(repoRoot, ref) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRoot).trim();
  } catch {
    throw new Error(`unknown base ref: ${ref}`);
  }
}

/**
 * Changes between the merge base and the working tree (committed and uncommitted),
 * plus untracked files. In CI the working tree is the PR merge commit, so this is the
 * PR's own diff against the base branch.
 */
function listChanges(repoRoot, baseSha) {
  const mergeBase = git(['merge-base', baseSha, 'HEAD'], repoRoot).trim();
  const tracked = parseNameStatusZ(git(['diff', '--name-status', '-z', '-M', mergeBase], repoRoot));
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'], repoRoot)
    .split('\0')
    .filter(Boolean)
    .map((filePath) => ({ status: 'A', path: filePath }));
  return [...tracked, ...untracked];
}

function runRepowiseHealth(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'uvx',
      ['--from', REPOWISE_PACKAGE, 'repowise', 'health', '--format', 'json', '--no-workspace', dir],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill(), HEALTH_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`could not run uvx (install uv to run repowise): ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`repowise health failed for ${dir} (exit ${code})\n${detail}`));
        return;
      }
      try {
        resolve(parseHealthJson(Buffer.concat(stdout).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
  });
}

const GIT_APPLY_MAX_BUFFER = 256 * 1024 * 1024;

/** Scores the base commit from a throwaway worktree outside the repo, so repowise never sees both trees. */
async function scoreBaseCommit(repoRoot, baseSha) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'repowise-base-'));
  const worktree = path.join(workdir, 'base');
  try {
    git(['worktree', 'add', '--detach', '--quiet', worktree, baseSha], repoRoot);
    return await runRepowiseHealth(worktree);
  } finally {
    removeWorktree(repoRoot, workdir, worktree);
  }
}

/**
 * Applies the working tree at `repoRoot` (relative to `mergeBase`) into `worktree`, including
 * untracked files the gate already treats as part of the change set.
 */
export function applyWorkingTreeAtMergeBase(repoRoot, worktree, mergeBase) {
  const diff = spawnSync('git', ['diff', '-M', '--binary', mergeBase], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: GIT_APPLY_MAX_BUFFER,
  });
  if (diff.error) {
    throw diff.error;
  }
  if (diff.status !== 0) {
    throw new Error(`git diff ${mergeBase} failed: ${diff.stderr.toString('utf8').trim()}`);
  }
  if (diff.stdout.length > 0) {
    const applied = spawnSync('git', ['apply', '--3way', '--whitespace=nowarn'], {
      cwd: worktree,
      input: diff.stdout,
      encoding: 'buffer',
      maxBuffer: GIT_APPLY_MAX_BUFFER,
    });
    if (applied.error) {
      throw applied.error;
    }
    if (applied.status !== 0) {
      throw new Error(`git apply failed: ${applied.stderr.toString('utf8').trim()}`);
    }
  }

  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'], repoRoot)
    .split('\0')
    .filter(Boolean);
  for (const relativePath of untracked) {
    const source = path.join(repoRoot, relativePath);
    const destination = path.join(worktree, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.statSync(source).isDirectory()) {
      fs.cpSync(source, destination, { recursive: true });
    } else {
      fs.copyFileSync(source, destination);
    }
  }
}

function removeWorktree(repoRoot, workdir, worktree) {
  try {
    git(['worktree', 'remove', '--force', worktree], repoRoot);
  } catch {
    // The directory is removed below either way; a stale worktree entry is pruned by git later.
  }
  fs.rmSync(workdir, { recursive: true, force: true });
}

/**
 * Scores the PR head from a throwaway worktree checked out at `baseSha` with the
 * merge-base → working-tree diff applied. Git history matches the base commit on both
 * sides; static markers see the patched files without feature-branch checkout noise
 * or a synthetic commit that would fire churn on large deletes.
 */
async function scorePatchedHead(repoRoot, baseSha) {
  const mergeBase = git(['merge-base', baseSha, 'HEAD'], repoRoot).trim();
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'repowise-head-'));
  const worktree = path.join(workdir, 'head');
  try {
    git(['worktree', 'add', '--detach', '--quiet', worktree, baseSha], repoRoot);
    applyWorkingTreeAtMergeBase(repoRoot, worktree, mergeBase);
    return await runRepowiseHealth(worktree);
  } finally {
    removeWorktree(repoRoot, workdir, worktree);
  }
}

function readHealthFile(file) {
  return parseHealthJson(fs.readFileSync(path.resolve(file), 'utf8'));
}

function loadBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    return { version: 1, files: {} };
  }
  return parseBaseline(fs.readFileSync(baselinePath, 'utf8'));
}

async function run(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const baseSha = resolveBase(repoRoot, options.base);
  const changes = listChanges(repoRoot, baseSha);
  if (!changes.some(touchesGateSource)) {
    console.log('Repowise health gate: no changed source files, nothing to check.');
    return 0;
  }

  const baselinePath = path.resolve(repoRoot, options.baseline);
  const baseline = loadBaseline(baselinePath);

  // Deleted files need no scores; skip both repowise runs when nothing else changed.
  const needsScores = changes.some((change) => change.status !== 'D' && touchesGateSource(change));
  const [baseScores, headScores] = needsScores
    ? await Promise.all([
        options.baseHealth ? readHealthFile(options.baseHealth) : scoreBaseCommit(repoRoot, baseSha),
        options.headHealth ? readHealthFile(options.headHealth) : scorePatchedHead(repoRoot, baseSha),
      ])
    : [new Map(), new Map()];

  const evaluation = evaluateGate({ changes, baseScores, headScores, baseline });

  if (!options.update) {
    console.log(formatGateReport(evaluation));
    return evaluation.violations.length > 0 ? 1 : 0;
  }

  if (evaluation.violations.some((violation) => violation.scope === 'code')) {
    console.log(formatGateReport(evaluation));
    console.error('Baseline not updated: fix the code violations above first.');
    return 1;
  }

  const { baseline: next, changes: updates } = applyBaselineUpdate(baseline, evaluation);
  if (updates.length === 0) {
    console.log(`${BASELINE_FILE} is already up to date.`);
    return 0;
  }
  fs.writeFileSync(baselinePath, serializeBaseline(next));
  console.log(`Updated ${BASELINE_FILE}:\n${formatBaselineChanges(updates)}`);
  return 0;
}

const isCliEntry =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCliEntry) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`repowise health gate: ${error.message}`);
      process.exitCode = 2;
    },
  );
}
