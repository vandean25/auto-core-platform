import { spawnSync } from 'node:child_process'

import {
  buildPostgresUrl,
  chooseDatabaseClientStrategy,
  sqlDatnameLiteral,
  sqlIdentifier,
  WORKTREES_POSTGRES_CONTAINER,
} from './worktree-lib.mjs'

/**
 * @typedef {{ status: number | null, stdout?: string, stderr?: string }} CommandResult
 * @typedef {(command: string, args: string[], options?: object) => CommandResult} CommandRunner
 */

/**
 * @param {string} command
 * @param {CommandRunner} [run]
 */
export function commandOnPath(command, run = defaultCommandRunner) {
  const checker = process.platform === 'win32' ? 'where' : 'which'
  const result = run(checker, [command], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return result.status === 0
}

/**
 * @param {CommandRunner} [run]
 */
export function isWorktreesPostgresContainerRunning(run = defaultCommandRunner) {
  const result = run(
    'docker',
    [
      'ps',
      '--filter',
      `name=^/${WORKTREES_POSTGRES_CONTAINER}$`,
      '--filter',
      'status=running',
      '-q',
    ],
    { encoding: 'utf8' },
  )
  return result.status === 0 && Boolean(result.stdout?.trim())
}

/**
 * @param {CommandRunner} [run]
 */
export function detectDatabaseClientStrategy(run = defaultCommandRunner) {
  const psqlOnPath = commandOnPath('psql', run)
  const dockerOnPath = commandOnPath('docker', run)
  const worktreesContainerRunning = dockerOnPath ? isWorktreesPostgresContainerRunning(run) : false
  return chooseDatabaseClientStrategy({ psqlOnPath, dockerOnPath, worktreesContainerRunning })
}

/**
 * @param {{ pgHost: string, pgPort: number, pgUser: string, pgPassword: string }} config
 * @param {ReturnType<typeof detectDatabaseClientStrategy> & { client: string }} strategy
 * @param {string[]} psqlArgs
 * @param {CommandRunner} run
 */
function runAdminPsql(config, strategy, psqlArgs, run) {
  if ('error' in strategy && strategy.error) {
    throw new Error(strategy.error)
  }
  if (strategy.client === 'psql') {
    const adminUrl = buildPostgresUrl({
      host: config.pgHost,
      port: config.pgPort,
      user: config.pgUser,
      password: config.pgPassword,
      database: 'postgres',
      schema: false,
    })
    return run('psql', [adminUrl, ...psqlArgs], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
  }
  return run(
    'docker',
    [
      'exec',
      strategy.containerName,
      'psql',
      '-U',
      config.pgUser,
      '-d',
      'postgres',
      ...psqlArgs,
    ],
    { encoding: 'utf8' },
  )
}

function postgresReachableError(config) {
  return (
    `Could not reach Postgres at ${config.pgHost}:${config.pgPort}. ` +
    'Start docker compose -f docker-compose.worktrees.yml up -d or set ACP_WORKTREE_PG_* / --database-url.'
  )
}

/**
 * @param {{ pgHost: string, pgPort: number, pgUser: string, pgPassword: string }} config
 * @param {string} dbName
 * @param {{ run?: CommandRunner, strategy?: ReturnType<typeof detectDatabaseClientStrategy> }} [deps]
 */
export function ensureDatabase(config, dbName, deps = {}) {
  const run = deps.run ?? defaultCommandRunner
  const strategy = deps.strategy ?? detectDatabaseClientStrategy(run)
  if ('error' in strategy && strategy.error) {
    throw new Error(strategy.error)
  }

  const checkSql = `SELECT 1 FROM pg_database WHERE datname=${sqlDatnameLiteral(dbName)}`
  const check = runAdminPsql(config, strategy, ['-tAc', checkSql], run)
  if (check.status !== 0) {
    throw new Error(postgresReachableError(config))
  }
  if (check.stdout?.trim() === '1') {
    return { created: false, client: strategy.client }
  }

  const createSql = `CREATE DATABASE ${sqlIdentifier(dbName)}`
  const create = runAdminPsql(config, strategy, ['-c', createSql], run)
  if (create.status !== 0) {
    throw new Error(postgresReachableError(config))
  }
  return { created: true, client: strategy.client }
}

/**
 * @param {{ pgHost: string, pgPort: number, pgUser: string, pgPassword: string }} config
 * @param {string} dbName
 * @param {{ run?: CommandRunner, strategy?: ReturnType<typeof detectDatabaseClientStrategy> }} [deps]
 */
export function dropDatabaseIfExists(config, dbName, deps = {}) {
  const run = deps.run ?? defaultCommandRunner
  const strategy = deps.strategy ?? detectDatabaseClientStrategy(run)
  if ('error' in strategy && strategy.error) {
    throw new Error(strategy.error)
  }
  const dropSql = `DROP DATABASE IF EXISTS ${sqlIdentifier(dbName)} WITH (FORCE)`
  const result = runAdminPsql(config, strategy, ['-c', dropSql], run)
  if (result.status !== 0) {
    throw new Error(postgresReachableError(config))
  }
}

/** @type {CommandRunner} */
function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, options)
}
