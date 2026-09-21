import { computeSellerReadiness } from '../../site/legal-entity-readiness.js';
import { DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS } from './demo-legal-entity-seller.fixture.js';
import { seedTenantFoundation } from './tenant-foundation.fixture.js';

describe('tenant-foundation.fixture', () => {
  it('creates tenant, legal entity, MAIN/GRZ sites, and system storage locations', async () => {
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
          ...DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS,
        }),
      },
      site: {
        create: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'site-main',
            tenant_id: 'tenant-1',
            legal_entity_id: 'le-1',
            code: 'MAIN',
            name: 'Vienna Workshop',
            timezone: 'Europe/Vienna',
            slot_minutes: 30,
            holiday_country_iso: 'AT',
            is_active: true,
          })
          .mockResolvedValueOnce({
            id: 'site-grz',
            tenant_id: 'tenant-1',
            legal_entity_id: 'le-1',
            code: 'GRZ',
            name: 'Graz Workshop',
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
    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        name: 'Default Workshop',
        country_iso: 'AT',
        is_active: true,
        ...DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS,
      },
    });
    expect(
      computeSellerReadiness({
        country_iso: 'AT',
        name: 'Default Workshop',
        address_line2: null,
        tax_number: null,
        iban: null,
        bic: null,
        bank_name: null,
        email: null,
        phone: null,
        registration_number: null,
        registration_court: null,
        representatives: null,
        ...DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS,
      }).isReady,
    ).toBe(true);
    expect(result.mainSite.code).toBe('MAIN');
    expect(result.grzSite.code).toBe('GRZ');
    expect(result.systemLocations).toHaveLength(2);
    expect(mockPrisma.storageLocation.createMany).toHaveBeenCalledTimes(2);
  });
});
