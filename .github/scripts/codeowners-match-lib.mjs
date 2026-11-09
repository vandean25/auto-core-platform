import { readFileSync } from 'node:fs'
import minimatch from 'minimatch'

const REQUIRED_OWNER = '@vandean25'

/**
 * @typedef {{ pattern: string, owners: string[] }} CodeownersRule
 */

/**
 * Normalizes repository-relative paths for CODEOWNERS matching.
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeRepoPath(filePath) {
  const trimmed = filePath.replaceAll('\\', '/').replace(/^\/+/, '')
  return trimmed
}

/**
 * @param {string} filePath Normalized path without a leading slash.
 * @param {string} pattern CODEOWNERS pattern.
 * @returns {boolean}
 */
export function matchesCodeownersPattern(filePath, pattern) {
  const normalizedPattern = pattern.trim()
  if (!normalizedPattern) {
    return false
  }

  if (normalizedPattern.endsWith('/')) {
    let dir = normalizedPattern.slice(0, -1)
    if (dir.startsWith('/')) {
      dir = dir.slice(1)
    }
    return filePath === dir || filePath.startsWith(`${dir}/`)
  }

  if (normalizedPattern.startsWith('/')) {
    return minimatch(filePath, normalizedPattern.slice(1), { dot: true })
  }

  return minimatch(filePath, normalizedPattern, { dot: true, matchBase: true })
}

/**
 * @param {string} text Raw CODEOWNERS file contents.
 * @returns {CodeownersRule[]}
 */
export function parseCodeowners(text) {
  /** @type {CodeownersRule[]} */
  const rules = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) {
      continue
    }

    const pieces = line.split(/\s+/).filter(Boolean)
    const pattern = pieces.shift()
    if (!pattern) {
      continue
    }

    rules.push({
      pattern,
      owners: pieces,
    })
  }

  return rules
}

/**
 * Last matching CODEOWNERS rule wins.
 * @param {string} filePath
 * @param {CodeownersRule[]} rules
 * @returns {string[]}
 */
export function ownersForPath(filePath, rules) {
  const normalizedPath = normalizeRepoPath(filePath)
  let owners = []

  for (const rule of rules) {
    if (matchesCodeownersPattern(normalizedPath, rule.pattern)) {
      owners = rule.owners
    }
  }

  return owners
}

/**
 * @param {string} filePath
 * @param {CodeownersRule[]} rules
 * @returns {boolean}
 */
export function isOwnedByRequiredOwner(filePath, rules) {
  const owners = ownersForPath(filePath, rules)
  return owners.includes(REQUIRED_OWNER)
}

/**
 * @param {string} codeownersPath
 * @returns {CodeownersRule[]}
 */
export function loadCodeownersRules(codeownersPath) {
  return parseCodeowners(readFileSync(codeownersPath, 'utf8'))
}

export { REQUIRED_OWNER }
