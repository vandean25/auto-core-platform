import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATION_PREFIX = 'apps/core-api/prisma/migrations/'
const HINT =
  'rebase after the other PR merges; if your folder timestamp is older than the newest on main, create a fresh migration instead of editing a merged one'
const TIMESTAMP_RE = /^(\d{14})_/

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function migrationFolderFromAddedPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized.startsWith(MIGRATION_PREFIX)) return null
  const rest = normalized.slice(MIGRATION_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const folder = rest.slice(0, slash)
  return TIMESTAMP_RE.test(folder) ? folder : null
}

/**
 * @param {string | null | undefined} linkHeader
 * @param {string} apiBase
 * @returns {string | null}
 */
function nextPageUrl(linkHeader, apiBase) {
  if (!linkHeader) return null
  let allowed
  try {
    allowed = new URL(apiBase)
  } catch {
    return null
  }
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim())
    if (!match) continue
    try {
      const next = new URL(match[1])
      if (next.origin === allowed.origin) return next.href
    } catch {
      continue
    }
  }
  return null
}

/**
 * @param {string} folder
 * @returns {string | null}
 */
function folderTimestamp(folder) {
  const match = TIMESTAMP_RE.exec(folder)
  return match ? match[1] : null
}

/**
 * @param {string[]} addedFolders
 * @param {string | null} newestOnMain
 * @returns {string[]}
 */
function foldersOlderThanMain(addedFolders, newestOnMain) {
  const newestTimestamp = newestOnMain ? folderTimestamp(newestOnMain) : null
  if (!newestTimestamp) return []
  return addedFolders.filter((folder) => {
    const timestamp = folderTimestamp(folder)
    return timestamp !== null && timestamp < newestTimestamp
  })
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} firstUrl
 * @param {string} token
 * @param {string} apiBase
 */
async function githubGetAll(fetchImpl, firstUrl, token, apiBase) {
  /** @type {unknown[]} */
  const items = []
  const seen = new Set()
  let url = firstUrl
  while (url) {
    if (seen.has(url) || seen.size >= 20) break
    seen.add(url)
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'migration-overlap-check',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) {
      throw new Error(`GitHub API returned HTTP ${response.status}`)
    }
    const body = await response.json()
    if (!Array.isArray(body)) {
      throw new Error('GitHub API returned a non-list response')
    }
    items.push(...body)
    const link = response.headers.get('link') ?? response.headers.get('Link')
    url = nextPageUrl(link, apiBase)
  }
  return items
}

/**
 * @param {unknown[]} files
 * @returns {string[]}
 */
function addedFoldersFromFiles(files) {
  /** @type {Set<string>} */
  const folders = new Set()
  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    const entry = /** @type {{ filename?: string, status?: string }} */ (file)
    if (entry.status !== 'added' || typeof entry.filename !== 'string') continue
    const folder = migrationFolderFromAddedPath(entry.filename)
    if (folder) folders.add(folder)
  }
  return [...folders].sort()
}

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   apiBase: string,
 *   repo: string,
 *   token: string,
 *   currentPrNumber: number,
 *   baseRef: string,
 * }} input
 * @returns {Promise<Array<{ number: number, folders: string[] }>>}
 */
async function listOtherOpenMigrationFolders(input) {
  const pullsUrl = `${input.apiBase}/repos/${input.repo}/pulls?state=open&base=${encodeURIComponent(input.baseRef)}&per_page=100`
  const pulls = await githubGetAll(input.fetchImpl, pullsUrl, input.token, input.apiBase)
  /** @type {Array<{ number: number, folders: string[] }>} */
  const overlaps = []
  for (const pull of pulls) {
    if (!pull || typeof pull !== 'object') continue
    const number = Number(/** @type {{ number?: unknown }} */ (pull).number)
    if (!Number.isInteger(number) || number === input.currentPrNumber) continue
    const filesUrl = `${input.apiBase}/repos/${input.repo}/pulls/${number}/files?per_page=100`
    const files = await githubGetAll(input.fetchImpl, filesUrl, input.token, input.apiBase)
    const folders = addedFoldersFromFiles(files)
    if (folders.length > 0) overlaps.push({ number, folders })
  }
  return overlaps
}

/**
 * @param {Array<{ number: number, folders: string[] }>} others
 * @param {string[]} addedFolders
 */
function overlapWarning(others, addedFolders) {
  const otherText = others
    .map((entry) => `#${entry.number} adds ${entry.folders.join(', ')}`)
    .join('; ')
  return `::warning::Another open PR also adds a Prisma migration: ${otherText}; this PR adds ${addedFolders.join(', ')}. ${HINT}`
}

/**
 * @param {string[]} olderFolders
 * @param {string} newestOnMain
 */
function staleWarning(olderFolders, newestOnMain) {
  return `::warning::Migration folder ${olderFolders.join(', ')} is older than the newest folder on main (${newestOnMain}). Create a fresh migration instead of editing a merged one.`
}

/**
 * @param {{
 *   addedFolders: string[],
 *   others: Array<{ number: number, folders: string[] }>,
 *   olderFolders: string[],
 *   newestOnMain: string | null,
 *   apiWarning: string | null,
 * }} input
 */
function buildSummary(input) {
  const lines = ['## Migration overlap', '']
  if (input.apiWarning) {
    lines.push(input.apiWarning, '')
  } else if (input.others.length === 0) {
    lines.push('no overlap', '')
  } else {
    lines.push('| PR | Migration folders |', '| --- | --- |')
    for (const entry of input.others) {
      lines.push(`| #${entry.number} | ${entry.folders.map((folder) => `\`${folder}\``).join(', ')} |`)
    }
    lines.push(`| this PR | ${input.addedFolders.map((folder) => `\`${folder}\``).join(', ')} |`, '', HINT, '')
  }
  if (input.olderFolders.length > 0 && input.newestOnMain) {
    lines.push(
      '## Older than main',
      '',
      `\`${input.olderFolders.join('`, `')}\` is older than the newest folder on main (\`${input.newestOnMain}\`).`,
      '',
    )
  }
  return lines.join('\n')
}

/**
 * @param {string | undefined} summaryPath
 * @param {string} summary
 */
function publishSummary(summaryPath, summary) {
  if (!summaryPath) return
  appendFileSync(summaryPath, summary.endsWith('\n') ? summary : `${summary}\n`)
}

/**
 * @param {{
 *   currentPrNumber?: string | number,
 *   repo?: string,
 *   token?: string,
 *   apiBase?: string,
 *   baseRef?: string,
 *   addedFolders?: string[],
 *   newestOnMain?: string | null,
 *   fetchImpl?: typeof fetch,
 *   summaryPath?: string,
 *   log?: (line: string) => void,
 * }} input
 * @returns {Promise<{ exitCode: 0, logs: string[], summary: string }>}
 */
export async function runMigrationOverlapCheck(input) {
  /** @type {string[]} */
  const logs = []
  const write = (line) => {
    logs.push(line)
    ;(input.log ?? console.log)(line)
  }

  const addedFolders = input.addedFolders ?? []
  const newestOnMain = input.newestOnMain ?? null
  const olderFolders = foldersOlderThanMain(addedFolders, newestOnMain)
  if (olderFolders.length > 0 && newestOnMain) {
    write(staleWarning(olderFolders, newestOnMain))
  }

  /** @type {Array<{ number: number, folders: string[] }>} */
  let others = []
  /** @type {string | null} */
  let apiWarning = null
  const apiBase = (input.apiBase || 'https://api.github.com').replace(/\/$/, '')
  if (!input.token || !input.repo) {
    apiWarning = 'Migration overlap check skipped: GitHub API credentials are not set.'
    write(`::warning::${apiWarning}`)
  } else {
    try {
      others = await listOtherOpenMigrationFolders({
        fetchImpl: input.fetchImpl ?? fetch,
        apiBase,
        repo: input.repo,
        token: input.token,
        currentPrNumber: Number(input.currentPrNumber),
        baseRef: input.baseRef || 'main',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      apiWarning = `Migration overlap check skipped: ${message}`
      write(`::warning::${apiWarning}`)
    }
  }

  const overlapping = addedFolders.length > 0 ? others : []
  if (overlapping.length > 0) write(overlapWarning(overlapping, addedFolders))

  const summary = buildSummary({
    addedFolders,
    others: overlapping,
    olderFolders,
    newestOnMain,
    apiWarning,
  })
  publishSummary(input.summaryPath, summary)
  return { exitCode: 0, logs, summary }
}

/**
 * @param {string} repoRoot
 * @param {string} baseRef
 */
function resolveBaseCommit(repoRoot, baseRef) {
  for (const candidate of [`origin/${baseRef}`, baseRef]) {
    const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    if (probe.status === 0) return candidate
  }
  throw new Error(`Cannot resolve base ref ${baseRef}`)
}

/**
 * @param {Buffer | string} output
 * @returns {string[]}
 */
function parseGitDiffNameOnlyZ(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output
  if (!text) return []
  return text
    .split('\0')
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter(Boolean)
}

/**
 * @param {string} repoRoot
 * @param {string} baseCommit
 * @returns {string[]}
 */
function listAddedFolders(repoRoot, baseCommit) {
  const mergeBase = execFileSync('git', ['merge-base', 'HEAD', baseCommit], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
  const diff = execFileSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '--name-only',
      '--diff-filter=A',
      '--no-renames',
      '-z',
      `${mergeBase}..HEAD`,
      '--',
      'apps/core-api/prisma/migrations',
    ],
    { cwd: repoRoot },
  )
  return [
    ...new Set(parseGitDiffNameOnlyZ(diff).map(migrationFolderFromAddedPath).filter(Boolean)),
  ].sort()
}

/**
 * @param {string} repoRoot
 * @param {string} baseCommit
 * @returns {string | null}
 */
function newestFolderOnRef(repoRoot, baseCommit) {
  const output = execFileSync(
    'git',
    ['ls-tree', '--name-only', `${baseCommit}:apps/core-api/prisma/migrations`],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  let newest = null
  let newestTimestamp = null
  for (const name of output.split('\n')) {
    const folder = name.trim()
    const timestamp = folderTimestamp(folder)
    if (!timestamp) continue
    if (newestTimestamp === null || timestamp > newestTimestamp) {
      newest = folder
      newestTimestamp = timestamp
    }
  }
  return newest
}

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
async function runCli(env = process.env) {
  const repoRoot = env.REPO_ROOT || defaultRepoRoot()
  const baseRef = env.BASE_REF || env.GITHUB_BASE_REF || 'main'
  try {
    const baseCommit = resolveBaseCommit(repoRoot, baseRef)
    const addedFolders = listAddedFolders(repoRoot, baseCommit)
    const newestOnMain = newestFolderOnRef(repoRoot, baseCommit)
    return await runMigrationOverlapCheck({
      currentPrNumber: env.PR_NUMBER,
      repo: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
      apiBase: env.GITHUB_API_URL,
      baseRef,
      addedFolders,
      newestOnMain,
      summaryPath: env.GITHUB_STEP_SUMMARY,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const summary = `Migration overlap check skipped: ${message}`
    console.log(`::warning::${summary}`)
    publishSummary(env.GITHUB_STEP_SUMMARY, summary)
    return { exitCode: 0, logs: [`::warning::${summary}`], summary }
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  runCli()
    .then((result) => {
      process.exitCode = result.exitCode
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`::warning::Migration overlap check skipped: ${message}`)
      process.exitCode = 0
    })
}
