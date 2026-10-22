import { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
import {
  ApplyRowStaleError,
  resolveImportExternalId,
} from './import-apply.errors.js';
import type { ImportApplyRow } from './import-type-handler.js';

type TargetLookup = (
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityId: string,
) => Promise<boolean>;

const found = (row: unknown) => row !== null;

/** Whether the planned UPDATE target of each import type still exists in the tenant. */
const TARGET_LOOKUPS: Partial<Record<ImportEntityType, TargetLookup>> = {
  [ImportEntityType.CUSTOMER]: async (tx, tenantId, id) =>
    found(await tx.customer.findFirst({ where: { tenant_id: tenantId, id } })),
  [ImportEntityType.VEHICLE]: async (tx, tenantId, id) =>
    found(await tx.vehicle.findFirst({ where: { tenant_id: tenantId, id } })),
  [ImportEntityType.LABOR_OPERATION]: async (tx, tenantId, id) =>
    found(
      await tx.laborOperation.findFirst({ where: { tenant_id: tenantId, id } }),
    ),
  [ImportEntityType.VEHICLE_PARTY]: async (tx, tenantId, id) =>
    found(
      await tx.vehicleParty.findFirst({ where: { tenant_id: tenantId, id } }),
    ),
  [ImportEntityType.VEHICLE_DUE_DATE]: async (tx, tenantId, id) => {
    const [record, notice] = await Promise.all([
      tx.vehicleInspectionRecord.findFirst({
        where: { tenant_id: tenantId, id },
      }),
      tx.vehicleNotice.findFirst({ where: { tenant_id: tenantId, id } }),
    ]);
    return found(record) || found(notice);
  },
};

async function assertTargetExists(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: ImportEntityType,
  entityId: string,
): Promise<void> {
  const lookup = TARGET_LOOKUPS[entityType];
  if (lookup && !(await lookup(tx, tenantId, entityId))) {
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
