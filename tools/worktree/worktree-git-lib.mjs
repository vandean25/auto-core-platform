import path from 'node:path'
import { execFileSync as defaultExecFileSync } from 'node:child_process'

import {
  isPrimaryWorktreeCheckout,
  readPrimaryWorktreePath,
} from './worktree-lib.mjs'

/** @typedef {(args: string[], cwd: string) => string} GitRunner */

/**
 * @param {import('node:child_process').execFileSync} [execFileSync]
 */
export function createDefaultGitRunner(execFileSync = defaultExecFileSync) {
  /** @type {GitRunner} */
  return (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * @param {string} raw
 * @returns {{ path: string, branch?: string }[]}
 */
export function parseWorktreeListPorcelain(raw) {
  /** @type {{ path: string, branch?: string }[]} */
  const entries = []
  /** @type {{ path?: string, branch?: string }} */
  let current = {}
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(/** @type {{ path: string, branch?: string }} */ (current))
      current = { path: line.slice('worktree '.length) }
      continue
    }
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length)
    }
  }
  if (current.path) entries.push(/** @type {{ path: string, branch?: string }} */ (current))
  return entries
}

/**
 * @param {string} repoRoot
 * @param {GitRunner} git
 */
export function listWorktrees(repoRoot, git) {
  return parseWorktreeListPorcelain(git(['worktree', 'list', '--porcelain'], repoRoot))
}

/**
 * @param {string} cwd
 * @param {GitRunner} git
 */
export function resolvePrimaryWorktreePathFromGit(cwd, git) {
  const toplevel = git(['rev-parse', '--show-toplevel'], cwd)
  const entries = listWorktrees(toplevel, git)
  const mainEntry =
    entries.find((entry) => isPrimaryWorktreeCheckout(entry.path)) ??
    entries.find((entry) => entry.branch?.endsWith('/main') || entry.branch === 'refs/heads/main')
  return mainEntry?.path ?? readPrimaryWorktreePath(toplevel)
}

/**
 * @param {string} cwd
 * @param {GitRunner} git
 */
export function resolveGitRepositoryRoot(cwd, git) {
  const commonDir = git(['rev-parse', '--git-common-dir'], cwd)
  return path.dirname(path.resolve(cwd, commonDir))
}

/**
 * @param {string} gitRoot
 * @param {string | undefined} target
 * @param {string} cwd
 * @param {GitRunner} git
 */
export function resolveWorktreeTargetPath(gitRoot, target, cwd, git) {
  if (!target) {
    return git(['rev-parse', '--show-toplevel'], cwd)
  }
  if (path.isAbsolute(target)) return target
  return path.resolve(gitRoot, target)
}

/**
 * @param {string} repoRoot
 * @param {string} branch
 * @param {GitRunner} git
 */
export function branchHasUnpushedCommits(repoRoot, branch, git) {
  try {
    git(['fetch', 'origin'], repoRoot)
  } catch {
    // offline or no remote
  }
  const upstreamRef = `origin/${branch}`
  try {
    git(['rev-parse', '--verify', upstreamRef], repoRoot)
    const ahead = git(['rev-list', '--count', `${upstreamRef}..${branch}`], repoRoot)
    return Number(ahead) > 0
  } catch {
    try {
      const ahead = git(['rev-list', '--count', `origin/main..${branch}`], repoRoot)
      return Number(ahead) > 0
    } catch {
      return true
    }
  }
}

/**
 * @param {string} repoRoot
 * @param {GitRunner} git
 */
export function fetchOriginMainSafe(repoRoot, git) {
  try {
    git(['fetch', 'origin', 'main'], repoRoot)
  } catch {
    // origin/main may already be present
  }
}
