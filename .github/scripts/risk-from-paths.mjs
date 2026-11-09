import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isOwnedByRequiredOwner,
  loadCodeownersRules,
  matchesCodeownersPattern,
  normalizeRepoPath,
} from './codeowners-match-lib.mjs'

/** @type {readonly string[]} */
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical']

const MIGRATION_PATTERNS = [
  '/apps/core-api/prisma/migrations/',
  '/apps/core-api/prisma/schema',
]

/**
 * @param {string} risk
 * @returns {number}
 */
export function riskRank(risk) {
  const index = RISK_LEVELS.indexOf(risk)
  if (index < 0) {
    throw new Error(`Unknown risk level: ${risk}`)
  }
  return index
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareRisk(left, right) {
  return riskRank(left) - riskRank(right)
}

/**
 * Parse `Risk: <level>` from the PR description (machine-readable template line).
 *
 * @param {string | null | undefined} body
 * @returns {'low' | 'medium' | 'high' | 'critical' | null}
 */
export function parseDeclaredRisk(body) {
  if (!body || typeof body !== 'string') {
    return null
  }

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = /^Risk:\s*(low|medium|high|critical)\s*$/i.exec(line)
    if (match) {
      return /** @type {'low' | 'medium' | 'high' | 'critical'} */ (match[1].toLowerCase())
    }
  }

  return null
}

/**
 * Derive the minimum declared risk for one touched file using G2 CODEOWNERS critical paths.
 *
 * @param {string} filePath
 * @param {import('./codeowners-match-lib.mjs').CodeownersRule[]} rules
 * @returns {'low' | 'medium' | 'high' | 'critical'}
 */
export function minimumRiskForPath(filePath, rules) {
  const normalized = normalizeRepoPath(filePath)

  if (!isOwnedByRequiredOwner(normalized, rules)) {
    return 'low'
  }

  for (const pattern of MIGRATION_PATTERNS) {
    if (matchesCodeownersPattern(normalized, pattern)) {
      return 'high'
    }
  }

  return 'high'
}

/**
 * @param {string[]} changedPaths
 * @param {import('./codeowners-match-lib.mjs').CodeownersRule[]} rules
 * @returns {'low' | 'medium' | 'high' | 'critical'}
 */
export function deriveMinimumRisk(changedPaths, rules) {
  if (!changedPaths.length) {
    return 'low'
  }

  let minimum = 'low'
  for (const filePath of changedPaths) {
    const pathMinimum = minimumRiskForPath(filePath, rules)
    if (compareRisk(pathMinimum, minimum) > 0) {
      minimum = pathMinimum
    }
  }
  return minimum
}

/**
 * @param {{
 *   changedPaths: string[],
 *   declaredRisk: string | null | undefined,
 *   rules: import('./codeowners-match-lib.mjs').CodeownersRule[],
 * }} input
 */
export function verifyDeclaredRiskAgainstPaths(input) {
  /** @type {'low' | 'medium' | 'high' | 'critical' | null} */
  let resolvedDeclared = null
  if (input.declaredRisk === null || input.declaredRisk === undefined) {
    resolvedDeclared = null
  } else if (
    typeof input.declaredRisk === 'string' &&
    RISK_LEVELS.includes(input.declaredRisk.toLowerCase())
  ) {
    resolvedDeclared = /** @type {'low' | 'medium' | 'high' | 'critical'} */ (
      input.declaredRisk.toLowerCase()
    )
  } else {
    resolvedDeclared = parseDeclaredRisk(String(input.declaredRisk))
  }

  const minimumRisk = deriveMinimumRisk(input.changedPaths, input.rules)

  if (minimumRisk !== 'low' && resolvedDeclared === null) {
    return {
      ok: false,
      reason: 'missing-declared-risk',
      minimumRisk,
      declaredRisk: null,
    }
  }

  if (resolvedDeclared === null) {
    return {
      ok: true,
      reason: 'no-critical-paths',
      minimumRisk,
      declaredRisk: null,
    }
  }

  if (compareRisk(resolvedDeclared, minimumRisk) < 0) {
    return {
      ok: false,
      reason: 'declared-below-minimum',
      minimumRisk,
      declaredRisk: resolvedDeclared,
    }
  }

  return {
    ok: true,
    reason: 'meets-minimum',
    minimumRisk,
    declaredRisk: resolvedDeclared,
  }
}

/**
 * @param {string} repoRoot
 * @param {string} baseRef
 * @returns {string[]}
 */
export function listChangedPathsAgainstBase(repoRoot, baseRef) {
  const remoteBase = baseRef.startsWith('origin/') ? baseRef : `origin/${baseRef}`
  execFileSync('git', ['rev-parse', '--verify', `${remoteBase}^{commit}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
  const mergeBase = execFileSync('git', ['merge-base', 'HEAD', remoteBase], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()

  const diffOutput = execFileSync('git', ['diff', '--name-only', `${mergeBase}..HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()

  if (!diffOutput) {
    return []
  }

  return diffOutput.split(/\r?\n/).map((entry) => normalizeRepoPath(entry)).filter(Boolean)
}

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

function defaultCodeownersRules() {
  return loadCodeownersRules(path.join(defaultRepoRoot(), '.github/CODEOWNERS'))
}

/**
 * @returns {{ baseRef: string, prBody: string, repoRoot: string }}
 */
export function readRiskCheckCliEnv() {
  const baseRef = process.env.BASE_REF || 'main'
  const prBody = process.env.PR_BODY ?? ''
  return { baseRef, prBody, repoRoot: defaultRepoRoot() }
}

export function runRiskCheckCli(env = readRiskCheckCliEnv(), deps = {}) {
  const rules = deps.rules ?? defaultCodeownersRules()
  const changedPaths = deps.changedPaths ?? listChangedPathsAgainstBase(env.repoRoot, env.baseRef)
  const declaredRisk = parseDeclaredRisk(env.prBody)
  const result = verifyDeclaredRiskAgainstPaths({ changedPaths, declaredRisk, rules })

  if (result.ok) {
    console.log(
      `::notice::PR risk check passed (declared=${result.declaredRisk ?? 'n/a'}, minimum=${result.minimumRisk}).`,
    )
    return 0
  }

  const detail =
    result.reason === 'missing-declared-risk'
      ? `Add a \`Risk: low|medium|high|critical\` line to the PR body (path-derived minimum is ${result.minimumRisk}).`
      : `Declared risk ${result.declaredRisk} is below path-derived minimum ${result.minimumRisk}.`

  console.error(`::error::PR risk check failed: ${detail}`)
  return 1
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  process.exitCode = runRiskCheckCli()
}
