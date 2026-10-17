#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { collectLeafKeys, interpolationVariables } from './i18n-check-lib.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const REGISTRY_PATH = path.join(
  REPO_ROOT,
  'apps/core-api/src/common/errors/public-error-code-registry.generated.json',
)

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function main() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(
      'Missing registry. Run: npm run error-codes:generate',
    )
    process.exit(1)
  }

  const registry = loadJson(REGISTRY_PATH)
  const de = loadJson(path.join(REPO_ROOT, 'locales/de/errors.json'))
  const en = loadJson(path.join(REPO_ROOT, 'locales/en/errors.json'))

  const errors = []
  const registryCodes = Object.keys(registry.codes ?? {}).sort()

  for (const code of registryCodes) {
    const deText = de.codes?.[code]
    const enText = en.codes?.[code]
    if (typeof deText !== 'string' || deText.trim().length === 0) {
      errors.push(`Missing DE translation for code ${code}`)
    }
    if (typeof enText !== 'string' || enText.trim().length === 0) {
      errors.push(`Missing EN translation for code ${code}`)
    }
    if (deText && enText) {
      if (deText.trim() === enText.trim()) {
        errors.push(
          `DE equals EN for code ${code} (provide a real German translation)`,
        )
      }
      const deVars = interpolationVariables(deText)
      const enVars = interpolationVariables(enText)
      if (deVars.join(',') !== enVars.join(',')) {
        errors.push(
          `Interpolation mismatch for ${code}: de=[${deVars}] en=[${enVars}]`,
        )
      }
    }
  }

  const deOnly = Object.keys(de.codes ?? {}).filter((c) => !registry.codes[c])
  const enOnly = Object.keys(en.codes ?? {}).filter((c) => !registry.codes[c])
  for (const orphan of deOnly) {
    errors.push(`Orphan DE errors.codes.${orphan} (not in registry)`)
  }
  for (const orphan of enOnly) {
    errors.push(`Orphan EN errors.codes.${orphan} (not in registry)`)
  }

  const deLeaf = new Set(collectLeafKeys(de.codes ?? {}))
  const enLeaf = new Set(collectLeafKeys(en.codes ?? {}))
  for (const key of deLeaf) {
    if (!enLeaf.has(key)) {
      errors.push(`DE errors.codes.${key} missing in EN`)
    }
  }
  for (const key of enLeaf) {
    if (!deLeaf.has(key)) {
      errors.push(`EN errors.codes.${key} missing in DE`)
    }
  }

  if (errors.length > 0) {
    console.error('error-code i18n check failed:')
    for (const line of errors) {
      console.error(`  - ${line}`)
    }
    process.exit(1)
  }

  console.log(
    `error-code i18n check passed (${registryCodes.length} registry codes with DE/EN keys).`,
  )
}

main()
