import fs from 'node:fs'
import path from 'node:path'

/**
 * @returns {{ pgHost: string, pgPort: number, pgUser: string, pgPassword: string }}
 */
export function postgresConfigFromEnv(env = process.env) {
  return {
    pgHost: env.ACP_WORKTREE_PG_HOST ?? 'localhost',
    pgPort: Number(env.ACP_WORKTREE_PG_PORT ?? '5433'),
    pgUser: env.ACP_WORKTREE_PG_USER ?? 'postgres',
    pgPassword: env.ACP_WORKTREE_PG_PASSWORD ?? 'postgres',
  }
}

/**
 * @param {string} worktreePath
 */
export function readWorktreeMetadata(worktreePath) {
  const metaPath = path.join(worktreePath, '.acp', 'worktree.json')
  if (!fs.existsSync(metaPath)) return null
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

/**
 * @param {string} metaPath
 * @param {object} data
 */
export function writeWorktreeMetadata(metaPath, data) {
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  fs.writeFileSync(metaPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/**
 * @param {string} filePath
 * @param {string} content
 */
export function writeFileIfChanged(filePath, content) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
  if (prev === content) return false
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

/**
 * @param {string} primaryRoot
 * @param {string} relPath
 * @param {string} examplePath
 */
export function readEnvTemplate(primaryRoot, relPath, examplePath) {
  const primaryFile = path.join(primaryRoot, relPath)
  if (fs.existsSync(primaryFile)) {
    return fs.readFileSync(primaryFile, 'utf8')
  }
  return fs.readFileSync(path.join(primaryRoot, examplePath), 'utf8')
}
