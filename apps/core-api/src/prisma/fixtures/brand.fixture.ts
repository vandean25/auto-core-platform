import { normalizeVehicleMakeAlias } from '../../catalog/vehicle-make-alias.util';
import { seedVehicleCatalogProviders } from '../seed-vehicle-catalog-providers';
import type { SeedPrismaClient, BrandContext } from './types';

export const DUAL_BRANDS = [
  'Volkswagen',
  'Audi',
  'BMW',
  'Mercedes-Benz',
  'Porsche',
];
export const PURE_VEHICLE_MAKES = ['Toyota', 'Ford', 'Skoda', 'Seat'];
export const PURE_PART_MANUFACTURERS = [
  'Bosch',
  'Mahle',
  'Mann-Filter',
  'Castrol',
  'NGK',
  'Valeo',
  'Hella',
  'Continental',
  'ZF',
];

export async function seedBrands(
  prisma: SeedPrismaClient,
  tenantId: string,
): Promise<BrandContext> {
  console.log('Seeding Brands...');

  // Dual Brands (Both Vehicle Make and Part Manufacturer)
  const dualBrandRecords = await Promise.all(
    DUAL_BRANDS.map((name) =>
      prisma.brand.create({
        data: {
          tenant_id: tenantId,
          name,
          normalized_name: normalizeVehicleMakeAlias(name),
          isVehicleMake: true,
          isPartManufacturer: true,
        },
      }),
    ),
  );

  // Pure Vehicle Makes
  const pureVehicleMakeRecords = await Promise.all(
    PURE_VEHICLE_MAKES.map((name) =>
      prisma.brand.create({
        data: {
          tenant_id: tenantId,
          name,
          normalized_name: normalizeVehicleMakeAlias(name),
          isVehicleMake: true,
          isPartManufacturer: false,
        },
      }),
    ),
  );

  // Pure Part Manufacturers
  const purePartManufacturerRecords = await Promise.all(
    PURE_PART_MANUFACTURERS.map((name) =>
      prisma.brand.create({
        data: {
          tenant_id: tenantId,
          name,
          normalized_name: normalizeVehicleMakeAlias(name),
          isVehicleMake: false,
          isPartManufacturer: true,
        },
      }),
    ),
  );

  const allBrands = [
    ...dualBrandRecords,
    ...pureVehicleMakeRecords,
    ...purePartManufacturerRecords,
  ];

  console.log('Seeding vehicle catalog providers (aliases, OEM concerns)...');
  const catalogSeedSummary = await seedVehicleCatalogProviders(
    prisma,
    tenantId,
  );
  console.log(
    `Vehicle catalog seed: ${catalogSeedSummary.brandsCreated} brands, ` +
      `${catalogSeedSummary.aliasesUpserted} aliases, ` +
      `${catalogSeedSummary.concernsUpserted} concerns, ` +
      `${catalogSeedSummary.concernMakesUpserted} concern-make links`,
  );

  return {
    dualBrandRecords,
    pureVehicleMakeRecords,
    purePartManufacturerRecords,
    allBrands,
  };
}

export async function seedVendors(
  prisma: SeedPrismaClient,
  tenantId: string,
  brands: BrandContext['allBrands'],
) {
  console.log('Seeding Vendors (one per brand)...');
  return Promise.all(
    brands.map((brand) =>
      prisma.vendor.create({
        data: {
          tenant_id: tenantId,
          name: `${brand.name} Parts Direct`,
          email: `sales@${brand.name.toLowerCase().replace(/\s+/g, '-')}-parts.com`,
          account_number: `VEND-${brand.name.substring(0, 3).toUpperCase()}`,
          supportedBrands: {
            connect: { id: brand.id },
          },
        },
      }),
    ),
  );
}
