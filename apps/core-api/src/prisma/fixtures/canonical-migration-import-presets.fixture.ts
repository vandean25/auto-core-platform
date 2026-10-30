import { ImportEntityType, PrismaClient } from '@prisma/client';
import { CANONICAL_MIGRATION_PRESET_NAME } from '../../import/canonical-migration.constants.js';
import { buildCanonicalMigrationIdentityMapping } from '../../import/canonical-migration-preset.js';

/** Source namespace used by synthetic migration-csv-v1 fixtures and rehearsal docs. */
export const CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM =
  'synthetic_dms:synth_fixture';

const CANONICAL_MIGRATION_FIXTURE_SOURCE_LABEL = 'Synthetic DMS (fixture)';

export async function seedCanonicalMigrationImportPresets(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  await seedCanonicalMigrationImportSource(prisma, tenantId);

  const entityTypes: ImportEntityType[] = [
    ImportEntityType.CUSTOMER,
    ImportEntityType.VEHICLE,
    ImportEntityType.LABOR_OPERATION,
  ];

  for (const entityType of entityTypes) {
    const mapping = buildCanonicalMigrationIdentityMapping(entityType);
    await prisma.importMappingProfile.upsert({
      where: {
        tenant_id_entity_type_source_system_name: {
          tenant_id: tenantId,
          entity_type: entityType,
          source_system: CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM,
          name: CANONICAL_MIGRATION_PRESET_NAME,
        },
      },
      create: {
        tenant_id: tenantId,
        entity_type: entityType,
        source_system: CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM,
        name: CANONICAL_MIGRATION_PRESET_NAME,
        mapping_json: mapping,
      },
      update: {
        mapping_json: mapping,
      },
    });
  }
}

async function seedCanonicalMigrationImportSource(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  const existing = await prisma.importSource.findFirst({
    where: {
      tenant_id: tenantId,
      key: CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM,
    },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  const sourceCount = await prisma.importSource.count({
    where: { tenant_id: tenantId },
  });
  await prisma.importSource.create({
    data: {
      tenant_id: tenantId,
      key: CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM,
      label: CANONICAL_MIGRATION_FIXTURE_SOURCE_LABEL,
      is_default: sourceCount === 0,
    },
  });
}
