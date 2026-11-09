export function auditRawQuery(
  queryBlock: string,
  tenantTables: ReadonlySet<string> | Iterable<string>,
): { referencedTables: string[]; isValid: boolean }
