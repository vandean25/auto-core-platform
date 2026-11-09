import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { guardrailRepoRoot } from './guardrail-repo-root.mjs'

export function readAtRevision(repoRoot, ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

export function readHead(repoRoot, file) {
  const target = path.join(repoRoot, file)
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : undefined
}

export function verifyRevision(repoRoot, ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
  } catch {
    throw new Error(`Cannot resolve ${ref}. Fetch it first, for example: git fetch origin main`)
  }
}

export function resolveMergeBase(repoRoot, baseRef) {
  verifyRevision(repoRoot, baseRef)
  return execFileSync('git', ['merge-base', 'HEAD', baseRef], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

export function defaultRepoRoot() {
  return guardrailRepoRoot()
}

export function assertResolvableRevision(repoRoot, base, fail) {
  try {
    verifyRevision(repoRoot, base)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2)
  }
}
