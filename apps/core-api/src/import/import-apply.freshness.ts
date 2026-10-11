import { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
import {
  ApplyRowStaleError,
  resolveImportExternalId,
} from './import-apply.errors.js';
import type { ImportApplyRow } from './import-type-handler.js';

async function assertTargetExists(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: ImportEntityType,
  entityId: string,
): Promise<void> {
  if (entityType === ImportEntityType.CUSTOMER) {
    const customer = await tx.customer.findFirst({
      where: { tenant_id: tenantId, id: entityId },
    });
    if (!customer) {
      throw new ApplyRowStaleError();
    }
    return;
  }

  const vehicle = await tx.vehicle.findFirst({
    where: { tenant_id: tenantId, id: entityId },
  });
  if (!vehicle) {
    throw new ApplyRowStaleError();
  }
}

/**
 * Refuses a row whose plan no longer matches the database. A CREATE fails if its external id
 * was mapped since the preview. An UPDATE fails if its target was removed since the preview.
 */
export async function assertApplyRowIsFresh(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: ImportEntityType,
  sourceSystem: string,
  row: ImportApplyRow,
): Promise<void> {
  if (
    row.action !== ImportRowAction.CREATE &&
    row.action !== ImportRowAction.UPDATE
  ) {
    return;
  }

  const payload = row.normalized_json as Record<string, unknown>;
  const externalId = resolveImportExternalId(payload, row.external_id);

  if (row.action === ImportRowAction.CREATE) {
    const mapping = await tx.externalIdMapping.findFirst({
      where: {
        tenant_id: tenantId,
        entity_type: entityType,
        source_system: sourceSystem,
        external_id: externalId,
      },
    });
    if (mapping) {
      throw new ApplyRowStaleError();
    }
    return;
  }

  if (!row.entity_id) {
    throw new ApplyRowStaleError();
  }
  await assertTargetExists(tx, tenantId, entityType, row.entity_id);
}
