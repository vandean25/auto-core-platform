import { CatalogOemConcernCode, Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { SANDBOX_CATALOG_ADAPTER_IDS } from '../catalog/catalog-adapter-ids';
import { normalizeVehicleMakeAlias } from '../catalog/vehicle-make-alias.util';
import { chunkedPromiseAll } from '../common/utils/promise.util';

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
    aliases: ['BMW', 'BMW AG', 'BAYERISCHE MOTOREN WERKE'],
    concern: 'BMW',
  },
  {
    name: 'Mercedes-Benz',
    aliases: ['MERCEDES', 'MERCEDES-BENZ', 'MERCEDES BENZ', 'Mercedes-Benz'],
    concern: 'MERCEDES',
  },
  {
    name: 'Volkswagen',
    aliases: ['VW', 'Volkswagen', 'VOLKSWAGEN AG', 'VW AG'],
  },
  { name: 'Audi', aliases: ['Audi', 'AUDI AG'] },
  { name: 'Porsche', aliases: ['Porsche', 'PORSCHE AG'] },
  { name: 'Skoda', aliases: ['Skoda', 'SKODA', 'ŠKODA'] },
  { name: 'Seat', aliases: ['Seat', 'SEAT', 'CUPRA'] },
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
  const existingBrands = await prisma.brand.findMany({
    where: { tenant_id: tenantId },
    select: {
      id: true,
      name: true,
      normalized_name: true,
      isPartManufacturer: true,
    },
  });
  const brandByName = new Map<string, { id: number; name: string }>();
  for (const brand of [...existingBrands].sort(
    (left, right) => left.id - right.id,
  )) {
    const normalizedName = brand.normalized_name;
    if (!brandByName.has(normalizedName)) {
      brandByName.set(normalizedName, { id: brand.id, name: brand.name });
    }
  }

  const existingSeedBrands = ALL_MAKE_DEFINITIONS.flatMap((definition) => {
    const brand = brandByName.get(normalizeVehicleMakeAlias(definition.name));
    return brand ? [brand] : [];
  });
  await chunkedPromiseAll(existingSeedBrands, (brand) =>
    prisma.brand.updateMany({
      where: { tenant_id: tenantId, id: brand.id },
      data: { isVehicleMake: true },
    }),
  );

  const missingBrandDefinitions = ALL_MAKE_DEFINITIONS.filter(
    (definition) =>
      !brandByName.has(normalizeVehicleMakeAlias(definition.name)),
  );
  const createdBrands = await chunkedPromiseAll(
    missingBrandDefinitions,
    (definition) =>
      prisma.brand.upsert({
        where: {
          tenant_id_normalized_name: {
            tenant_id: tenantId,
            normalized_name: normalizeVehicleMakeAlias(definition.name),
          },
        },
        update: { isVehicleMake: true },
        create: {
          tenant_id: tenantId,
          name: definition.name,
          normalized_name: normalizeVehicleMakeAlias(definition.name),
          isVehicleMake: true,
          isPartManufacturer: false,
        },
        select: { id: true, name: true, normalized_name: true },
      }),
  );
  for (const brand of createdBrands) {
    brandByName.set(brand.normalized_name, {
      id: brand.id,
      name: brand.name,
    });
  }

  const aliasSeedsByNormalized = new Map<
    string,
    { alias_normalized: string; brand_id: number }
  >();
  for (const definition of ALL_MAKE_DEFINITIONS) {
    const brand = brandByName.get(normalizeVehicleMakeAlias(definition.name));
    if (!brand) {
      continue;
    }

    const seenAliases = new Set<string>();
    for (const alias of [definition.name, ...definition.aliases]) {
      const alias_normalized = normalizeVehicleMakeAlias(alias);
      if (seenAliases.has(alias_normalized)) {
        continue;
      }
      seenAliases.add(alias_normalized);
      aliasSeedsByNormalized.set(alias_normalized, {
        alias_normalized,
        brand_id: brand.id,
      });
    }
  }
  const aliasSeeds = [...aliasSeedsByNormalized.values()];
  await chunkedPromiseAll(aliasSeeds, (alias) =>
    prisma.vehicleMakeAlias.upsert({
      where: {
        tenant_id_alias_normalized: {
          tenant_id: tenantId,
          alias_normalized: alias.alias_normalized,
        },
      },
      update: { brand_id: alias.brand_id },
      create: {
        tenant_id: tenantId,
        alias_normalized: alias.alias_normalized,
        brand_id: alias.brand_id,
      },
    }),
  );

  const existingConcerns = await prisma.catalogOemConcern.findMany({
    where: {
      tenant_id: tenantId,
      code: { in: OEM_CONCERN_CODES },
    },
    select: { id: true, code: true },
  });
  const concernByCode = new Map(
    existingConcerns.map((concern) => [concern.code, concern]),
  );
  const concernAdapterIds: Record<
    CatalogOemConcernCode,
    { parts_adapter_id: string; labor_adapter_id: string }
  > = {
    BMW: {
      parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_BMW_PARTS,
      labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_BMW_LABOR,
    },
    MERCEDES: {
      parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_MERCEDES_PARTS,
      labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_MERCEDES_LABOR,
    },
    STELLANTIS: {
      parts_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_PARTS,
      labor_adapter_id: SANDBOX_CATALOG_ADAPTER_IDS.OEM_STELLANTIS_LABOR,
    },
  };

  const createdConcerns = await chunkedPromiseAll(OEM_CONCERN_CODES, (code) =>
    prisma.catalogOemConcern.upsert({
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
        ...concernAdapterIds[code],
      },
      select: { id: true, code: true },
    }),
  );
  for (const concern of createdConcerns) {
    concernByCode.set(concern.code, concern);
  }

  const concernMakeSeeds = ALL_MAKE_DEFINITIONS.flatMap((definition) => {
    if (!definition.concern) {
      return [];
    }

    const brand = brandByName.get(normalizeVehicleMakeAlias(definition.name));
    const concern = concernByCode.get(definition.concern);
    if (!brand || !concern) {
      return [];
    }

    return [{ brand_id: brand.id, concern_id: concern.id }];
  });
  await chunkedPromiseAll(concernMakeSeeds, (seed) =>
    prisma.catalogOemConcernMake.upsert({
      where: {
        tenant_id_brand_id: {
          tenant_id: tenantId,
          brand_id: seed.brand_id,
        },
      },
      update: { concern_id: seed.concern_id },
      create: {
        tenant_id: tenantId,
        concern_id: seed.concern_id,
        brand_id: seed.brand_id,
      },
    }),
  );

  const existingSettings = await prisma.catalogProviderSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { id: true },
  });

  await prisma.catalogProviderSettings.upsert({
    where: { tenant_id: tenantId },
    update: {},
    create: {
      tenant_id: tenantId,
      default_parts_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
      default_labor_aftermarket_adapter_id:
        SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
    },
  });

  return {
    brandsCreated: createdBrands.length,
    aliasesUpserted: aliasSeeds.length,
    concernsUpserted: OEM_CONCERN_CODES.length,
    concernMakesUpserted: concernMakeSeeds.length,
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
    where: {
      tenant_id: tenantId,
      alias_normalized,
      brand: { tenant_id: tenantId },
    },
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
    where: {
      tenant_id: tenantId,
      brand_id: brandId,
      brand: { tenant_id: tenantId },
    },
    include: { concern: true },
  });
}
