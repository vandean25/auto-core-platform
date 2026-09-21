import { resolveAccountingAllocation } from '../../finance/accounting-profile/accounting-profile.resolver.js';
import { FIXED_SOURCE_CATEGORY_KEYS } from '../../finance/accounting-profile/accounting-profile.types.js';
import {
  DEMO_WORKSHOP_ACCOUNTING_PROFILE_DEFAULTS,
  buildDemoWorkshopAccountingMappingRules,
  seedDemoWorkshopAccountingProfile,
} from './demo-legal-entity-accounting-profile.fixture.js';

const demoRevenueGroups = [
  {
    id: 1,
    name: 'Parts / Goods 20%',
    tax_rate: { toString: () => '20' },
    account_number: '4000',
  },
  {
    id: 2,
    name: 'Services / Labor 20%',
    tax_rate: { toString: () => '20' },
    account_number: '4001',
  },
  {
    id: 3,
    name: 'Tax Free / Margin',
    tax_rate: { toString: () => '0' },
    account_number: '4099',
  },
];

describe('demo-legal-entity-accounting-profile.fixture', () => {
  it('builds mapping rules that satisfy finalize allocation paths', () => {
    const mappingRules = buildDemoWorkshopAccountingMappingRules(
      demoRevenueGroups as never,
    );
    const profile = {
      id: 'profile-1',
      tenant_id: 'tenant-1',
      legal_entity_id: 'le-1',
      version: 1,
      mapping_rules: mappingRules,
      ...DEMO_WORKSHOP_ACCOUNTING_PROFILE_DEFAULTS,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(
      resolveAccountingAllocation(profile, 'AT', {
        sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE,
        sourceCategoryLabel: 'Manual invoice lines',
        taxMode: 'STANDARD',
        taxRate: '20.00',
      }),
    ).not.toBeNull();

    expect(
      resolveAccountingAllocation(profile, 'AT', {
        sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
        sourceCategoryLabel: 'Labor / workshop services',
        taxMode: 'STANDARD',
        taxRate: '20.00',
      }),
    ).not.toBeNull();

    expect(
      resolveAccountingAllocation(profile, 'AT', {
        sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
        sourceCategoryLabel: 'Vehicle margin scheme',
        taxMode: 'MARGIN_SCHEME',
        taxRate: '0.00',
      }),
    ).not.toBeNull();

    expect(
      resolveAccountingAllocation(profile, 'AT', {
        sourceCategoryKey: 'revenue_group:1',
        sourceCategoryLabel: 'Parts / Goods 20%',
        taxMode: 'STANDARD',
        taxRate: '20.00',
        revenueGroupId: 1,
      }),
    ).not.toBeNull();

    for (const group of demoRevenueGroups) {
      const taxRate = Number.parseFloat(group.tax_rate.toString()).toFixed(2);
      expect(
        resolveAccountingAllocation(profile, 'AT', {
          sourceCategoryKey: `revenue_group:${group.id}`,
          sourceCategoryLabel: group.name,
          taxMode: 'STANDARD',
          taxRate,
          revenueGroupId: group.id,
        }),
      ).not.toBeNull();
    }
  });

  it('seeds a disabled accounting profile for the default workshop legal entity', async () => {
    const mappingRules = buildDemoWorkshopAccountingMappingRules(
      demoRevenueGroups as never,
    );
    const upsert = jest.fn().mockResolvedValue({
      id: 'profile-1',
      is_enabled: false,
      mapping_rules: mappingRules,
    });

    await seedDemoWorkshopAccountingProfile(
      { legalEntityAccountingProfile: { upsert } } as never,
      'tenant-1',
      'le-1',
      demoRevenueGroups as never,
    );

    expect(upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_legal_entity_id: {
          tenant_id: 'tenant-1',
          legal_entity_id: 'le-1',
        },
      },
      update: expect.objectContaining({
        is_enabled: false,
        mapping_rules: mappingRules,
      }),
      create: expect.objectContaining({
        tenant_id: 'tenant-1',
        legal_entity_id: 'le-1',
        is_enabled: false,
        mapping_rules: mappingRules,
      }),
    });
  });
});
