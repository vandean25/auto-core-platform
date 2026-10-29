import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { parseNewArgv, parseRemoveArgv, parseSetupArgv } from './worktree-cli-parse.mjs'
import { dropDatabaseIfExists, ensureDatabase } from './worktree-db.mjs'
import {
  branchHasUnpushedCommits,
  createDefaultGitRunner,
  fetchOriginMainSafe,
  resolveGitRepositoryRoot,
  resolvePrimaryWorktreePathFromGit,
  resolveWorktreeTargetPath,
} from './worktree-git-lib.mjs'
import {
  isPrimaryWorktreeCheckout,
  isProtectedPrimaryBranch,
  redactEnvPreview,
  rewriteEnvContent,
} from './worktree-lib.mjs'
import {
  postgresConfigFromEnv,
  readEnvTemplate,
  readWorktreeMetadata,
  writeFileIfChanged,
  writeWorktreeMetadata,
} from './worktree-metadata.mjs'
import {
  planNewWorktree,
  resolveDatabaseUrl,
  resolvePortPair,
  resolveSeedName,
} from './worktree-setup-plan.mjs'

/** @typedef {(args: string[], cwd: string) => string} GitRunner */

export function printSetupHelp() {
  console.log(`Usage: node tools/worktree/worktree-setup.mjs [options]

Idempotent setup for the current git worktree: ports, env files, local Postgres DB, migrations.

Options:
  --seed-name <name>     Stable port/db slug (default: worktree folder name)
  --database-url <url>   Use a remote DB (e.g. Neon branch) instead of local Docker Postgres
  --pg-host <host>       Postgres host (default: localhost or ACP_WORKTREE_PG_HOST)
  --pg-port <port>       Postgres port (default: 5433 or ACP_WORKTREE_PG_PORT)
  --skip-install         Do not run npm install
  --skip-migrate         Do not run prisma migrate deploy
  --seed                 Run prisma db seed after migrate deploy
  --help                 Show this help

Environment:
  ACP_WORKTREE_PG_HOST, ACP_WORKTREE_PG_PORT, ACP_WORKTREE_PG_USER, ACP_WORKTREE_PG_PASSWORD

Start Docker Postgres (once per machine):
  docker compose -f docker-compose.worktrees.yml up -d
`)
}

export function printNewHelp() {
  console.log(`Usage: npm run worktree:new -- <name> [--branch <branch>] [--base origin/main]

Creates .worktrees/<name> on branch feature/<name> by default (override with --branch),
from the base ref, then runs worktree:setup inside it.
`)
}

export function printRemoveHelp() {
  console.log(`Usage: npm run worktree:remove -- <path|.worktrees/name> [--drop-db] [--force]

Removes a linked worktree. Refuses to delete a branch that has unpushed commits.
Use --force only when git worktree remove needs it (uncommitted local files).
`)
}

function runCommand(command, args, options = {}) {
  const { env, ...rest } = options
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: env ? { ...process.env, ...env } : process.env,
    ...rest,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function guardPrimaryMainCheckout(repoRoot, git) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
  if (isPrimaryWorktreeCheckout(repoRoot) && isProtectedPrimaryBranch(branch)) {
    console.error(
      'Refusing to run worktree:setup in the primary checkout on main/master.\n' +
        'Create a linked worktree first: npm run worktree:new -- <name>',
    )
    process.exit(1)
  }
}

function writeWorktreeEnvFiles(repoRoot, ports, databaseUrl, git) {
  const primaryRoot = resolvePrimaryWorktreePathFromGit(repoRoot, git)
  const apiEnvTemplate = readEnvTemplate(primaryRoot, 'apps/core-api/.env', 'apps/core-api/.env.example')
  const webEnvTemplate = readEnvTemplate(
    primaryRoot,
    'apps/core-web/.env.local',
    'apps/core-web/.env.example',
  )
  const webOverrides = {
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${ports.apiPort}`,
  }
  writeFileIfChanged(
    path.join(repoRoot, 'apps/core-api/.env'),
    rewriteEnvContent(apiEnvTemplate, {
      PORT: String(ports.apiPort),
      DATABASE_URL: databaseUrl,
      DATABASE_URL_POOLED: '',
    }),
  )
  writeFileIfChanged(
    path.join(repoRoot, 'apps/core-web/.env.local'),
    rewriteEnvContent(webEnvTemplate, webOverrides),
  )
  return { primaryRoot, webOverrides }
}

function runInstallAndMigrate(args, repoRoot, databaseUrl) {
  if (!args.skipInstall) {
    runCommand('npm', ['install'], { cwd: repoRoot })
  }
  if (args.skipMigrate) return
  runCommand('npm', ['exec', '--workspace=core-api', '--', 'prisma', 'generate'], { cwd: repoRoot })
  runCommand('npm', ['exec', '--workspace=core-api', '--', 'prisma', 'migrate', 'deploy'], {
    cwd: repoRoot,
    env: { DATABASE_URL: databaseUrl },
  })
  if (args.withSeed) {
    runCommand('npm', ['exec', '--workspace=core-api', '--', 'prisma', 'db', 'seed'], {
      cwd: repoRoot,
      env: { DATABASE_URL: databaseUrl },
    })
  }
}

function printSetupSummary(repoRoot, metaPath, summary) {
  const preview = redactEnvPreview({
    PORT: String(summary.ports.apiPort),
    DATABASE_URL: summary.databaseUrl,
    VITE_API_PROXY_TARGET: summary.webOverrides.VITE_API_PROXY_TARGET,
  })
  console.log('\nWorktree ready.\n')
  console.log(`  Metadata: ${path.relative(repoRoot, metaPath)}`)
  console.log(`  API port: ${summary.ports.apiPort}`)
  console.log(`  Web port: ${summary.ports.webPort}`)
  console.log(`  Database: ${summary.dbName}`)
  console.log('  Env preview:', preview)
  console.log('\nStart servers (two terminals):\n')
  console.log(`  cd "${repoRoot}"`)
  console.log(`  npm run start:dev --workspace=core-api`)
  console.log(`  npm run dev --workspace=core-web -- --port ${summary.ports.webPort}`)
  console.log('\nOptional: pull shared dev secrets from GSM (never commit .env files):')
  console.log('  npm --prefix apps/core-api run secrets:pull')
  console.log('  npm --prefix apps/core-web run secrets:pull')
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, git?: GitRunner }} [deps]
 */
export async function runWorktreeSetup(argv, deps = {}) {
  const args = parseSetupArgv(argv)
  if (args.help) {
    printSetupHelp()
    return
  }

  const cwd = deps.cwd ?? process.cwd()
  const git = deps.git ?? createDefaultGitRunner()
  const repoRoot = git(['rev-parse', '--show-toplevel'], cwd)
  guardPrimaryMainCheckout(repoRoot, git)

  const seedName = resolveSeedName(args, repoRoot)
  const metaPath = path.join(repoRoot, '.acp', 'worktree.json')
  const metadata = readWorktreeMetadata(repoRoot)
  const ports = await resolvePortPair(metadata, repoRoot)
  const { dbName, databaseUrl } = resolveDatabaseUrl(args, seedName, metadata)

  if (!args.databaseUrl) {
    ensureDatabase(args, dbName)
  }

  const { primaryRoot, webOverrides } = writeWorktreeEnvFiles(repoRoot, ports, databaseUrl, git)
  writeWorktreeMetadata(metaPath, {
    version: 1,
    slug: seedName,
    apiPort: ports.apiPort,
    webPort: ports.webPort,
    slot: ports.slot,
    databaseName: dbName,
    primaryWorktree: primaryRoot,
    updatedAt: new Date().toISOString(),
  })

  runInstallAndMigrate(args, repoRoot, databaseUrl)
  printSetupSummary(repoRoot, metaPath, { ports, dbName, databaseUrl, webOverrides })
}

export function dropWorktreeDatabaseForPath(worktreePath) {
  const meta = readWorktreeMetadata(worktreePath)
  if (!meta?.databaseName) return
  dropDatabaseIfExists(postgresConfigFromEnv(), meta.databaseName)
}

function runSetupScript(repoRoot, worktreePath, dirName, deps) {
  const spawn = deps.spawn ?? spawnSync
  const setupScript = path.join(repoRoot, 'tools/worktree/worktree-setup.mjs')
  const execPath = deps.execPath ?? process.execPath
  const setup = spawn(execPath, [setupScript, '--seed-name', dirName], {
    cwd: worktreePath,
    stdio: 'inherit',
  })
  if (setup.status !== 0) {
    process.exit(setup.status ?? 1)
  }
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, git?: GitRunner, execPath?: string, spawn?: Function }} [deps]
 */
export function runWorktreeNew(argv, deps = {}) {
  const args = parseNewArgv(argv)
  if (args.help || !args.name) {
    printNewHelp()
    process.exit(args.help ? 0 : 1)
  }

  const cwd = deps.cwd ?? process.cwd()
  const git = deps.git ?? createDefaultGitRunner()
  const repoRoot = git(['rev-parse', '--show-toplevel'], cwd)
  const plan = planNewWorktree(args.name, args.branch, repoRoot, deps.pathExists)

  fetchOriginMainSafe(repoRoot, git)
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync.bind(fs)
  mkdirSync(path.dirname(plan.worktreePath), { recursive: true })
  git(['worktree', 'add', '-b', plan.branch, plan.worktreePath, args.base], repoRoot)
  runSetupScript(repoRoot, plan.worktreePath, plan.dirName, deps)
  console.log(`\nWorktree created at ${plan.worktreePath} on branch ${plan.branch}`)
}

function removeWorktreeGitRefs(gitRoot, worktreePath, branch, force, git) {
  const removeArgs = ['worktree', 'remove', worktreePath]
  if (force) removeArgs.push('--force')
  git(removeArgs, gitRoot)
  try {
    git(['branch', '-d', branch], gitRoot)
  } catch {
    console.log(`Left branch ${branch} in place (not fully merged or still checked out elsewhere).`)
  }
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, git?: GitRunner }} [deps]
 */
export function runWorktreeRemove(argv, deps = {}) {
  const args = parseRemoveArgv(argv)
  if (args.help) {
    printRemoveHelp()
    return
  }

  const cwd = deps.cwd ?? process.cwd()
  const git = deps.git ?? createDefaultGitRunner()
  const gitRoot = resolveGitRepositoryRoot(cwd, git)
  const worktreePath = resolveWorktreeTargetPath(gitRoot, args.target, cwd, git)
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath)

  if (branchHasUnpushedCommits(gitRoot, branch, git)) {
    console.error(
      `Refusing to remove worktree: branch ${branch} has commits not on origin/${branch}. Push or merge first.`,
    )
    process.exit(1)
  }

  if (args.dropDb) {
    dropWorktreeDatabaseForPath(worktreePath)
  }

  removeWorktreeGitRefs(gitRoot, worktreePath, branch, args.force, git)
  console.log(`Removed worktree ${worktreePath}`)
}
