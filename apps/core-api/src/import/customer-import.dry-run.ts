import { ImportEntityType, ImportRowAction } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ParsedCsv } from './csv-parse.util.js';
import {
  customerNameKey,
  normalizeCustomerRow,
  planCustomerDryRunRow,
  type CustomerMatchContext,
} from './customer-import.logic.js';
import { pickCustomerAuditSnapshot } from './import-audit.util.js';
import { normalizeMatchEmail } from '../customer/customer-match.util.js';
import { planParsedCsvRowsWithBudget } from './import-dry-run-plan-budget.js';
import type { ImportDryRunInput } from './import-type-handler.js';
import type { DryRunRowResult } from './import.types.js';

type CustomerRecord = {
  id: string;
  type: string;
  company_name: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
};

/** The name key an existing customer is compared under, as the dry run has always built it. */
function existingCustomerNameKey(customer: CustomerRecord): string {
  if (customer.type === 'COMPANY' && customer.company_name) {
    return `company:${customer.company_name.trim().toLowerCase()}`;
  }
  return `person:${customer.first_name.trim().toLowerCase()}|${customer.last_name.trim().toLowerCase()}`;
}

async function loadCustomerMatchContext(
  prisma: PrismaService,
  tenantId: string,
  sourceSystem: string,
): Promise<CustomerMatchContext> {
  const mappings = await prisma.externalIdMapping.findMany({
    where: {
      tenant_id: tenantId,
      entity_type: ImportEntityType.CUSTOMER,
      source_system: sourceSystem,
    },
  });
  const mappingByExternalId = new Map(
    mappings.map((row) => [row.external_id, row.entity_id]),
  );

  const customers = await prisma.customer.findMany({
    where: { tenant_id: tenantId },
  });
  const customerByEmail = new Map<
    string,
    { id: string; record: Record<string, unknown> }
  >();
  const customerById = new Map<string, Record<string, unknown>>();
  const duplicateNameKeys = new Set<string>();

  for (const customer of customers) {
    const snapshot = pickCustomerAuditSnapshot(customer);
    customerById.set(customer.id, snapshot);
    const emailKey = normalizeMatchEmail(customer.email);
    if (emailKey) {
      customerByEmail.set(emailKey, {
        id: customer.id,
        record: snapshot,
      });
    }
    duplicateNameKeys.add(existingCustomerNameKey(customer));
  }

  return {
    mappingByExternalId,
    customerByEmail,
    customerById,
    duplicateNameKeys,
    externalIdSeenInFile: new Map<string, number>(),
    emailSeenInFile: new Map<string, number>(),
  };
}

function planCustomerCsvRow(
  rowNo: number,
  record: Record<string, string>,
  input: ImportDryRunInput,
  context: CustomerMatchContext,
): DryRunRowResult {
  const normalized = normalizeCustomerRow(record, input.mapping, input.options);
  if (!normalized.row) {
    return {
      row_no: rowNo,
      external_id: record[input.mapping.external_id ?? ''] ?? null,
      action: ImportRowAction.ERROR,
      entity_id: null,
      errors: normalized.issues,
      warnings: normalized.warnings,
      normalized: null,
    };
  }

  const planned = planCustomerDryRunRow(
    rowNo,
    normalized.row,
    context,
    input.options,
    normalized.warnings,
  );
  if (planned.action === ImportRowAction.CREATE) {
    context.duplicateNameKeys.add(customerNameKey(normalized.row));
  }
  return planned;
}

/** Plans every customer row of an upload, in file order. */
export async function planCustomerDryRun(
  prisma: PrismaService,
  input: ImportDryRunInput,
  parsed: ParsedCsv,
): Promise<DryRunRowResult[]> {
  const context = await loadCustomerMatchContext(
    prisma,
    input.tenantId,
    input.sourceSystem,
  );
  return planParsedCsvRowsWithBudget(parsed, input.planBudget, (rowNo, record) =>
    planCustomerCsvRow(rowNo, record, input, context),
  );
}
