import { ImportEntityType, Prisma } from '@prisma/client';
import { ApplyRowStaleError } from './import-apply.errors.js';

/** Records a new external id. A taken id means the plan is stale, so the row is refused. */
export async function createExternalMapping(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: ImportEntityType,
  sourceSystem: string,
  externalId: string,
  entityId: string,
  jobId: string,
): Promise<void> {
  try {
    await tx.externalIdMapping.create({
      data: {
        tenant_id: tenantId,
        entity_type: entityType,
        source_system: sourceSystem,
        external_id: externalId,
        entity_id: entityId,
        first_seen_import_job_id: jobId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApplyRowStaleError();
    }
    throw error;
  }
}

/** Points an external id at an entity, creating the mapping when it does not exist yet. */
export async function upsertExternalMapping(
  tx: Prisma.TransactionClient,
  tenantId: string,
  entityType: ImportEntityType,
  sourceSystem: string,
  externalId: string,
  entityId: string,
  jobId: string,
): Promise<void> {
  await tx.externalIdMapping.upsert({
    where: {
      tenant_id_entity_type_source_system_external_id: {
        tenant_id: tenantId,
        entity_type: entityType,
        source_system: sourceSystem,
        external_id: externalId,
      },
    },
    create: {
      tenant_id: tenantId,
      entity_type: entityType,
      source_system: sourceSystem,
      external_id: externalId,
      entity_id: entityId,
      first_seen_import_job_id: jobId,
    },
    update: { entity_id: entityId },
  });
}
