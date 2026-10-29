#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import {
  allocatePortPair,
  buildPostgresUrl,
  databaseNameFromSlug,
  defaultFeatureBranchName,
  isPrimaryWorktreeCheckout,
  isProtectedPrimaryBranch,
  readPrimaryWorktreePath,
  redactEnvPreview,
  rewriteEnvContent,
  sanitizeWorktreeDirectoryName,
} from './worktree-lib.mjs'

function parseArgs(argv) {
  const out = {
    seed: undefined,
    pgHost: process.env.ACP_WORKTREE_PG_HOST ?? 'localhost',
    pgPort: Number(process.env.ACP_WORKTREE_PG_PORT ?? '5433'),
    pgUser: process.env.ACP_WORKTREE_PG_USER ?? 'postgres',
    pgPassword: process.env.ACP_WORKTREE_PG_PASSWORD ?? 'postgres',
    databaseUrl: process.env.DATABASE_URL,
    skipInstall: false,
    skipMigrate: false,
    skipSeed: true,
    withSeed: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--skip-install') out.skipInstall = true
    else if (arg === '--skip-migrate') out.skipMigrate = true
    else if (arg === '--seed') {
      out.skipSeed = false
      out.withSeed = true
    } else if (arg === '--database-url') {
      out.databaseUrl = argv[++i]
    } else if (arg === '--pg-host') out.pgHost = argv[++i]
    else if (arg === '--pg-port') out.pgPort = Number(argv[++i])
    else if (arg === '--seed-name') out.seed = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (out.withSeed) out.skipSeed = false
  return out
}

function printHelp() {
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

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function listWorktrees(repoRoot) {
  const raw = runGit(['worktree', 'list', '--porcelain'], repoRoot)
  /** @type {{ path: string, branch?: string }[]} */
  const entries = []
  /** @type {{ path?: string, branch?: string }} */
  let current = {}
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current)
      current = { path: line.slice('worktree '.length) }
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length)
    }
  }
  if (current.path) entries.push(current)
  return entries
}

function resolvePrimaryWorktreePath(cwd) {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd)
  const entries = listWorktrees(toplevel)
  const mainEntry =
    entries.find((entry) => isPrimaryWorktreeCheckout(entry.path)) ??
    entries.find((entry) => entry.branch?.endsWith('/main') || entry.branch === 'refs/heads/main')
  return mainEntry?.path ?? readPrimaryWorktreePath(toplevel)
}

function readEnvTemplate(primaryRoot, relPath, examplePath) {
  const primaryFile = path.join(primaryRoot, relPath)
  if (fs.existsSync(primaryFile)) {
    return fs.readFileSync(primaryFile, 'utf8')
  }
  return fs.readFileSync(path.join(primaryRoot, examplePath), 'utf8')
}

function writeFileIfChanged(filePath, content) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
  if (prev === content) return false
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return true
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

function psqlAdminUrl(config) {
  return buildPostgresUrl({
    host: config.pgHost,
    port: config.pgPort,
    user: config.pgUser,
    password: config.pgPassword,
    database: 'postgres',
    schema: false,
  })
}

function ensureDatabase(config, dbName) {
  const adminUrl = psqlAdminUrl(config)
  const checkSql = `SELECT 1 FROM pg_database WHERE datname='${dbName.replace(/'/g, "''")}'`
  const check = spawnSync('psql', [adminUrl, '-tAc', checkSql], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (check.status !== 0) {
    throw new Error(
      `Could not reach Postgres at ${config.pgHost}:${config.pgPort}. ` +
        'Start docker compose -f docker-compose.worktrees.yml up -d or set ACP_WORKTREE_PG_* / --database-url.',
    )
  }
  if (check.stdout.trim() === '1') {
    return { created: false }
  }
  const createSql = `CREATE DATABASE "${dbName.replace(/"/g, '""')}"`
  runCommand('psql', [adminUrl, '-c', createSql])
  return { created: true }
}

function loadMetadata(metaPath) {
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

function saveMetadata(metaPath, data) {
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  fs.writeFileSync(metaPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const repoRoot = runGit(['rev-parse', '--show-toplevel'], process.cwd())
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
  if (isPrimaryWorktreeCheckout(repoRoot) && isProtectedPrimaryBranch(branch)) {
    console.error(
      'Refusing to run worktree:setup in the primary checkout on main/master.\n' +
        'Create a linked worktree first: npm run worktree:new -- <name>',
    )
    process.exit(1)
  }

  const seedName =
    args.seed ??
    (sanitizeWorktreeDirectoryName(path.basename(repoRoot)) ||
      defaultFeatureBranchName('worktree'))

  const metaPath = path.join(repoRoot, '.acp', 'worktree.json')
  let metadata = loadMetadata(metaPath)

  const ports =
    metadata?.apiPort && metadata?.webPort
      ? { apiPort: metadata.apiPort, webPort: metadata.webPort, slot: metadata.slot ?? -1 }
      : await allocatePortPair({ seed: path.resolve(repoRoot) })

  const dbName = metadata?.databaseName ?? databaseNameFromSlug(seedName)
  const databaseUrl =
    args.databaseUrl ??
    metadata?.databaseUrl ??
    buildPostgresUrl({
      host: args.pgHost,
      port: args.pgPort,
      user: args.pgUser,
      password: args.pgPassword,
      database: dbName,
    })

  if (!args.databaseUrl) {
    ensureDatabase(args, dbName)
  }

  const primaryRoot = resolvePrimaryWorktreePath(repoRoot)
  const apiEnvTemplate = readEnvTemplate(
    primaryRoot,
    'apps/core-api/.env',
    'apps/core-api/.env.example',
  )
  const webEnvTemplate = readEnvTemplate(
    primaryRoot,
    'apps/core-web/.env.local',
    'apps/core-web/.env.example',
  )

  const apiEnvPath = path.join(repoRoot, 'apps/core-api/.env')
  const webEnvPath = path.join(repoRoot, 'apps/core-web/.env.local')

  const apiOverrides = {
    PORT: String(ports.apiPort),
    DATABASE_URL: databaseUrl,
    DATABASE_URL_POOLED: '',
  }
  const webOverrides = {
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${ports.apiPort}`,
  }

  const apiEnv = rewriteEnvContent(apiEnvTemplate, apiOverrides)
  const webEnv = rewriteEnvContent(webEnvTemplate, webOverrides)

  writeFileIfChanged(apiEnvPath, apiEnv)
  writeFileIfChanged(webEnvPath, webEnv)

  metadata = {
    version: 1,
    slug: seedName,
    apiPort: ports.apiPort,
    webPort: ports.webPort,
    slot: ports.slot,
    databaseName: dbName,
    primaryWorktree: primaryRoot,
    updatedAt: new Date().toISOString(),
  }
  saveMetadata(metaPath, metadata)

  if (!args.skipInstall) {
    runCommand('npm', ['install'], { cwd: repoRoot })
  }

  if (!args.skipMigrate) {
    runCommand('npm', ['exec', '--workspace=core-api', '--', 'prisma', 'generate'], { cwd: repoRoot })
    runCommand(
      'npm',
      ['exec', '--workspace=core-api', '--', 'prisma', 'migrate', 'deploy'],
      { cwd: repoRoot, env: { ...process.env, DATABASE_URL: databaseUrl } },
    )
    if (args.withSeed) {
      runCommand('npm', ['exec', '--workspace=core-api', '--', 'prisma', 'db', 'seed'], {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
      })
    }
  }

  const preview = redactEnvPreview({
    PORT: String(ports.apiPort),
    DATABASE_URL: databaseUrl,
    VITE_API_PROXY_TARGET: webOverrides.VITE_API_PROXY_TARGET,
  })

  console.log('\nWorktree ready.\n')
  console.log(`  Metadata: ${path.relative(repoRoot, metaPath)}`)
  console.log(`  API port: ${ports.apiPort}`)
  console.log(`  Web port: ${ports.webPort}`)
  console.log(`  Database: ${dbName}`)
  console.log('  Env preview:', preview)
  console.log('\nStart servers (two terminals):\n')
  console.log(`  cd "${repoRoot}"`)
  console.log(`  npm run start:dev --workspace=core-api`)
  console.log(`  npm run dev --workspace=core-web -- --port ${ports.webPort}`)
  console.log('\nOptional: pull shared dev secrets from GSM (never commit .env files):')
  console.log('  npm --prefix apps/core-api run secrets:pull')
  console.log('  npm --prefix apps/core-web run secrets:pull')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
