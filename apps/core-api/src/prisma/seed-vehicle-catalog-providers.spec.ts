import { CatalogOemConcernCode } from '@prisma/client';
import { SANDBOX_CATALOG_ADAPTER_IDS } from '../catalog/catalog-adapter-ids';
import {
  resolveOemConcernForBrand,
  resolveVehicleMakeBrand,
  seedVehicleCatalogProviders,
} from './seed-vehicle-catalog-providers';

type BrandRecord = {
  id: number;
  tenant_id: string;
  name: string;
  normalized_name: string;
  isVehicleMake: boolean;
  isPartManufacturer: boolean;
};

type AliasRecord = {
  alias_normalized: string;
  brand_id: number;
};

type ConcernRecord = {
  id: string;
  tenant_id: string;
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
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { tenant_id: string; name?: { in: string[] } };
        }) =>
          [...brands.values()].filter(
            (brand) =>
              brand.tenant_id === where.tenant_id &&
              (where.name === undefined || where.name.in.includes(brand.name)),
          ),
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: {
            tenant_id: string;
            name: string;
            normalized_name: string;
            isVehicleMake: boolean;
          };
        }) => {
          const brand = {
            id: brandIdCounter++,
            tenant_id: data.tenant_id,
            name: data.name,
            normalized_name: data.normalized_name,
            isVehicleMake: data.isVehicleMake,
            isPartManufacturer: data.isPartManufacturer,
          };
          brands.set(data.name, brand);
          return brand;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: {
            tenant_id_normalized_name: {
              tenant_id: string;
              normalized_name: string;
            };
          };
          create: {
            tenant_id: string;
            name: string;
            normalized_name: string;
            isVehicleMake: boolean;
            isPartManufacturer: boolean;
          };
          update: { isVehicleMake: boolean };
        }) => {
          const { tenant_id, normalized_name } =
            where.tenant_id_normalized_name;
          const existing = [...brands.values()].find(
            (brand) =>
              brand.tenant_id === tenant_id &&
              brand.normalized_name === normalized_name,
          );
          if (existing) {
            existing.isVehicleMake = update.isVehicleMake;
            return existing;
          }

          const brand = {
            id: brandIdCounter++,
            tenant_id: create.tenant_id,
            name: create.name,
            normalized_name: create.normalized_name,
            isVehicleMake: create.isVehicleMake,
            isPartManufacturer: create.isPartManufacturer,
          };
          brands.set(create.name, brand);
          return brand;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { tenant_id: string; id: number };
          data: { isVehicleMake: boolean };
        }) => {
          const existing = [...brands.values()].find(
            (brand) =>
              brand.tenant_id === where.tenant_id && brand.id === where.id,
          );
          if (!existing) {
            return { count: 0 };
          }
          existing.isVehicleMake = data.isVehicleMake;
          return { count: 1 };
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

          const brand = [...brands.values()].find(
            (entry) => entry.id === alias.brand_id,
          );
          if (!brand) {
            return null;
          }

          return include?.brand ? { ...alias, brand } : alias;
        },
      ),
    },
    catalogOemConcern: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            tenant_id: string;
            code: { in: CatalogOemConcernCode[] };
          };
        }) =>
          [...concerns.values()].filter(
            (concern) =>
              concern.tenant_id === where.tenant_id &&
              where.code.in.includes(concern.code),
          ),
      ),
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

          const concern = {
            id: `concern-${concernIdCounter++}`,
            tenant_id: create.tenant_id,
            code,
          };
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
      upsert: jest.fn(
        async ({
          create,
        }: {
          where: { tenant_id: string };
          update: Record<string, never>;
          create: { tenant_id: string };
        }) => {
          if (providerSettingsCount === 0) {
            providerSettingsCount += 1;
          }
          return { id: 'settings-1', tenant_id: create.tenant_id };
        },
      ),
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
  it('reconciles a case-variant existing dual-purpose Brand without creating a duplicate', async () => {
    const { prisma, brands } = createPrismaMock();
    brands.set('peugeot', {
      id: 77,
      tenant_id: 'tenant-1',
      name: 'peugeot',
      normalized_name: 'PEUGEOT',
      isVehicleMake: true,
      isPartManufacturer: true,
    });

    await seedVehicleCatalogProviders(prisma, 'tenant-1');

    const peugeotBrands = [...brands.values()].filter(
      (brand) => brand.name.toUpperCase() === 'PEUGEOT',
    );
    expect(peugeotBrands).toHaveLength(1);
    expect(peugeotBrands[0]).toMatchObject({
      id: 77,
      isVehicleMake: true,
      isPartManufacturer: true,
    });
    expect(prisma.brand.updateMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', id: 77 },
      data: { isVehicleMake: true },
    });
  });

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
    expect(prisma.catalogProviderSettings.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.catalogProviderSettings.create).not.toHaveBeenCalled();
  });

  it('uses atomic upserts for missing brands and provider settings', async () => {
    const { prisma } = createPrismaMock();

    await seedVehicleCatalogProviders(prisma, 'tenant-1');

    expect(prisma.brand.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ normalized_name: 'PEUGEOT' }),
      }),
    );
    expect(prisma.brand.create).not.toHaveBeenCalled();
    expect(prisma.catalogProviderSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1' },
        create: {
          tenant_id: 'tenant-1',
          default_parts_aftermarket_adapter_id:
            SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
          default_labor_aftermarket_adapter_id:
            SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
        },
        update: {
          default_parts_aftermarket_adapter_id:
            SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_PARTS,
          default_labor_aftermarket_adapter_id:
            SANDBOX_CATALOG_ADAPTER_IDS.AFTERMARKET_LABOR,
        },
      }),
    );
    expect(prisma.catalogProviderSettings.create).not.toHaveBeenCalled();
  });

  it('does not resolve a tenant-B Brand through tenant-A alias or concern rows', async () => {
    const foreignBrand = {
      id: 99,
      tenant_id: 'tenant-b',
      name: 'Foreign Peugeot',
      isVehicleMake: true,
    };
    const foreignAlias = {
      tenant_id: 'tenant-a',
      alias_normalized: 'PEUGEOT',
      brand_id: foreignBrand.id,
      brand: foreignBrand,
    };
    const foreignConcernMake = {
      tenant_id: 'tenant-a',
      brand_id: foreignBrand.id,
      concern_id: 'foreign-concern',
      concern: {
        id: 'foreign-concern',
        code: 'STELLANTIS' as CatalogOemConcernCode,
      },
    };
    const prisma = {
      vehicleMakeAlias: {
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: {
              tenant_id: string;
              alias_normalized: string;
              brand?: { tenant_id: string };
            };
          }) => (where.brand?.tenant_id === 'tenant-a' ? null : foreignAlias),
        ),
      },
      catalogOemConcernMake: {
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: {
              tenant_id: string;
              brand_id: number;
              brand?: { tenant_id: string };
            };
          }) =>
            where.brand?.tenant_id === 'tenant-a' ? null : foreignConcernMake,
        ),
      },
    } as any;

    const alias = await resolveVehicleMakeBrand(prisma, 'tenant-a', 'Peugeot');
    const concernMake = await resolveOemConcernForBrand(
      prisma,
      'tenant-a',
      foreignBrand.id,
    );

    expect(alias).toBeNull();
    expect(concernMake).toBeNull();
    expect(prisma.vehicleMakeAlias.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brand: { tenant_id: 'tenant-a' } }),
      }),
    );
    expect(prisma.catalogOemConcernMake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brand: { tenant_id: 'tenant-a' } }),
      }),
    );
  });
});
