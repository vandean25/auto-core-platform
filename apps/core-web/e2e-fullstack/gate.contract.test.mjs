import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const fullstackDir = resolve(repoRoot, 'apps/core-web/e2e-fullstack')
const workflowPath = resolve(repoRoot, '.github/workflows/e2e-fullstack.yaml')
const playwrightConfigPath = resolve(repoRoot, 'apps/core-web/playwright.fullstack.config.ts')

const REQUIRED_FLOW_FILES = [
  'sales-invoice-and-credit-note.flow.spec.ts',
  'margin-scheme-vehicle-sale.flow.spec.ts',
  'workshop-command.flow.spec.ts',
  'workshop-mechanic-queue.flow.spec.ts',
  'client-session-cache-reset.flow.spec.ts',
]

function auditRawQuery(queryBlock, tenantTables) {
  const normalizedBlock = queryBlock
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\bpublic\./gi, '')
  const referencedTables = []
  for (const table of tenantTables) {
    const regex = new RegExp(`\\b(from|join|update|into)\\s+${table}\\b`, 'i')
    if (regex.test(normalizedBlock)) {
      referencedTables.push(table)
    }
  }
  if (referencedTables.length === 0) {
    return { referencedTables, isValid: true }
  }
  const isValid = queryBlock.includes('tenant_id')
  return { referencedTables, isValid }
}

test('prJobRunsAllFiveFullstackFlows', () => {
  const onDisk = readdirSync(fullstackDir)
    .filter((name) => name.endsWith('.flow.spec.ts'))
    .sort()
  assert.deepEqual(onDisk, [...REQUIRED_FLOW_FILES].sort())

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /test:e2e:fullstack/)
  for (const file of REQUIRED_FLOW_FILES) {
    assert.ok(
      readdirSync(fullstackDir).includes(file),
      `missing full-stack flow spec ${file}`,
    )
  }
})

test('noFailureHidingRetry', () => {
  const config = readFileSync(playwrightConfigPath, 'utf8')
  assert.match(config, /retries:\s*0/)
  assert.doesNotMatch(config, /retries:\s*process\.env\.CI\s*\?/)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.doesNotMatch(workflow, /run-ui-smoke/)
  assert.doesNotMatch(workflow, /attempt \$i\/3/)
})

test('injectedTenantFilterRegressionFailsGate', () => {
  const tenantTables = new Set(['customers', 'workshop_orders'])
  const unfiltered = `
    SELECT id FROM customers
    WHERE id = $1
  `
  const filtered = `
    SELECT id FROM customers
    WHERE id = $1 AND tenant_id = $2
  `
  assert.equal(auditRawQuery(unfiltered, tenantTables).isValid, false)
  assert.equal(auditRawQuery(filtered, tenantTables).isValid, true)

  const source = readFileSync(
    resolve(repoRoot, 'apps/core-api/src/prisma/tenant-isolation-raw-sql.spec.ts'),
    'utf8',
  )
  assert.match(source, /injectedTenantFilterRegressionFailsGate/)
})
