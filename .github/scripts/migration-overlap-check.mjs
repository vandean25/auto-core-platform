import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATION_PREFIX = 'apps/core-api/prisma/migrations/'
const HINT =
  'rebase after the other PR merges; if your folder timestamp is older than the newest on main, create a fresh migration instead of editing a merged one'
const TIMESTAMP_RE = /^(\d{14})_/
const CREDENTIALS_WARNING = 'Migration overlap check skipped: GitHub API credentials are not set.'

function migrationRest(filePath) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized.startsWith(MIGRATION_PREFIX)) return ''
  return normalized.slice(MIGRATION_PREFIX.length)
}

function migrationFolderFromAddedPath(filePath) {
  const rest = migrationRest(filePath)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const folder = rest.slice(0, slash)
  if (!TIMESTAMP_RE.test(folder)) return null
  return folder
}

function allowedOrigin(apiBase) {
  try {
    return new URL(apiBase).origin
  } catch {
    return null
  }
}

function linkTarget(part) {
  const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim())
  if (!match) return null
  try {
    return new URL(match[1])
  } catch {
    return null
  }
}

function sameOriginNext(part, origin) {
  const next = linkTarget(part)
  if (!next || next.origin !== origin) return null
  return next.href
}

function firstNextHref(parts, origin) {
  for (const part of parts) {
    const href = sameOriginNext(part, origin)
    if (href) return href
  }
  return null
}

function nextPageUrl(linkHeader, apiBase) {
  const origin = allowedOrigin(apiBase)
  if (!linkHeader || !origin) return null
  return firstNextHref(linkHeader.split(','), origin)
}

function folderTimestamp(folder) {
  const match = TIMESTAMP_RE.exec(folder)
  if (!match) return null
  return match[1]
}

function isOlderThan(folder, newestTimestamp) {
  const timestamp = folderTimestamp(folder)
  if (!timestamp) return false
  return timestamp < newestTimestamp
}

function foldersOlderThanMain(addedFolders, newestOnMain) {
  const newestTimestamp = newestOnMain ? folderTimestamp(newestOnMain) : null
  if (!newestTimestamp) return []
  return addedFolders.filter((folder) => isOlderThan(folder, newestTimestamp))
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'migration-overlap-check',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function hasAnotherPage(url, seen) {
  return Boolean(url) && !seen.has(url) && seen.size < 20
}

function responseLink(response) {
  return response.headers.get('link') ?? response.headers.get('Link')
}

async function readJsonList(response) {
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body)) throw new Error('GitHub API returned a non-list response')
  return body
}

async function githubGetAll(fetchImpl, firstUrl, token, apiBase) {
  const items = []
  const seen = new Set()
  let url = firstUrl
  while (hasAnotherPage(url, seen)) {
    seen.add(url)
    const response = await fetchImpl(url, { headers: githubHeaders(token) })
    items.push(...(await readJsonList(response)))
    url = nextPageUrl(responseLink(response), apiBase)
  }
  return items
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object'
}

function addedFilename(file) {
  if (!isRecord(file)) return null
  if (file.status !== 'added') return null
  if (typeof file.filename !== 'string') return null
  return file.filename
}

function folderFromFile(file) {
  return migrationFolderFromAddedPath(addedFilename(file) ?? '')
}

function addedFoldersFromFiles(files) {
  const folders = new Set()
  for (const file of files) {
    const folder = folderFromFile(file)
    if (folder) folders.add(folder)
  }
  return [...folders].sort()
}

function isOtherPull(number, currentPrNumber) {
  return Number.isInteger(number) && number !== currentPrNumber
}

function otherPullNumber(pull, currentPrNumber) {
  if (!isRecord(pull)) return null
  const number = Number(pull.number)
  if (!isOtherPull(number, currentPrNumber)) return null
  return number
}

async function foldersForPull(input, number) {
  const filesUrl = `${input.apiBase}/repos/${input.repo}/pulls/${number}/files?per_page=100`
  const files = await githubGetAll(input.fetchImpl, filesUrl, input.token, input.apiBase)
  const folders = addedFoldersFromFiles(files)
  if (folders.length === 0) return null
  return { number, folders }
}

async function foldersForOtherPull(input, pull) {
  const number = otherPullNumber(pull, input.currentPrNumber)
  if (number === null) return null
  return foldersForPull(input, number)
}

async function listOtherOpenMigrationFolders(input) {
  const pullsUrl = `${input.apiBase}/repos/${input.repo}/pulls?state=open&base=${encodeURIComponent(input.baseRef)}&per_page=100`
  const pulls = await githubGetAll(input.fetchImpl, pullsUrl, input.token, input.apiBase)
  const overlaps = []
  for (const pull of pulls) {
    const found = await foldersForOtherPull(input, pull)
    if (found) overlaps.push(found)
  }
  return overlaps
}

function overlapWarning(others, addedFolders) {
  const otherText = others.map((entry) => `#${entry.number} adds ${entry.folders.join(', ')}`).join('; ')
  return `::warning::Another open PR also adds a Prisma migration: ${otherText}; this PR adds ${addedFolders.join(', ')}. ${HINT}`
}

function staleWarning(olderFolders, newestOnMain) {
  const listed = olderFolders.join(', ')
  return `::warning::Migration folder ${listed} is older than the newest folder on main (${newestOnMain}). Create a fresh migration instead of editing a merged one.`
}

function quotedFolders(folders) {
  return folders.map((folder) => `\`${folder}\``).join(', ')
}

function summaryTable(addedFolders, others) {
  const lines = ['| PR | Migration folders |', '| --- | --- |']
  for (const entry of others) {
    lines.push(`| #${entry.number} | ${quotedFolders(entry.folders)} |`)
  }
  lines.push(`| this PR | ${quotedFolders(addedFolders)} |`, '', HINT, '')
  return lines
}

function overlapSection(input) {
  if (input.apiWarning) return [input.apiWarning, '']
  if (input.others.length === 0) return ['no overlap', '']
  return summaryTable(input.addedFolders, input.others)
}

function staleSection(input) {
  if (input.olderFolders.length === 0 || !input.newestOnMain) return []
  const listed = `\`${input.olderFolders.join('`, `')}\``
  return [
    '## Older than main',
    '',
    `${listed} is older than the newest folder on main (\`${input.newestOnMain}\`).`,
    '',
  ]
}

function buildSummary(input) {
  return ['## Migration overlap', '', ...overlapSection(input), ...staleSection(input)].join('\n')
}

function publishSummary(summaryPath, summary) {
  if (!summaryPath) return
  const text = summary.endsWith('\n') ? summary : `${summary}\n`
  appendFileSync(summaryPath, text)
}

function writeLine(logs, log, line) {
  logs.push(line)
  log(line)
}

function emitWhen(logs, log, condition, line) {
  if (!condition) return
  writeLine(logs, log, line)
}

function loggerOf(input) {
  return input.log ?? console.log
}

function listOf(value) {
  return value ?? []
}

function newestOf(value) {
  return value ?? null
}

function apiBaseOf(input) {
  return (input.apiBase || 'https://api.github.com').replace(/\/$/, '')
}

function baseRefOf(input) {
  return input.baseRef || 'main'
}

function fetchOf(input) {
  return input.fetchImpl ?? fetch
}

function withApiDefaults(input) {
  return {
    fetchImpl: fetchOf(input),
    apiBase: apiBaseOf(input),
    repo: input.repo,
    token: input.token,
    currentPrNumber: Number(input.currentPrNumber),
    baseRef: baseRefOf(input),
  }
}

function missingCredentials(input) {
  return !input.token || !input.repo
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

async function fetchOtherFolders(input) {
  try {
    const others = await listOtherOpenMigrationFolders(input)
    return { others, apiWarning: null }
  } catch (error) {
    return { others: [], apiWarning: `Migration overlap check skipped: ${errorMessage(error)}` }
  }
}

async function loadOtherFolders(input) {
  if (missingCredentials(input)) return { others: [], apiWarning: CREDENTIALS_WARNING }
  return fetchOtherFolders(withApiDefaults(input))
}

function overlappingPulls(addedFolders, others) {
  if (addedFolders.length === 0) return []
  return others
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
  const logs = []
  const log = loggerOf(input)
  const addedFolders = listOf(input.addedFolders)
  const newestOnMain = newestOf(input.newestOnMain)
  const olderFolders = foldersOlderThanMain(addedFolders, newestOnMain)
  const staleLine = staleWarning(olderFolders, newestOnMain ?? '')
  emitWhen(logs, log, olderFolders.length > 0 && newestOnMain, staleLine)
  const loaded = await loadOtherFolders(input)
  emitWhen(logs, log, Boolean(loaded.apiWarning), `::warning::${loaded.apiWarning}`)
  const overlapping = overlappingPulls(addedFolders, loaded.others)
  emitWhen(logs, log, overlapping.length > 0, overlapWarning(overlapping, addedFolders))
  const summary = buildSummary({
    addedFolders,
    others: overlapping,
    olderFolders,
    newestOnMain,
    apiWarning: loaded.apiWarning,
  })
  publishSummary(input.summaryPath, summary)
  return { exitCode: 0, logs, summary }
}

function verifyRef(repoRoot, candidate) {
  const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (probe.status !== 0) return null
  return candidate
}

function resolveBaseCommit(repoRoot, baseRef) {
  const found = verifyRef(repoRoot, `origin/${baseRef}`) ?? verifyRef(repoRoot, baseRef)
  if (!found) throw new Error(`Cannot resolve base ref ${baseRef}`)
  return found
}

function diffText(output) {
  if (Buffer.isBuffer(output)) return output.toString('utf8')
  return String(output ?? '')
}

function parseGitDiffNameOnlyZ(output) {
  const text = diffText(output)
  if (!text) return []
  return text
    .split('\0')
    .map((entry) => entry.replaceAll('\\', '/'))
    .filter(Boolean)
}

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
  const folders = new Set()
  for (const file of parseGitDiffNameOnlyZ(diff)) {
    const folder = migrationFolderFromAddedPath(file)
    if (folder) folders.add(folder)
  }
  return [...folders].sort()
}

function keepsCurrent(state, timestamp) {
  return state.timestamp !== null && timestamp <= state.timestamp
}

function considerNewest(state, name) {
  const timestamp = folderTimestamp(name.trim())
  if (!timestamp) return state
  if (keepsCurrent(state, timestamp)) return state
  return { folder: name.trim(), timestamp }
}

function newestFolderOnRef(repoRoot, baseCommit) {
  const output = execFileSync(
    'git',
    ['ls-tree', '--name-only', `${baseCommit}:apps/core-api/prisma/migrations`],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  let state = { folder: null, timestamp: null }
  for (const name of output.split('\n')) state = considerNewest(state, name)
  return state.folder
}

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

function repoRootOf(env) {
  return env.REPO_ROOT || defaultRepoRoot()
}

function baseRefFromEnv(env) {
  return env.BASE_REF || env.GITHUB_BASE_REF || 'main'
}

function localMigrationFacts(repoRoot, baseRef) {
  const baseCommit = resolveBaseCommit(repoRoot, baseRef)
  return {
    baseRef,
    addedFolders: listAddedFolders(repoRoot, baseCommit),
    newestOnMain: newestFolderOnRef(repoRoot, baseCommit),
  }
}

function skippedResult(message, summaryPath) {
  const summary = `Migration overlap check skipped: ${message}`
  console.log(`::warning::${summary}`)
  publishSummary(summaryPath, summary)
  return { exitCode: 0, logs: [`::warning::${summary}`], summary }
}

async function runCli(env) {
  try {
    const facts = localMigrationFacts(repoRootOf(env), baseRefFromEnv(env))
    return await runMigrationOverlapCheck({
      currentPrNumber: env.PR_NUMBER,
      repo: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN,
      apiBase: env.GITHUB_API_URL,
      baseRef: facts.baseRef,
      addedFolders: facts.addedFolders,
      newestOnMain: facts.newestOnMain,
      summaryPath: env.GITHUB_STEP_SUMMARY,
    })
  } catch (error) {
    return skippedResult(errorMessage(error), env.GITHUB_STEP_SUMMARY)
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  runCli(process.env)
    .then((result) => {
      process.exitCode = result.exitCode
    })
    .catch((error) => {
      console.log(`::warning::Migration overlap check skipped: ${errorMessage(error)}`)
      process.exitCode = 0
    })
}
