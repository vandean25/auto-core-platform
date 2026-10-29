import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** @typedef {{ apiPort: number, webPort: number, slot: number }} PortPair */

const ENV_LINE = /^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/

/**
 * Postgres identifier: lowercase, starts with letter, max 63 chars.
 * @param {string} name
 */
export function databaseNameFromSlug(name) {
  const normalized = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  const body = normalized.length > 0 ? normalized : 'worktree'
  const prefixed = body.startsWith('acp_') ? body : `acp_${body}`
  const safe = prefixed.replace(/^[^a-z]+/, 'a')
  return safe.length <= 63 ? safe : safe.slice(0, 63)
}

/**
 * @param {string} input
 */
export function hashSeed(input) {
  const digest = crypto.createHash('sha256').update(String(input)).digest()
  return digest.readUInt32BE(0)
}

/**
 * Deterministic first guess for API + Vite ports from a stable seed string.
 * @param {string} seed
 * @returns {{ apiPort: number, webPort: number, slot: number }}
 */
export function basePortPairFromSeed(seed) {
  const slot = hashSeed(seed) % 400
  return {
    slot,
    apiPort: 3001 + slot * 2,
    webPort: 5174 + slot * 2,
  }
}

/**
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

/**
 * Pick a port pair: deterministic slot first, then linear probe.
 * @param {{ seed: string, isFree?: (port: number) => Promise<boolean>, maxAttempts?: number }} options
 * @returns {Promise<PortPair>}
 */
export async function allocatePortPair(options) {
  const isFree = options.isFree ?? ((port) => isPortFree(port))
  const maxAttempts = options.maxAttempts ?? 80
  const { slot: startSlot } = basePortPairFromSeed(options.seed)

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slot = (startSlot + attempt) % 400
    const apiPort = 3001 + slot * 2
    const webPort = 5174 + slot * 2
    const apiOk = await isFree(apiPort)
    const webOk = await isFree(webPort)
    if (apiOk && webOk) {
      return { apiPort, webPort, slot }
    }
  }

  throw new Error(`Could not find a free API/Vite port pair after ${maxAttempts} attempts`)
}

/**
 * Parse dotenv-style content into ordered entries (comments preserved separately).
 * @param {string} content
 */
export function parseEnvContent(content) {
  /** @type {{ type: 'blank' | 'comment' | 'entry', raw?: string, key?: string, value?: string }[]} */
  const lines = []
  for (const rawLine of content.split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      lines.push({ type: 'blank', raw: rawLine })
      continue
    }
    if (rawLine.trimStart().startsWith('#')) {
      lines.push({ type: 'comment', raw: rawLine })
      continue
    }
    const match = rawLine.match(ENV_LINE)
    if (!match?.groups?.key) {
      lines.push({ type: 'comment', raw: rawLine })
      continue
    }
    lines.push({
      type: 'entry',
      key: match.groups.key,
      value: match.groups.value ?? '',
      raw: rawLine,
    })
  }
  return lines
}

/**
 * @param {string} content
 * @param {Record<string, string>} overrides
 */
export function rewriteEnvContent(content, overrides) {
  const lines = parseEnvContent(content)
  const seen = new Set()
  const out = []

  for (const line of lines) {
    if (line.type !== 'entry' || !line.key) {
      out.push(line.raw ?? '')
      continue
    }
    if (Object.prototype.hasOwnProperty.call(overrides, line.key)) {
      out.push(`${line.key}=${overrides[line.key]}`)
      seen.add(line.key)
      continue
    }
    out.push(line.raw ?? `${line.key}=${line.value ?? ''}`)
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) {
      out.push(`${key}=${value}`)
    }
  }

  return `${out.join('\n').replace(/\n?$/, '\n')}`
}

/**
 * @param {{ user?: string, password?: string, host?: string, port?: number, database: string, schema?: string | false }} params
 */
export function buildPostgresUrl(params) {
  const user = encodeURIComponent(params.user ?? 'postgres')
  const password = encodeURIComponent(params.password ?? 'postgres')
  const host = params.host ?? 'localhost'
  const port = params.port ?? 5432
  const database = params.database
  const base = `postgresql://${user}:${password}@${host}:${port}/${database}`
  if (params.schema === false) {
    return base
  }
  const schema = params.schema ?? 'public'
  return `${base}?schema=${schema}`
}

/** Keys whose values must never appear in user-facing logs. */
export const SECRET_ENV_KEYS = new Set([
  'SECRET_ENCRYPTION_KEY',
  'CATALOG_HIT_HMAC_SECRET',
  'API_KEY_PEPPER',
  'CLOUD_TASKS_WORKER_SECRET',
  'OPENROUTER_API_KEY',
  'GCP_CREDENTIALS',
  'DATABASE_URL',
  'DATABASE_URL_POOLED',
  'SENTRY_DSN',
  'VITE_FIREBASE_API_KEY',
  'SENTRY_AUTH_TOKEN',
])

/**
 * @param {Record<string, string>} envPreview
 */
export function redactEnvPreview(envPreview) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, value] of Object.entries(envPreview)) {
    out[key] = SECRET_ENV_KEYS.has(key) ? '(set, redacted)' : value
  }
  return out
}

/**
 * @param {string} repoRoot
 */
export function readPrimaryWorktreePath(repoRoot) {
  const gitPath = path.join(repoRoot, '.git')
  const stat = fs.existsSync(gitPath) ? fs.statSync(gitPath) : null
  if (stat?.isFile()) {
    const gitdir = fs.readFileSync(gitPath, 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
    if (gitdir) {
      return path.resolve(repoRoot, gitdir, '..', '..')
    }
  }
  return repoRoot
}

/**
 * True when cwd is the primary checkout (not a linked worktree).
 * @param {string} cwd
 */
export function isPrimaryWorktreeCheckout(cwd) {
  const gitPath = path.join(cwd, '.git')
  if (!fs.existsSync(gitPath)) {
    return false
  }
  return fs.statSync(gitPath).isDirectory()
}

/**
 * @param {string} branch
 */
export function isProtectedPrimaryBranch(branch) {
  const normalized = branch.trim()
  return normalized === 'main' || normalized === 'master'
}

/**
 * @param {string} name
 */
export function sanitizeWorktreeDirectoryName(name) {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * @param {string} name
 */
export function defaultFeatureBranchName(name) {
  const slug = sanitizeWorktreeDirectoryName(name).toLowerCase().replace(/\./g, '-')
  return `feature/${slug || 'worktree'}`
}

/** docker-compose.worktrees.yml Postgres service (see repo root compose file). */
export const WORKTREES_COMPOSE_POSTGRES_SERVICE = 'postgres'
export const WORKTREES_POSTGRES_CONTAINER = 'acp-worktrees-postgres'

/**
 * @param {{ psqlOnPath: boolean, dockerOnPath: boolean, worktreesContainerRunning: boolean }} input
 * @returns {{ client: 'psql' } | { client: 'docker-exec', containerName: string } | { error: string }}
 */
export function chooseDatabaseClientStrategy(input) {
  if (input.psqlOnPath) {
    return { client: 'psql' }
  }
  if (!input.dockerOnPath) {
    return {
      error:
        'psql was not found on PATH (common on Windows) and docker is not available. ' +
        'Install PostgreSQL client tools, or install Docker and run: docker compose -f docker-compose.worktrees.yml up -d',
    }
  }
  if (!input.worktreesContainerRunning) {
    return {
      error:
        'psql was not found on PATH and the worktrees Postgres container is not running. ' +
        'Start it with: docker compose -f docker-compose.worktrees.yml up -d',
    }
  }
  return { client: 'docker-exec', containerName: WORKTREES_POSTGRES_CONTAINER }
}

/**
 * @param {string} datname
 */
export function sqlDatnameLiteral(datname) {
  return `'${String(datname).replace(/'/g, "''")}'`
}

/**
 * @param {string} identifier
 */
export function sqlIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}
