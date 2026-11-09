/**
 * Explicit fixture paths for critical CODEOWNERS coverage (no directory glob expansion).
 */

/** @type {Record<string, readonly string[]>} */
export const CRITICAL_PATH_INVENTORY = {
  financeInvoicesCreditNotes: [
    'apps/core-api/src/finance/finance.service.ts',
    'apps/core-api/src/invoices/invoices.service.ts',
    'apps/core-api/src/credit-notes/credit-notes.service.ts',
    'apps/core-web/src/components/finance/InvoiceSettlementActions.tsx',
    'apps/core-web/src/pages/finance/CreditNotesPage.tsx',
    'apps/core-web/src/pages/sales/InvoiceListPage.tsx',
    'apps/core-web/src/api/useCreditNotes.ts',
  ],
  authFirebasePermissions: [
    'apps/core-api/src/auth/firebase-admin.ts',
    'apps/core-api/src/auth/auth.service.ts',
    'apps/core-web/src/auth/AuthProvider.tsx',
    'apps/core-api/src/permissions/permission.guard.ts',
    'apps/core-api/src/tenant-member/tenant-member.firebase.ts',
  ],
  prismaMigrations: [
    'apps/core-api/prisma/schema.prisma',
    'apps/core-api/prisma/migrations/20261017010000_aut600_invoice_draft_from_workshop_order_policy/migration.sql',
    'apps/core-api/prisma/migrations/migration_lock.toml',
  ],
  tenantIsolation: [
    'apps/core-api/src/prisma/tenant-isolation.extension.ts',
    'apps/core-api/src/common/services/tenant-context.middleware.ts',
    'apps/core-api/src/common/services/tenant-context.service.ts',
    'tools/tenant-restore/purge-tenant-data.sql',
    'tools/tenant-restore/tenant-schema.test.mjs',
  ],
  agentInstructions: [
    'agents.md',
    'CLAUDE.md',
    '.cursor/rules/pr-lifecycle.mdc',
    '.claude/settings.json',
    '.agents/skills/ponytail/SKILL.md',
  ],
  baselineAndCheckers: [
    'tools/spec-quality-baseline.json',
    'apps/core-web/src/features/interaction/guards/intent-prefetch.baseline.json',
    'apps/core-web/src/features/interaction/mutation-key.baseline.json',
    'tools/check-spec-quality.mjs',
    'tools/check-interaction-baselines.mjs',
    'tools/spec-quality-lib.mjs',
    'tools/interaction-baselines-lib.mjs',
  ],
  ciAndInfra: [
    '.github/scripts/run-ui-smoke.sh',
    'cloudbuild.yaml',
    'cloudbuild.staging.yaml',
    'infra/environments/staging.tfvars.example',
  ],
}

const inventorySet = new Set(Object.values(CRITICAL_PATH_INVENTORY).flat())

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isListedInventoryPath(filePath) {
  return inventorySet.has(filePath.replaceAll('\\', '/').replace(/^\/+/, ''))
}

export const UNLISTED_SMOKE_PATH = 'apps/core-web/src/components/GlobalSearch.tsx'
