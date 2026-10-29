import { parseArgs as nodeParseArgs } from 'node:util'

const SETUP_CLI_OPTIONS = {
  help: { type: 'boolean', short: 'h', default: false },
  'skip-install': { type: 'boolean', default: false },
  'skip-migrate': { type: 'boolean', default: false },
  seed: { type: 'boolean', default: false },
  'seed-name': { type: 'string' },
  'database-url': { type: 'string' },
  'pg-host': { type: 'string' },
  'pg-port': { type: 'string' },
}

const NEW_CLI_OPTIONS = {
  help: { type: 'boolean', short: 'h', default: false },
  branch: { type: 'string' },
  base: { type: 'string', default: 'origin/main' },
}

const REMOVE_CLI_OPTIONS = {
  help: { type: 'boolean', short: 'h', default: false },
  'drop-db': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
}

/**
 * @param {string[]} argv
 */
export function parseSetupArgv(argv) {
  const { values } = nodeParseArgs({
    args: argv,
    options: SETUP_CLI_OPTIONS,
    strict: true,
  })
  const withSeed = values.seed ?? false
  return {
    help: values.help ?? false,
    skipInstall: values['skip-install'] ?? false,
    skipMigrate: values['skip-migrate'] ?? false,
    withSeed,
    skipSeed: !withSeed,
    seed: values['seed-name'],
    databaseUrl: values['database-url'] ?? process.env.DATABASE_URL,
    pgHost: values['pg-host'] ?? process.env.ACP_WORKTREE_PG_HOST ?? 'localhost',
    pgPort: Number(values['pg-port'] ?? process.env.ACP_WORKTREE_PG_PORT ?? '5433'),
    pgUser: process.env.ACP_WORKTREE_PG_USER ?? 'postgres',
    pgPassword: process.env.ACP_WORKTREE_PG_PASSWORD ?? 'postgres',
  }
}

/**
 * @param {string[]} argv
 */
export function parseNewArgv(argv) {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: NEW_CLI_OPTIONS,
    allowPositionals: true,
    strict: true,
  })
  if (positionals.length > 1) {
    throw new Error(`Unexpected argument: ${positionals[1]}`)
  }
  return {
    help: values.help ?? false,
    name: positionals[0],
    branch: values.branch,
    base: values.base ?? 'origin/main',
  }
}

/**
 * @param {string[]} argv
 */
export function parseRemoveArgv(argv) {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: REMOVE_CLI_OPTIONS,
    allowPositionals: true,
    strict: true,
  })
  if (positionals.length > 1) {
    throw new Error(`Unexpected argument: ${positionals[1]}`)
  }
  return {
    help: values.help ?? false,
    target: positionals[0],
    dropDb: values['drop-db'] ?? false,
    force: values.force ?? false,
  }
}
