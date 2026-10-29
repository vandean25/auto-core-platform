#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import { dropDatabaseIfExists } from './worktree-db.mjs'

function parseArgs(argv) {
  const out = { target: undefined, dropDb: false, force: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--drop-db') out.dropDb = true
    else if (arg === '--force') out.force = true
    else if (!out.target) out.target = arg
    else throw new Error(`Unexpected argument: ${arg}`)
  }
  return out
}

function printHelp() {
  console.log(`Usage: npm run worktree:remove -- <path|.worktrees/name> [--drop-db] [--force]

Removes a linked worktree. Refuses to delete a branch that has unpushed commits.
Use --force only when git worktree remove needs it (uncommitted local files).
`)
}

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function resolveWorktreePath(repoRoot, target) {
  if (!target) {
    return runGit(['rev-parse', '--show-toplevel'], process.cwd())
  }
  if (path.isAbsolute(target)) return target
  return path.resolve(repoRoot, target)
}

function branchHasUnpushedCommits(repoRoot, branch) {
  try {
    runGit(['fetch', 'origin'], repoRoot)
  } catch {
    // offline or no remote
  }
  const upstreamRef = `origin/${branch}`
  try {
    runGit(['rev-parse', '--verify', upstreamRef], repoRoot)
    const ahead = runGit(['rev-list', '--count', `${upstreamRef}..${branch}`], repoRoot)
    return Number(ahead) > 0
  } catch {
    try {
      const ahead = runGit(['rev-list', '--count', `origin/main..${branch}`], repoRoot)
      return Number(ahead) > 0
    } catch {
      return true
    }
  }
}

function dropWorktreeDatabase(worktreePath) {
  const metaPath = path.join(worktreePath, '.acp', 'worktree.json')
  if (!fs.existsSync(metaPath)) return
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  if (!meta.databaseName) return
  dropDatabaseIfExists(
    {
      pgHost: process.env.ACP_WORKTREE_PG_HOST ?? 'localhost',
      pgPort: Number(process.env.ACP_WORKTREE_PG_PORT ?? '5433'),
      pgUser: process.env.ACP_WORKTREE_PG_USER ?? 'postgres',
      pgPassword: process.env.ACP_WORKTREE_PG_PASSWORD ?? 'postgres',
    },
    meta.databaseName,
  )
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const commonDir = runGit(['rev-parse', '--git-common-dir'], process.cwd())
  const gitRoot = path.dirname(path.resolve(process.cwd(), commonDir))
  const worktreePath = resolveWorktreePath(gitRoot, args.target)

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)
  if (branchHasUnpushedCommits(gitRoot, branch)) {
    console.error(
      `Refusing to remove worktree: branch ${branch} has commits not on origin/${branch}. Push or merge first.`,
    )
    process.exit(1)
  }

  if (args.dropDb) {
    dropWorktreeDatabase(worktreePath)
  }

  const removeArgs = ['worktree', 'remove', worktreePath]
  if (args.force) removeArgs.push('--force')
  runGit(removeArgs, gitRoot)

  try {
    runGit(['branch', '-d', branch], gitRoot)
  } catch {
    console.log(`Left branch ${branch} in place (not fully merged or still checked out elsewhere).`)
  }

  console.log(`Removed worktree ${worktreePath}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
