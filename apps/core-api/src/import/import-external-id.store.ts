import { ImportEntityType, Prisma } from '@prisma/client';
import type { ExternalIdMapping } from '@prisma/client';
import { ApplyRowStaleError } from './import-apply.errors.js';

export type LegacyId = Pick<ExternalIdMapping, 'source_system' | 'external_id'>;

type MappingScope = { tenantId: string; entityType: ImportEntityType };
type MappingClient = Pick<Prisma.TransactionClient, 'externalIdMapping'>;

export async function findExternalEntityIds(
  prisma: MappingClient,
  scope: MappingScope & { externalId: string },
): Promise<string[]> {
  const mappings = await prisma.externalIdMapping.findMany({
    where: {
      tenant_id: scope.tenantId,
      entity_type: scope.entityType,
      external_id: scope.externalId,
    },
    select: { entity_id: true },
  });
  return [...new Set(mappings.map((mapping) => mapping.entity_id))];
}

export async function attachLegacyIds<T extends { id: string }>(
  prisma: MappingClient,
  scope: MappingScope,
  entities: readonly T[],
): Promise<Array<T & { legacy_ids: LegacyId[] }>> {
  if (entities.length === 0) return [];

  const mappings = await prisma.externalIdMapping.findMany({
    where: {
      tenant_id: scope.tenantId,
      entity_type: scope.entityType,
      entity_id: { in: entities.map((entity) => entity.id) },
    },
    select: { entity_id: true, source_system: true, external_id: true },
    orderBy: [{ source_system: 'asc' }, { external_id: 'asc' }],
  });
  const byEntity = new Map<string, LegacyId[]>();
  for (const { entity_id, source_system, external_id } of mappings) {
    const ids = byEntity.get(entity_id) ?? [];
    ids.push({ source_system, external_id });
    byEntity.set(entity_id, ids);
  }
  return entities.map((entity) => ({
    ...entity,
    legacy_ids: byEntity.get(entity.id) ?? [],
  }));
}

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
