import { seedTenantFoundation } from './tenant-foundation.fixture';

describe('tenant-foundation.fixture', () => {
  it('creates tenant, legal entity, main site, and system storage locations', async () => {
    const mockPrisma: any = {
      tenant: {
        upsert: jest.fn().mockResolvedValue({
          id: 'tenant-1',
          name: 'Default Workshop',
          slug: 'default-workshop',
          plan: 'STANDARD',
        }),
      },
      legalEntity: {
        create: jest.fn().mockResolvedValue({
          id: 'le-1',
          tenant_id: 'tenant-1',
          name: 'Default Workshop',
          country_iso: 'AT',
          is_active: true,
        }),
      },
      site: {
        create: jest.fn().mockResolvedValue({
          id: 'site-1',
          tenant_id: 'tenant-1',
          legal_entity_id: 'le-1',
          code: 'MAIN',
          name: 'Default Workshop',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        }),
      },
      storageLocation: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'loc-1', code: 'TRANSIT' },
          { id: 'loc-2', code: 'LOT' },
        ]),
      },
    };

    const result = await seedTenantFoundation(mockPrisma);

    expect(result.defaultTenant.slug).toBe('default-workshop');
    expect(result.defaultLegalEntity.country_iso).toBe('AT');
    expect(result.mainSite.code).toBe('MAIN');
    expect(result.systemLocations).toHaveLength(2);
    expect(mockPrisma.storageLocation.createMany).toHaveBeenCalledTimes(1);
  });
});
