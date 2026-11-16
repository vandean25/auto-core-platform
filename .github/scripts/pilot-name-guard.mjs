#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * Parses newline-separated case-insensitive patterns from the secret value.
 * @param {string | undefined | null} rawPatterns
 * @returns {string[]}
 */
export function parsePatterns(rawPatterns) {
  if (!rawPatterns || typeof rawPatterns !== 'string') {
    return []
  }
  return rawPatterns
    .split(/\r?\n/)
    .map((line) => foldForMatch(line.trim()))
    .filter(Boolean)
}

/**
 * Folds text for matching: NFC so macOS NFD filenames (u + U+0308) match NFC secrets (ü), then lowercase.
 * @param {string} text
 * @returns {string}
 */
function foldForMatch(text) {
  return text.normalize('NFC').toLowerCase()
}

/**
 * @param {string | undefined | null} text
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesAnyPattern(text, patterns) {
  if (!text || typeof text !== 'string') {
    return false
  }
  const normalized = foldForMatch(text)
  return patterns.some((pattern) => normalized.includes(pattern))
}

const GIT_QUOTE_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

/**
 * Decodes git's C-style quoted path (`"b/M\303\274ller.md"`): octal escapes are UTF-8 bytes.
 * @param {string} quotedBody The text between the quotes.
 * @returns {string}
 */
function decodeGitQuotedBody(quotedBody) {
  /** @type {number[]} */
  const bytes = []
  for (let i = 0; i < quotedBody.length; i += 1) {
    const ch = quotedBody[i]
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'))
      continue
    }
    const octal = /^[0-7]{3}/.exec(quotedBody.slice(i + 1))
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8))
      i += 3
      continue
    }
    const next = quotedBody[i + 1]
    bytes.push(GIT_QUOTE_ESCAPES[next] ?? next.charCodeAt(0))
    i += 1
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Replaces every git-quoted path segment in a diff header line with its decoded form.
 * @param {string} text
 * @returns {string}
 */
function decodeGitQuotedPaths(text) {
  return text.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, body) => decodeGitQuotedBody(body))
}

/**
 * @param {string} headerLine
 * @returns {string}
 */
function parseDiffTargetPath(headerLine) {
  const target = decodeGitQuotedPaths(headerLine.slice(4))
  if (target === '/dev/null') {
    return ''
  }
  return target.startsWith('b/') ? target.slice(2) : target
}

/**
 * @param {string} hunkLine
 * @returns {{ nextLine: number, remainingAdded: number } | null}
 */
function parseHunkHeader(hunkLine) {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(hunkLine)
  if (!match) {
    return null
  }
  return {
    nextLine: Number(match[1]),
    remainingAdded: match[2] === undefined ? 1 : Number(match[2]),
  }
}

/**
 * @param {{ currentFile: string, nextLine: number, remainingAdded: number, pathMatched: boolean, recordedPathHit: boolean, hits: string[] }} state
 */
function markDiffPathHit(state) {
  state.pathMatched = true
  if (!state.recordedPathHit) {
    state.recordedPathHit = true
    state.hits.push('diff file path')
  }
}

/**
 * @param {{ currentFile: string, nextLine: number, remainingAdded: number, pathMatched: boolean, recordedPathHit: boolean, hits: string[] }} state
 * @param {string} line
 * @param {string[]} patterns
 * @returns {boolean} True if the line was handled as a diff header/hunk line.
 */
function stepDiffHeader(state, line, patterns) {
  if (line.startsWith('diff --git ')) {
    state.currentFile = ''
    state.remainingAdded = 0
    state.pathMatched = false
    state.recordedPathHit = false
    if (matchesAnyPattern(decodeGitQuotedPaths(line.slice(11)), patterns)) {
      markDiffPathHit(state)
    }
    return true
  }
  if (state.remainingAdded === 0 && line.startsWith('rename to ')) {
    if (matchesAnyPattern(decodeGitQuotedPaths(line.slice(10)), patterns)) {
      markDiffPathHit(state)
    }
    return true
  }
  if (state.remainingAdded === 0 && line.startsWith('+++ ')) {
    state.currentFile = parseDiffTargetPath(line)
    if (state.currentFile && matchesAnyPattern(state.currentFile, patterns)) {
      markDiffPathHit(state)
    }
    return true
  }
  if (line.startsWith('@@ ')) {
    const hunk = parseHunkHeader(line)
    if (hunk) {
      state.nextLine = hunk.nextLine
      state.remainingAdded = hunk.remainingAdded
    }
    return true
  }
  return false
}

/**
 * @param {{ currentFile: string, nextLine: number, remainingAdded: number, pathMatched: boolean, recordedPathHit: boolean, hits: string[] }} state
 * @param {string} line
 * @param {string[]} patterns
 */
function stepDiffLine(state, line, patterns) {
  if (stepDiffHeader(state, line, patterns) || state.remainingAdded <= 0) {
    return
  }
  if (line.startsWith(' ')) {
    state.nextLine += 1
    state.remainingAdded -= 1
    return
  }
  if (!line.startsWith('+')) {
    return
  }
  if (state.currentFile && matchesAnyPattern(line.slice(1), patterns)) {
    if (state.pathMatched) {
      markDiffPathHit(state)
    } else {
      state.hits.push(`${state.currentFile}:${state.nextLine}`)
    }
  }
  state.nextLine += 1
  state.remainingAdded -= 1
}

/**
 * Scans added lines and file paths in a `git diff -U0` output.
 * Never returns matched line text or matched file paths.
 * @param {string} diffText
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function scanDiffAddedLines(diffText, patterns) {
  if (!diffText) {
    return []
  }
  const state = {
    currentFile: '',
    nextLine: 0,
    remainingAdded: 0,
    pathMatched: false,
    recordedPathHit: false,
    hits: [],
  }
  for (const line of diffText.split(/\r?\n/)) {
    stepDiffLine(state, line, patterns)
  }
  return state.hits
}

/**
 * Scans PR metadata, commit messages, and added diff lines against secret patterns.
 * Fails closed when the secret is missing or empty, and never includes matched text.
 * @param {{
 *   rawPatterns: string | undefined | null,
 *   prTitle: string | undefined | null,
 *   prBody: string | undefined | null,
 *   headRef: string | undefined | null,
 *   commits: Array<{ sha: string, message: string }>,
 *   diffText: string,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   reason: 'clean' | 'missing-secret' | 'pattern-matched',
 *   violations: string[],
 *   message: string,
 * }}
 */
export function scanPullRequestContent(input) {
  const patterns = parsePatterns(input.rawPatterns)
  if (patterns.length === 0) {
    return {
      ok: false,
      reason: 'missing-secret',
      violations: [],
      message:
        'Pilot name guard failed: PILOT_NAME_PATTERNS secret is missing or empty (fork PRs without secret access also fail closed).',
    }
  }

  /** @type {string[]} */
  const violations = []

  if (matchesAnyPattern(input.prTitle, patterns)) {
    violations.push('PR title')
  }
  if (matchesAnyPattern(input.prBody, patterns)) {
    violations.push('PR body')
  }
  if (matchesAnyPattern(input.headRef, patterns)) {
    violations.push('head branch name')
  }

  for (const commit of input.commits) {
    if (matchesAnyPattern(commit.message, patterns)) {
      violations.push(`commit ${commit.sha.slice(0, 12)} message`)
    }
  }

  violations.push(...scanDiffAddedLines(input.diffText, patterns))

  if (violations.length > 0) {
    return {
      ok: false,
      reason: 'pattern-matched',
      violations,
      message: [
        'Pilot name guard failed. Forbidden pilot-customer pattern detected in:',
        ...violations.map((target) => `  - ${target}`),
      ].join('\n'),
    }
  }

  return {
    ok: true,
    reason: 'clean',
    violations: [],
    message: 'Pilot name guard passed.',
  }
}

/**
 * @param {string} mergeBase
 * @param {string} gitHeadRef
 * @returns {Array<{ sha: string, message: string }>}
 */
function readCommits(mergeBase, gitHeadRef) {
  const raw = execFileSync('git', ['log', '--format=%H%x00%B%x00', `${mergeBase}..${gitHeadRef}`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  const parts = raw.split('\0')
  /** @type {Array<{ sha: string, message: string }>} */
  const commits = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const sha = parts[i].trim()
    const message = parts[i + 1]
    if (sha) {
      commits.push({ sha, message })
    }
  }
  return commits
}

/**
 * @param {string} gitHeadRef
 * @returns {string}
 */
function resolveMergeBase(gitHeadRef) {
  if (process.env.MERGE_BASE) {
    return process.env.MERGE_BASE
  }
  const baseRef = process.env.BASE_REF || 'main'
  return execFileSync('git', ['merge-base', gitHeadRef, `origin/${baseRef}`], {
    encoding: 'utf8',
  }).trim()
}

/** GET /pulls/{n}/commits silently stops at 250 commits (HTTP 200, oldest first). */
const PR_COMMITS_API_CAP = 250

/**
 * Fetches PR commits and unified diff as read-only data via GitHub REST API.
 * Fails closed when the PR hits the commits endpoint cap.
 * @param {{
 *   repo: string,
 *   prNumber: string | number,
 *   token: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 * @returns {Promise<{ commits: Array<{ sha: string, message: string }>, diffText: string }>}
 */
export async function fetchPullRequestDataFromApi(input) {
  const fetchImpl = input.fetchImpl ?? fetch
  const baseHeaders = {
    Authorization: `Bearer ${input.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  /** @type {Array<{ sha: string, message: string }>} */
  const commits = []
  let page = 1
  while (true) {
    const commitsUrl = `https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}/commits?per_page=100&page=${page}`
    const res = await fetchImpl(commitsUrl, {
      headers: { ...baseHeaders, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch PR commits from GitHub API (HTTP ${res.status}).`)
    }
    const batch = /** @type {Array<{ sha?: string, commit?: { message?: string } }>} */ (
      await res.json()
    )
    for (const entry of batch) {
      if (entry.sha) {
        commits.push({ sha: entry.sha, message: entry.commit?.message ?? '' })
      }
    }
    if (batch.length < 100) {
      break
    }
    page += 1
  }
  if (commits.length >= PR_COMMITS_API_CAP) {
    throw new Error(
      `PR has ${PR_COMMITS_API_CAP} or more commits; the GitHub API returns at most ${PR_COMMITS_API_CAP}, so commit messages cannot be fully scanned.`,
    )
  }

  const diffUrl = `https://api.github.com/repos/${input.repo}/pulls/${input.prNumber}`
  const diffRes = await fetchImpl(diffUrl, {
    headers: { ...baseHeaders, Accept: 'application/vnd.github.diff' },
  })
  if (!diffRes.ok) {
    throw new Error(`Failed to fetch PR diff from GitHub API (HTTP ${diffRes.status}).`)
  }
  const diffText = await diffRes.text()

  return { commits, diffText }
}

async function runCli() {
  const rawPatterns = process.env.PILOT_NAME_PATTERNS
  if (parsePatterns(rawPatterns).length === 0) {
    const missing = scanPullRequestContent({
      rawPatterns,
      prTitle: '',
      prBody: '',
      headRef: '',
      commits: [],
      diffText: '',
    })
    console.error(missing.message)
    process.exit(1)
  }

  let commits
  let diffText
  if (process.env.PR_NUMBER && process.env.GH_TOKEN && process.env.GITHUB_REPOSITORY) {
    const data = await fetchPullRequestDataFromApi({
      repo: process.env.GITHUB_REPOSITORY,
      prNumber: process.env.PR_NUMBER,
      token: process.env.GH_TOKEN,
    })
    commits = data.commits
    diffText = data.diffText
  } else {
    const gitHeadRef = process.env.GIT_HEAD_REF || 'HEAD'
    const mergeBase = resolveMergeBase(gitHeadRef)
    commits = readCommits(mergeBase, gitHeadRef)
    diffText = execFileSync(
      'git',
      ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', mergeBase, gitHeadRef],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    )
  }

  const result = scanPullRequestContent({
    rawPatterns,
    prTitle: process.env.PR_TITLE ?? '',
    prBody: process.env.PR_BODY ?? '',
    headRef: process.env.HEAD_REF ?? '',
    commits,
    diffText,
  })

  if (!result.ok) {
    console.error(result.message)
    process.exit(1)
  }

  console.log(result.message)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
