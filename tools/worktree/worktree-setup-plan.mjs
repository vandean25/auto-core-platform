import fs from 'node:fs'
import path from 'node:path'

import {
  allocatePortPair,
  buildPostgresUrl,
  databaseNameFromSlug,
  defaultFeatureBranchName,
  sanitizeWorktreeDirectoryName,
} from './worktree-lib.mjs'

/**
 * @param {{ seed?: string }} args
 * @param {string} repoRoot
 */
export function resolveSeedName(args, repoRoot) {
  const fromDir =
    sanitizeWorktreeDirectoryName(path.basename(repoRoot)) ||
    defaultFeatureBranchName('worktree')
  return args.seed ?? fromDir
}

/**
 * @param {{ apiPort?: number, webPort?: number, slot?: number } | null} metadata
 * @param {string} repoRoot
 */
export async function resolvePortPair(metadata, repoRoot) {
  if (metadata?.apiPort && metadata?.webPort) {
    return {
      apiPort: metadata.apiPort,
      webPort: metadata.webPort,
      slot: metadata.slot ?? -1,
    }
  }
  return allocatePortPair({ seed: path.resolve(repoRoot) })
}

/**
 * @param {{ databaseUrl?: string, pgHost: string, pgPort: number, pgUser: string, pgPassword: string }} args
 * @param {string} seedName
 * @param {{ databaseName?: string, databaseUrl?: string } | null} metadata
 */
export function resolveDatabaseUrl(args, seedName, metadata) {
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
  return { dbName, databaseUrl }
}

/**
 * @param {string} name
 * @param {string | undefined} branch
 * @param {string} repoRoot
 * @param {(filePath: string) => boolean} [pathExists]
 */
export function planNewWorktree(name, branch, repoRoot, pathExists = (p) => fs.existsSync(p)) {
  const dirName = sanitizeWorktreeDirectoryName(name)
  if (!dirName) {
    throw new Error('Worktree name is empty after sanitization')
  }
  const worktreePath = path.join(repoRoot, '.worktrees', dirName)
  if (pathExists(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`)
  }
  return {
    dirName,
    worktreePath,
    branch: branch ?? defaultFeatureBranchName(dirName),
  }
}
