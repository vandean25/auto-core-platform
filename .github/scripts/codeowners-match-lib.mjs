import { readFileSync } from 'node:fs'
import path from 'node:path'

const REQUIRED_OWNER = '@vandean25'

/**
 * @typedef {{ pattern: string, owners: string[] }} CodeownersRule
 */

/**
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\/+/, '')
}

/**
 * @param {string} segment
 * @returns {string}
 */
function segmentPatternToRegExp(segment) {
  /** @type {string[]} */
  const parts = []
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]
    if (char === '*') {
      if (segment[index + 1] === '*') {
        parts.push('.*')
        index += 1
      } else {
        parts.push('[^/]*')
      }
      continue
    }
    if (char === '?') {
      parts.push('[^/]')
      continue
    }
    if ('\\+?^$.{}[]|()'.includes(char)) {
      parts.push(`\\${char}`)
      continue
    }
    parts.push(char)
  }
  return parts.join('')
}

/**
 * @param {string} pattern CODEOWNERS pattern without trailing slash.
 * @returns {RegExp}
 */
function anchoredPatternToRegExp(pattern) {
  const anchored = pattern.startsWith('/')
  let body = pattern
  if (anchored) {
    body = body.slice(1)
  }

  const segments = body.split('/')
  const regexSegments = segments.map((segment) => {
    if (segment === '**') {
      return '(?:.+/)?.*'
    }
    return segmentPatternToRegExp(segment)
  })

  let regex = anchored ? `^${regexSegments.join('/')}` : `(?:^|.*/)${regexSegments.join('/')}`
  regex += '$'
  return new RegExp(regex)
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

  const anchoredRegex = anchoredPatternToRegExp(normalizedPattern)
  if (anchoredRegex.test(filePath)) {
    return true
  }

  if (!normalizedPattern.startsWith('/') && !normalizedPattern.includes('/')) {
    return anchoredPatternToRegExp(`/${normalizedPattern}`).test(`/${path.basename(filePath)}`)
  }

  if (!normalizedPattern.startsWith('/')) {
    return anchoredPatternToRegExp(`/${normalizedPattern}`).test(filePath)
  }

  return false
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
    const rulePattern = pieces.shift()
    if (!rulePattern) {
      continue
    }

    rules.push({
      pattern: rulePattern,
      owners: pieces,
    })
  }

  return rules
}

/**
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
