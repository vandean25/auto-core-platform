import { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
import { resolveImportExternalId } from './import-apply.errors.js';
import type {
  ImportApplyInput,
  ImportApplyRow,
} from './import-type-handler.js';

import type { PrismaService } from '../prisma/prisma.service.js';

/** The client the duplicate detection reads through: a transaction or the bare service. */
export type ImportDbClient = Prisma.TransactionClient | PrismaService;

/**
 * Rows of the same import can repeat an external id. Once one CREATE for it has been
 * committed, later ones are either a no-op (same row) or a duplicate error (other row).
 */
export async function earliestCommittedCreateRowNoInJob(
  db: ImportDbClient,
  input: ImportApplyInput,
  row: ImportApplyRow,
): Promise<number | null> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  if (!externalId) {
    return null;
  }
  const earliest = await db.importJobRow.findFirst({
    where: {
      tenant_id: input.tenantId,
      import_job_id: input.job.id,
      external_id: externalId,
      action: ImportRowAction.CREATE,
    },
    orderBy: { row_no: 'asc' },
    select: { row_no: true },
  });
  return earliest?.row_no ?? null;
}

export async function isDuplicateCreateAfterAnotherRowCommitted(
  db: ImportDbClient,
  input: ImportApplyInput,
  row: ImportApplyRow,
): Promise<boolean> {
  const earliest = await earliestCommittedCreateRowNoInJob(db, input, row);
  return earliest !== null && earliest !== row.row_no;
}

export async function isCreateAlreadyCommittedByJob(
  db: ImportDbClient,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  row: ImportApplyRow,
): Promise<boolean> {
  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);
  const mapping = await db.externalIdMapping.findFirst({
    where: {
      tenant_id: input.tenantId,
      entity_type: entityType,
      source_system: input.job.source_system,
      external_id: externalId,
    },
    select: { first_seen_import_job_id: true },
  });
  return mapping?.first_seen_import_job_id === input.job.id;
}

export async function resolveDuplicateCommittedCreateLegacy(
  db: ImportDbClient,
  input: ImportApplyInput,
  entityType: ImportEntityType,
  row: ImportApplyRow,
): Promise<'noop' | 'duplicate_error' | null> {
  if (row.action !== ImportRowAction.CREATE) {
    return null;
  }
  if (!(await isCreateAlreadyCommittedByJob(db, input, entityType, row))) {
    return null;
  }
  if (await isDuplicateCreateAfterAnotherRowCommitted(db, input, row)) {
    return 'duplicate_error';
  }
  return 'noop';
}
