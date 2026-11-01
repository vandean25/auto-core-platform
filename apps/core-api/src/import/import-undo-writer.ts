import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { withPhoneDigits } from '../customer/customer-phone.util.js';

function parseDateOrNull(value: unknown): Date | null {
  return value ? new Date(value as string) : null;
}

type EntityRestorer = (
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityId: string,
  snapshot: Record<string, unknown>,
) => Promise<unknown>;

const ENTITY_RESTORERS: Record<string, EntityRestorer> = {
  CUSTOMER: (tx, tenantId, id, data) =>
    tx.customer.updateMany({
      where: { tenant_id: tenantId, id },
      data: withPhoneDigits(data as Prisma.CustomerUpdateManyMutationInput),
    }),
  VEHICLE: (tx, tenantId, id, data) =>
    tx.vehicle.updateMany({
      where: { tenant_id: tenantId, id },
      data: {
        ...data,
        first_registration_date: parseDateOrNull(data.first_registration_date),
      },
    }),
  LABOR_OPERATION: (tx, tenantId, id, data) =>
    tx.laborOperation.updateMany({
      where: { tenant_id: tenantId, id },
      data,
    }),
  VEHICLE_PARTY: (tx, tenantId, id, data) =>
    tx.vehicleParty.updateMany({
      where: { tenant_id: tenantId, id },
      data: {
        ...data,
        valid_from: parseDateOrNull(data.valid_from),
        valid_to: parseDateOrNull(data.valid_to),
      },
    }),
  VEHICLE_NOTICE: (tx, tenantId, id, data) =>
    tx.vehicleNotice.updateMany({
      where: { tenant_id: tenantId, id },
      data: {
        ...data,
        due_date: parseDateOrNull(data.due_date),
      },
    }),
};

export function isRestorableEntityType(entityType: string): boolean {
  return Boolean(ENTITY_RESTORERS[entityType]);
}

/** Reverts an UPDATE row to its before snapshot. */
export async function restoreUpdatedEntity(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const restorer = ENTITY_RESTORERS[entityType];
  if (!restorer) {
    return;
  }
  await restorer(tx, tenantId, entityId, snapshot);
}

/** Removes a CREATE row: the entity itself plus the rows the import created around it. */
export async function deleteCreatedEntity(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: string,
  entityId: string,
  jobId: string,
): Promise<void> {
  await tx.externalIdMapping.deleteMany({
    where: {
      tenant_id: tenantId,
      first_seen_import_job_id: jobId,
      entity_id: entityId,
    },
  });

  switch (entityType) {
    case 'CUSTOMER':
      await tx.customerConsentUnsubscribeToken.deleteMany({
        where: { tenant_id: tenantId, customer_id: entityId },
      });
      await tx.customerCommunicationState.deleteMany({
        where: { tenant_id: tenantId, customer_id: entityId },
      });
      await tx.customer.deleteMany({
        where: { tenant_id: tenantId, id: entityId },
      });
      return;
    case 'VEHICLE':
      await tx.vehicle.deleteMany({
        where: { tenant_id: tenantId, id: entityId },
      });
      return;
    case 'LABOR_OPERATION':
      await tx.laborOperation.deleteMany({
        where: { tenant_id: tenantId, id: entityId },
      });
      return;
    case 'CATALOG_ITEM':
      await tx.catalogPriceHistory.deleteMany({
        where: { tenant_id: tenantId, catalog_item_id: entityId },
      });
      await tx.vendorArticle.deleteMany({
        where: { tenant_id: tenantId, catalog_item_id: entityId },
      });
      await tx.catalogItem.deleteMany({
        where: { tenant_id: tenantId, id: entityId },
      });
      return;
    case 'VEHICLE_PARTY':
      await tx.vehicleParty.deleteMany({
        where: { tenant_id: tenantId, id: entityId },
      });
      return;
    case 'VEHICLE_NOTICE':
      await tx.vehicleNotice.deleteMany({
        where: { tenant_id: tenantId, id: entityId },
      });
      return;
    default:
      throw new BadRequestException(
        `Unsupported entity type for delete: ${entityType}`,
      );
  }
}
