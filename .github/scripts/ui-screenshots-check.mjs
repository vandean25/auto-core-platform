import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeRepoPath } from './codeowners-match-lib.mjs'
import { listChangedPathsAgainstBase, readRiskCheckCliEnv } from './risk-from-paths.mjs'

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*[^\s)]+[^)]*\)/
const HTML_IMAGE_RE = /<img\b/i
const GITHUB_ATTACHMENT_URL_RE =
  /https:\/\/(?:github\.com\/(?:user-attachments|[^/\s]+\/[^/\s]+\/assets)\/|user-images\.githubusercontent\.com\/)\S+/i
const NA_LINE_RE = /^Screenshots:\s*n\/a\s*[-–]\s*(.+)$/i

/**
 * Returns true when a repo-relative path is a non-test UI TSX file under `apps/core-web/src/`.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isUiComponentPath(filePath) {
  const normalized = normalizeRepoPath(filePath)
  if (!normalized.startsWith('apps/core-web/src/') || !normalized.endsWith('.tsx')) {
    return false
  }
  if (normalized.endsWith('.test.tsx') || normalized.endsWith('.spec.tsx')) {
    return false
  }
  if (normalized.startsWith('apps/core-web/src/test/')) {
    return false
  }
  if (normalized.includes('/__tests__/')) {
    return false
  }
  return true
}

/**
 * Returns true when the PR body contains an image (markdown, `<img>`, or GitHub attachment URL)
 * or a `Screenshots: n/a – <reason>` line with a non-empty reason (ignoring HTML comments).
 *
 * @param {string | null | undefined} body
 * @returns {boolean}
 */
export function hasScreenshotOrNa(body) {
  if (!body || typeof body !== 'string') {
    return false
  }

  let stripped = body
  let prev
  do {
    prev = stripped
    stripped = stripped.replace(/<!--[\s\S]*?-->/g, '')
  } while (stripped !== prev)
  if (
    MARKDOWN_IMAGE_RE.test(stripped) ||
    HTML_IMAGE_RE.test(stripped) ||
    GITHUB_ATTACHMENT_URL_RE.test(stripped)
  ) {
    return true
  }

  for (const rawLine of stripped.split(/\r?\n/)) {
    const match = NA_LINE_RE.exec(rawLine.trim())
    if (match && match[1].trim().length > 0) {
      return true
    }
  }

  return false
}

/**
 * @param {{ changedPaths: string[], prBody: string | null | undefined }} input
 * @returns {{ ok: boolean, uiFiles: string[] }}
 */
export function verifyUiScreenshots(input) {
  const uiFiles = input.changedPaths.filter(isUiComponentPath)
  if (uiFiles.length === 0) {
    return { ok: true, uiFiles: [] }
  }

  return {
    ok: hasScreenshotOrNa(input.prBody),
    uiFiles,
  }
}

export function runUiScreenshotsCheckCli(env = readRiskCheckCliEnv(), deps = {}) {
  const log = deps.log ?? console.log
  const logError = deps.logError ?? console.error
  const changedPaths = deps.changedPaths ?? listChangedPathsAgainstBase(env.repoRoot, env.baseRef)
  const result = verifyUiScreenshots({ changedPaths, prBody: env.prBody })

  if (result.uiFiles.length === 0) {
    log('::notice::UI screenshot check skipped (no non-test core-web .tsx files changed).')
    return 0
  }

  if (result.ok) {
    log(`::notice::UI screenshot check passed (${result.uiFiles.length} UI file(s) changed).`)
    return 0
  }

  logError(
    `::error::UI screenshot check failed for: ${result.uiFiles.join(', ')}. Attach before/after screenshots in the PR body (markdown image, <img>, or GitHub attachment URL) or add a \`Screenshots: n/a – <reason>\` line.`,
  )
  return 1
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  process.exitCode = runUiScreenshotsCheckCli()
}
