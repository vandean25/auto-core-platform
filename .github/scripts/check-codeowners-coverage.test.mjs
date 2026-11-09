import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import {
  CRITICAL_PATH_INVENTORY,
  isListedInventoryPath,
  UNLISTED_SMOKE_PATH,
} from './codeowners-inventory.mjs'
import { isOwnedByRequiredOwner, loadCodeownersRules } from './codeowners-match-lib.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const CODEOWNERS_PATH = path.join(REPO_ROOT, '.github/CODEOWNERS')

function rules() {
  return loadCodeownersRules(CODEOWNERS_PATH)
}

function assertInventoryCovered(paths) {
  const codeownersRules = rules()
  const missing = paths.filter((entry) => !isOwnedByRequiredOwner(entry, codeownersRules))
  assert.deepEqual(
    missing,
    [],
    `paths missing @vandean25 ownership (last matching rule): ${missing.join(', ')}`,
  )
}

test('coversPrismaMigrations', () => {
  assertInventoryCovered(CRITICAL_PATH_INVENTORY.prismaMigrations)
})

test('coversTenantIsolationPaths', () => {
  assertInventoryCovered(CRITICAL_PATH_INVENTORY.tenantIsolation)
})

test('coversAgentInstructionPaths', () => {
  assertInventoryCovered(CRITICAL_PATH_INVENTORY.agentInstructions)
})

test('coversBaselineAndCheckerPaths', () => {
  assertInventoryCovered(CRITICAL_PATH_INVENTORY.baselineAndCheckers)
})

test('coversCiAndInfraPaths', () => {
  assertInventoryCovered(CRITICAL_PATH_INVENTORY.ciAndInfra)
})

test('inventoryIsExplicit', () => {
  assert.equal(isListedInventoryPath(UNLISTED_SMOKE_PATH), false)

  const codeownersRules = rules()
  assert.equal(
    isOwnedByRequiredOwner(UNLISTED_SMOKE_PATH, codeownersRules),
    false,
    'unlisted path must not be treated as critically owned',
  )

  for (const listed of CRITICAL_PATH_INVENTORY.baselineAndCheckers) {
    assert.equal(isListedInventoryPath(listed), true)
  }
})
