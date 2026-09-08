import { seedBrands, seedVendors } from './brand.fixture';

jest.mock('../seed-vehicle-catalog-providers', () => ({
  seedVehicleCatalogProviders: jest.fn().mockResolvedValue({
    brandsCreated: 2,
    aliasesUpserted: 3,
    concernsUpserted: 1,
    concernMakesUpserted: 2,
  }),
}));

describe('brand.fixture', () => {
  it('creates dual, vehicle, and part brands with normalized names', async () => {
    const createdBrands: any[] = [];
    const mockPrisma: any = {
      brand: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const record = { id: createdBrands.length + 1, ...data };
          createdBrands.push(record);
          return record;
        }),
      },
    };

    const result = await seedBrands(mockPrisma, 'tenant-1');

    expect(result.dualBrandRecords).toHaveLength(5);
    expect(result.pureVehicleMakeRecords).toHaveLength(4);
    expect(result.purePartManufacturerRecords).toHaveLength(9);
    expect(result.allBrands).toHaveLength(18);

    // Ensure normalized_name is populated
    expect(createdBrands[0].normalized_name).toBeDefined();
    expect(createdBrands[0].tenant_id).toBe('tenant-1');
  });

  it('creates vendors connected to each brand', async () => {
    const createdVendors: any[] = [];
    const mockPrisma: any = {
      vendor: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          createdVendors.push(data);
          return { id: `vend-${createdVendors.length}`, ...data };
        }),
      },
    };

    const brands = [
      { id: 1, name: 'Bosch' },
      { id: 2, name: 'Volkswagen' },
    ];

    const result = await seedVendors(mockPrisma, 'tenant-1', brands as any);

    expect(result).toHaveLength(2);
    expect(createdVendors[0].name).toBe('Bosch Parts Direct');
    expect(createdVendors[0].account_number).toBe('VEND-BOS');
    expect(createdVendors[0].supportedBrands.connect.id).toBe(1);
    expect(createdVendors[1].account_number).toBe('VEND-VOL');
  });
});
