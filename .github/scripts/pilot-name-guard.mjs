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
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
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
  const normalized = text.toLowerCase()
  return patterns.some((pattern) => normalized.includes(pattern))
}

/**
 * @param {string} headerLine
 * @returns {string}
 */
function parseDiffTargetPath(headerLine) {
  const target = headerLine.slice(4)
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
 * @param {{ currentFile: string, nextLine: number, remainingAdded: number, hits: string[] }} state
 * @param {string} line
 * @param {string[]} patterns
 */
function stepDiffLine(state, line, patterns) {
  if (line.startsWith('diff --git ')) {
    state.currentFile = ''
    state.remainingAdded = 0
    return
  }
  if (state.remainingAdded === 0 && line.startsWith('+++ ')) {
    state.currentFile = parseDiffTargetPath(line)
    return
  }
  if (line.startsWith('@@ ')) {
    const hunk = parseHunkHeader(line)
    if (hunk) {
      state.nextLine = hunk.nextLine
      state.remainingAdded = hunk.remainingAdded
    }
    return
  }
  if (state.remainingAdded > 0 && line.startsWith('+')) {
    if (state.currentFile && matchesAnyPattern(line.slice(1), patterns)) {
      state.hits.push(`${state.currentFile}:${state.nextLine}`)
    }
    state.nextLine += 1
    state.remainingAdded -= 1
  }
}

/**
 * Scans added lines in a `git diff -U0` output and returns `<file>:<line>` hits.
 * Never returns matched line text.
 * @param {string} diffText
 * @param {string[]} patterns
 * @returns {string[]}
 */
export function scanDiffAddedLines(diffText, patterns) {
  if (!diffText) {
    return []
  }
  const state = { currentFile: '', nextLine: 0, remainingAdded: 0, hits: [] }
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
 * @returns {Array<{ sha: string, message: string }>}
 */
function readCommits(mergeBase) {
  const raw = execFileSync('git', ['log', '--format=%H%x00%B%x00', `${mergeBase}..HEAD`], {
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
 * @returns {string}
 */
function resolveMergeBase() {
  if (process.env.MERGE_BASE) {
    return process.env.MERGE_BASE
  }
  const baseRef = process.env.BASE_REF || 'main'
  return execFileSync('git', ['merge-base', 'HEAD', `origin/${baseRef}`], {
    encoding: 'utf8',
  }).trim()
}

function runCli() {
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

  const mergeBase = resolveMergeBase()
  const commits = readCommits(mergeBase)
  const diffText = execFileSync(
    'git',
    ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', mergeBase, 'HEAD'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  )

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
  runCli()
}
