/**
 * Shared raw SQL tenant-filter audit used by tenant-isolation-raw-sql.spec.ts
 * and the full-stack PR gate contract tests.
 */
export function auditRawQuery(queryBlock, tenantTables) {
  const normalizedBlock = queryBlock.replace(/["`]/g, '').replace(/\bpublic\./gi, '')
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
