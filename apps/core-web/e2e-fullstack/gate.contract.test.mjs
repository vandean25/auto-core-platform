import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditRawQuery } from '../../core-api/src/prisma/audit-raw-query.mjs'

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

const REQUIRED_JOURNEY_FILES = ['auth.journey.spec.ts', 'tenant-isolation.journey.spec.ts']

test('prJobRunsAllFiveFullstackFlows', () => {
  const onDisk = readdirSync(fullstackDir)
    .filter((name) => name.endsWith('.flow.spec.ts'))
    .sort()
  assert.deepEqual(onDisk, [...REQUIRED_FLOW_FILES].sort())

  for (const file of REQUIRED_JOURNEY_FILES) {
    assert.ok(readdirSync(fullstackDir).includes(file), `missing full-stack journey spec ${file}`)
  }

  const playwrightConfig = readFileSync(playwrightConfigPath, 'utf8')
  assert.doesNotMatch(
    playwrightConfig,
    /testMatch|grep:\s*\/\*\.flow\.spec\.ts/,
    'playwright config must not limit full-stack runs to *.flow.spec.ts only',
  )

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
  const injectedRegression = `
    const rows = await prisma.$queryRaw\`
      SELECT id FROM "customers"
      WHERE id = \${customerId}
    \`
  `
  const regressionAudit = auditRawQuery(injectedRegression, tenantTables)
  assert.equal(regressionAudit.isValid, false, 'unfiltered quoted tenant table must be rejected')
  assert.deepEqual(regressionAudit.referencedTables, ['customers'])

  const filtered = `
    const rows = await prisma.$queryRaw\`
      SELECT id FROM customers
      WHERE id = \${customerId} AND tenant_id = \${tenantId}
    \`
  `
  const filteredAudit = auditRawQuery(filtered, tenantTables)
  assert.equal(filteredAudit.isValid, true, 'filtered tenant query must remain valid')
})
