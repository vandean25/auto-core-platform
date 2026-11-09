#!/usr/bin/env node
import path from 'node:path'
import { CRITICAL_PATH_INVENTORY } from './codeowners-inventory.mjs'
import { isOwnedByRequiredOwner, loadCodeownersRules } from './codeowners-match-lib.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const CODEOWNERS_PATH = path.join(REPO_ROOT, '.github/CODEOWNERS')

const rules = loadCodeownersRules(CODEOWNERS_PATH)

/** @type {string[]} */
const failures = []

for (const [group, paths] of Object.entries(CRITICAL_PATH_INVENTORY)) {
  for (const entry of paths) {
    if (!isOwnedByRequiredOwner(entry, rules)) {
      failures.push(`${group}: ${entry}`)
    }
  }
}

if (failures.length > 0) {
  console.error('CODEOWNERS coverage check failed:\n' + failures.map((line) => `  - ${line}`).join('\n'))
  process.exit(1)
}

console.log('CODEOWNERS coverage check passed.')
