import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  compareRisk,
  deriveMinimumRisk,
  parseDeclaredRisk,
  parseGitDiffNameOnlyZ,
  verifyDeclaredRiskAgainstPaths,
} from './risk-from-paths.mjs'
import { loadCodeownersRules } from './codeowners-match-lib.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CODEOWNERS_RULES = loadCodeownersRules(path.join(REPO_ROOT, '.github/CODEOWNERS'))

test('migrationsRejectsLowRisk', () => {
  const result = verifyDeclaredRiskAgainstPaths({
    changedPaths: [
      'apps/core-api/prisma/migrations/20261017010000_aut600_invoice_draft_from_workshop_order_policy/migration.sql',
    ],
    declaredRisk: 'low',
    rules: CODEOWNERS_RULES,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'declared-below-minimum')
  assert.equal(result.minimumRisk, 'high')
})

test('nonCriticalAllowsLow', () => {
  const result = verifyDeclaredRiskAgainstPaths({
    changedPaths: ['docs/internal/architecture-notes.md', 'README.md'],
    declaredRisk: 'low',
    rules: CODEOWNERS_RULES,
  })
  assert.equal(result.ok, true)
  assert.equal(result.minimumRisk, 'low')
  assert.equal(result.declaredRisk, 'low')
})

test('authAndTenantMapToHighOrCritical', () => {
  const authPath = 'apps/core-api/src/auth/auth.service.ts'
  const tenantPath = 'apps/core-api/src/prisma/tenant-isolation.extension.ts'

  const authMinimum = deriveMinimumRisk([authPath], CODEOWNERS_RULES)
  const tenantMinimum = deriveMinimumRisk([tenantPath], CODEOWNERS_RULES)

  assert.ok(compareRisk(authMinimum, 'high') >= 0)
  assert.ok(compareRisk(tenantMinimum, 'high') >= 0)
})

test('baselinesAndCheckersMapToHigh', () => {
  const minimum = deriveMinimumRisk(
    ['tools/check-spec-quality.mjs', 'tools/spec-quality-baseline.json'],
    CODEOWNERS_RULES,
  )
  assert.ok(compareRisk(minimum, 'high') >= 0)
})

test('declaredMeetsOrExceedsMinimum', () => {
  const migrationPath =
    'apps/core-api/prisma/migrations/20261017010000_aut600_invoice_draft_from_workshop_order_policy/migration.sql'

  const meetsHigh = verifyDeclaredRiskAgainstPaths({
    changedPaths: [migrationPath],
    declaredRisk: 'high',
    rules: CODEOWNERS_RULES,
  })
  assert.equal(meetsHigh.ok, true)

  const exceedsOnAuth = verifyDeclaredRiskAgainstPaths({
    changedPaths: ['apps/core-api/src/auth/auth.service.ts'],
    declaredRisk: 'critical',
    rules: CODEOWNERS_RULES,
  })
  assert.equal(exceedsOnAuth.ok, true)
})

test('parseDeclaredRisk reads dedicated template line', () => {
  const body = `## Summary
Something

Risk: medium

## Tests
ok`
  assert.equal(parseDeclaredRisk(body), 'medium')
})

test('missingDeclaredRiskFailsWhenCriticalPathsTouched', () => {
  const result = verifyDeclaredRiskAgainstPaths({
    changedPaths: ['apps/core-api/src/auth/auth.service.ts'],
    declaredRisk: null,
    rules: CODEOWNERS_RULES,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing-declared-risk')
})

test('renameFromCriticalPathRetainsHighMinimum', () => {
  const changedPaths = [
    'apps/core-api/src/auth/auth.service.ts',
    'docs/scratch/auth-service-relocated.ts',
  ]

  assert.equal(deriveMinimumRisk(changedPaths, CODEOWNERS_RULES), 'high')

  const result = verifyDeclaredRiskAgainstPaths({
    changedPaths,
    declaredRisk: 'low',
    rules: CODEOWNERS_RULES,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'declared-below-minimum')
  assert.equal(result.minimumRisk, 'high')
})

test('parseGitDiffNameOnlyZ preserves paths with spaces', () => {
  const zOutput = Buffer.from('README.md\0docs/my notes/file.md\0', 'utf8')
  assert.deepEqual(parseGitDiffNameOnlyZ(zOutput), ['README.md', 'docs/my notes/file.md'])
})
