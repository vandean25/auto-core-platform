#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import {
  defaultFeatureBranchName,
  sanitizeWorktreeDirectoryName,
} from './worktree-lib.mjs'

function parseArgs(argv) {
  const out = { name: undefined, branch: undefined, base: 'origin/main', help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--branch') out.branch = argv[++i]
    else if (arg === '--base') out.base = argv[++i]
    else if (!out.name) out.name = arg
    else throw new Error(`Unexpected argument: ${arg}`)
  }
  return out
}

function printHelp() {
  console.log(`Usage: npm run worktree:new -- <name> [--branch <branch>] [--base origin/main]

Creates .worktrees/<name> from the base ref and runs worktree:setup inside it.
`)
}

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.name) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }

  const repoRoot = runGit(['rev-parse', '--show-toplevel'], process.cwd())

  const dirName = sanitizeWorktreeDirectoryName(args.name)
  if (!dirName) {
    throw new Error('Worktree name is empty after sanitization')
  }
  const worktreePath = path.join(repoRoot, '.worktrees', dirName)
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`)
  }

  const branch = args.branch ?? defaultFeatureBranchName(dirName)
  try {
    runGit(['fetch', 'origin', 'main'], repoRoot)
  } catch {
    // origin/main may already be present
  }

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  runGit(['worktree', 'add', '-b', branch, worktreePath, args.base], repoRoot)

  const setupScript = path.join(repoRoot, 'tools/worktree/worktree-setup.mjs')
  const setup = spawnSync(process.execPath, [setupScript, '--seed-name', dirName], {
    cwd: worktreePath,
    stdio: 'inherit',
  })
  if (setup.status !== 0) {
    process.exit(setup.status ?? 1)
  }

  console.log(`\nWorktree created at ${worktreePath} on branch ${branch}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
