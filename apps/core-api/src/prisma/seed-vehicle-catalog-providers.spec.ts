import { CatalogOemConcernCode } from '@prisma/client';
import {
  resolveOemConcernForBrand,
  resolveVehicleMakeBrand,
  seedVehicleCatalogProviders,
} from './seed-vehicle-catalog-providers';

type BrandRecord = {
  id: number;
  name: string;
  isVehicleMake: boolean;
};

type AliasRecord = {
  alias_normalized: string;
  brand_id: number;
};

type ConcernRecord = {
  id: string;
  code: CatalogOemConcernCode;
};

type ConcernMakeRecord = {
  brand_id: number;
  concern_id: string;
};

function createPrismaMock() {
  const brands = new Map<string, BrandRecord>();
  const aliases = new Map<string, AliasRecord>();
  const concerns = new Map<CatalogOemConcernCode, ConcernRecord>();
  const concernMakes = new Map<number, ConcernMakeRecord>();
  let brandIdCounter = 1;
  let concernIdCounter = 1;
  let providerSettingsCount = 0;

  const prisma = {
    brand: {
      findFirst: jest.fn(async ({ where }: { where: { tenant_id: string; name: string } }) => {
        return brands.get(where.name) ?? null;
      }),
      create: jest.fn(
        async ({
          data,
        }: {
          data: { tenant_id: string; name: string; isVehicleMake: boolean };
        }) => {
          const brand = {
            id: brandIdCounter++,
            name: data.name,
            isVehicleMake: data.isVehicleMake,
          };
          brands.set(data.name, brand);
          return brand;
        },
      ),
    },
    vehicleMakeAlias: {
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { tenant_id_alias_normalized: { alias_normalized: string } };
          create: AliasRecord;
          update: { brand_id: number };
        }) => {
          const key = where.tenant_id_alias_normalized.alias_normalized;
          const existing = aliases.get(key);
          const next = existing
            ? { ...existing, brand_id: update.brand_id }
            : create;
          aliases.set(key, next);
          return next;
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
          include,
        }: {
          where: { tenant_id: string; alias_normalized: string };
          include?: { brand: boolean };
        }) => {
          const alias = aliases.get(where.alias_normalized);
          if (!alias) {
            return null;
          }

          const brand = [...brands.values()].find((entry) => entry.id === alias.brand_id);
          if (!brand) {
            return null;
          }

          return include?.brand ? { ...alias, brand } : alias;
        },
      ),
    },
    catalogOemConcern: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { tenant_id_code: { code: CatalogOemConcernCode } };
          create: { tenant_id: string; code: CatalogOemConcernCode };
        }) => {
          const code = where.tenant_id_code.code;
          const existing = concerns.get(code);
          if (existing) {
            return existing;
          }

          const concern = { id: `concern-${concernIdCounter++}`, code };
          concerns.set(code, concern);
          return concern;
        },
      ),
    },
    catalogOemConcernMake: {
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { tenant_id_brand_id: { brand_id: number } };
          create: ConcernMakeRecord;
          update: { concern_id: string };
        }) => {
          const brandId = where.tenant_id_brand_id.brand_id;
          const existing = concernMakes.get(brandId);
          const next = existing
            ? { ...existing, concern_id: update.concern_id }
            : create;
          concernMakes.set(brandId, next);
          return next;
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
          include,
        }: {
          where: { tenant_id: string; brand_id: number };
          include?: { concern: boolean };
        }) => {
          const link = concernMakes.get(where.brand_id);
          if (!link) {
            return null;
          }

          const concern = [...concerns.values()].find(
            (entry) => entry.id === link.concern_id,
          );
          if (!concern) {
            return null;
          }

          return include?.concern ? { ...link, concern } : link;
        },
      ),
    },
    catalogProviderSettings: {
      findFirst: jest.fn(async () =>
        providerSettingsCount > 0 ? { id: 'settings-1' } : null,
      ),
      create: jest.fn(async () => {
        providerSettingsCount += 1;
        return { id: 'settings-1' };
      }),
    },
  };

  return {
    prisma: prisma as any,
    brands,
    aliases,
    concerns,
    concernMakes,
    getProviderSettingsCount: () => providerSettingsCount,
  };
}

describe('seedVehicleCatalogProviders', () => {
  it('maps Peugeot alias to a vehicle-make Brand joined to the Stellantis concern', async () => {
    const { prisma } = createPrismaMock();

    await seedVehicleCatalogProviders(prisma, 'tenant-1');

    const peugeotAlias = await resolveVehicleMakeBrand(
      prisma,
      'tenant-1',
      'Peugeot SA',
    );
    expect(peugeotAlias?.brand.name).toBe('Peugeot');
    expect(peugeotAlias?.brand.isVehicleMake).toBe(true);

    const concern = await resolveOemConcernForBrand(
      prisma,
      'tenant-1',
      peugeotAlias!.brand.id,
    );
    expect(concern?.concern.code).toBe('STELLANTIS');
  });

  it('does not assign an unknown make to the Stellantis concern', async () => {
    const { prisma } = createPrismaMock();

    await seedVehicleCatalogProviders(prisma, 'tenant-1');

    const unknownAlias = await resolveVehicleMakeBrand(
      prisma,
      'tenant-1',
      'Unknown Motors GmbH',
    );
    expect(unknownAlias).toBeNull();
  });

  it('maps decoder BMW to the BMW concern and Volkswagen to no OEM concern', async () => {
    const { prisma } = createPrismaMock();

    await seedVehicleCatalogProviders(prisma, 'tenant-1');

    const bmw = await resolveVehicleMakeBrand(prisma, 'tenant-1', 'BMW');
    expect(bmw?.brand.name).toBe('BMW');
    const bmwConcern = await resolveOemConcernForBrand(
      prisma,
      'tenant-1',
      bmw!.brand.id,
    );
    expect(bmwConcern?.concern.code).toBe('BMW');

    const vw = await resolveVehicleMakeBrand(prisma, 'tenant-1', 'Volkswagen');
    expect(vw?.brand.name).toBe('Volkswagen');
    const vwConcern = await resolveOemConcernForBrand(
      prisma,
      'tenant-1',
      vw!.brand.id,
    );
    expect(vwConcern).toBeNull();
  });

  it('creates a singleton CatalogProviderSettings row per tenant', async () => {
    const { prisma, getProviderSettingsCount } = createPrismaMock();

    const firstRun = await seedVehicleCatalogProviders(prisma, 'tenant-1');
    const secondRun = await seedVehicleCatalogProviders(prisma, 'tenant-1');

    expect(firstRun.providerSettingsCreated).toBe(true);
    expect(secondRun.providerSettingsCreated).toBe(false);
    expect(getProviderSettingsCount()).toBe(1);
    expect(prisma.catalogProviderSettings.create).toHaveBeenCalledTimes(1);
  });
});
