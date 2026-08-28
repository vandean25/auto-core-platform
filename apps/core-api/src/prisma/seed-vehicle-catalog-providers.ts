import { CatalogOemConcernCode, Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { normalizeVehicleMakeAlias } from '../catalog/vehicle-make-alias.util';

type CatalogSeedClient =
  | Pick<
      PrismaClient,
      | 'brand'
      | 'vehicleMakeAlias'
      | 'catalogOemConcern'
      | 'catalogOemConcernMake'
      | 'catalogProviderSettings'
    >
  | Prisma.TransactionClient;

export interface VehicleCatalogSeedSummary {
  brandsCreated: number;
  aliasesUpserted: number;
  concernsUpserted: number;
  concernMakesUpserted: number;
  providerSettingsCreated: boolean;
}

interface MakeSeedDefinition {
  name: string;
  aliases: string[];
  concern?: CatalogOemConcernCode;
}

const STELLANTIS_MAKES: MakeSeedDefinition[] = [
  {
    name: 'Peugeot',
    aliases: ['PEUGEOT', 'Peugeot SA'],
    concern: 'STELLANTIS',
  },
  {
    name: 'Citroën',
    aliases: ['CITROEN', 'CITROËN', 'Citroen'],
    concern: 'STELLANTIS',
  },
  { name: 'Opel', aliases: ['OPEL', 'Opel Automobile'], concern: 'STELLANTIS' },
  { name: 'Fiat', aliases: ['FIAT'], concern: 'STELLANTIS' },
  { name: 'Jeep', aliases: ['JEEP'], concern: 'STELLANTIS' },
  { name: 'DS', aliases: ['DS', 'DS AUTOMOBILES'], concern: 'STELLANTIS' },
  {
    name: 'Alfa Romeo',
    aliases: ['ALFA ROMEO', 'ALFAROMEO'],
    concern: 'STELLANTIS',
  },
];

const OTHER_MAKE_ALIASES: MakeSeedDefinition[] = [
  {
    name: 'BMW',
    aliases: ['BMW AG', 'BAYERISCHE MOTOREN WERKE'],
    concern: 'BMW',
  },
  {
    name: 'Mercedes-Benz',
    aliases: ['MERCEDES', 'MERCEDES-BENZ', 'MERCEDES BENZ'],
    concern: 'MERCEDES',
  },
  {
    name: 'Volkswagen',
    aliases: ['VW', 'VOLKSWAGEN AG', 'VW AG'],
  },
  { name: 'Audi', aliases: ['AUDI AG'] },
  { name: 'Porsche', aliases: ['PORSCHE AG'] },
  { name: 'Skoda', aliases: ['SKODA', 'ŠKODA'] },
  { name: 'Seat', aliases: ['SEAT', 'CUPRA'] },
];

const ALL_MAKE_DEFINITIONS = [...STELLANTIS_MAKES, ...OTHER_MAKE_ALIASES];

const OEM_CONCERN_CODES: CatalogOemConcernCode[] = [
  'BMW',
  'MERCEDES',
  'STELLANTIS',
];

export async function seedVehicleCatalogProviders(
  prisma: CatalogSeedClient,
  tenantId: string,
): Promise<VehicleCatalogSeedSummary> {
  const brandByName = new Map<string, { id: number; name: string }>();
  let brandsCreated = 0;
  let aliasesUpserted = 0;
  let concernMakesUpserted = 0;

  for (const definition of ALL_MAKE_DEFINITIONS) {
    let brand = await prisma.brand.findFirst({
      where: { tenant_id: tenantId, name: definition.name },
      select: { id: true, name: true },
    });

    if (!brand) {
      brand = await prisma.brand.create({
        data: {
          tenant_id: tenantId,
          name: definition.name,
          isVehicleMake: true,
          isPartManufacturer: false,
        },
        select: { id: true, name: true },
      });
      brandsCreated += 1;
    }

    brandByName.set(definition.name, brand);

    for (const alias of definition.aliases) {
      const alias_normalized = normalizeVehicleMakeAlias(alias);
      await prisma.vehicleMakeAlias.upsert({
        where: {
          tenant_id_alias_normalized: {
            tenant_id: tenantId,
            alias_normalized,
          },
        },
        update: { brand_id: brand.id },
        create: {
          tenant_id: tenantId,
          alias_normalized,
          brand_id: brand.id,
        },
      });
      aliasesUpserted += 1;
    }
  }

  let concernsUpserted = 0;
  const concernByCode = new Map<CatalogOemConcernCode, { id: string }>();

  for (const code of OEM_CONCERN_CODES) {
    const concern = await prisma.catalogOemConcern.upsert({
      where: {
        tenant_id_code: {
          tenant_id: tenantId,
          code,
        },
      },
      update: {},
      create: {
        tenant_id: tenantId,
        code,
      },
      select: { id: true },
    });
    concernByCode.set(code, concern);
    concernsUpserted += 1;
  }

  for (const definition of ALL_MAKE_DEFINITIONS) {
    if (!definition.concern) {
      continue;
    }

    const brand = brandByName.get(definition.name);
    const concern = concernByCode.get(definition.concern);
    if (!brand || !concern) {
      continue;
    }

    await prisma.catalogOemConcernMake.upsert({
      where: {
        tenant_id_brand_id: {
          tenant_id: tenantId,
          brand_id: brand.id,
        },
      },
      update: { concern_id: concern.id },
      create: {
        tenant_id: tenantId,
        concern_id: concern.id,
        brand_id: brand.id,
      },
    });
    concernMakesUpserted += 1;
  }

  const existingSettings = await prisma.catalogProviderSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { id: true },
  });

  if (!existingSettings) {
    await prisma.catalogProviderSettings.create({
      data: {
        tenant_id: tenantId,
      },
    });
  }

  return {
    brandsCreated,
    aliasesUpserted,
    concernsUpserted,
    concernMakesUpserted,
    providerSettingsCreated: !existingSettings,
  };
}

/**
 * Resolves a decoder make label to a vehicle-make Brand via VehicleMakeAlias.
 */
export async function resolveVehicleMakeBrand(
  prisma: Pick<PrismaClient, 'vehicleMakeAlias'>,
  tenantId: string,
  decoderMake: string,
) {
  const alias_normalized = normalizeVehicleMakeAlias(decoderMake);
  return prisma.vehicleMakeAlias.findFirst({
    where: { tenant_id: tenantId, alias_normalized },
    include: {
      brand: true,
    },
  });
}

/**
 * Returns the OEM concern for a vehicle-make Brand, if configured.
 */
export async function resolveOemConcernForBrand(
  prisma: Pick<PrismaClient, 'catalogOemConcernMake'>,
  tenantId: string,
  brandId: number,
) {
  return prisma.catalogOemConcernMake.findFirst({
    where: { tenant_id: tenantId, brand_id: brandId },
    include: { concern: true },
  });
}
