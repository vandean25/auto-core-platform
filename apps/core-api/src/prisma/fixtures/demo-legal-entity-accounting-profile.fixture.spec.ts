import { resolveAccountingAllocation } from '../../finance/accounting-profile/accounting-profile.resolver.js';
import {
  FIXED_SOURCE_CATEGORY_KEYS,
  revenueGroupSourceCategoryKey,
} from '../../finance/accounting-profile/accounting-profile.types.js';
import { DEMO_WORKSHOP_REVENUE_GROUP_SPECS } from './demo-workshop-revenue-groups.fixture.js';
import {
  DEMO_WORKSHOP_ACCOUNTING_PROFILE_DEFAULTS,
  buildDemoWorkshopAccountingMappingRules,
  seedDemoWorkshopAccountingProfile,
} from './demo-legal-entity-accounting-profile.fixture.js';

function demoRevenueGroupsWithIds(ids: number[]) {
  return ids.map((id, index) => ({
    id,
    name: DEMO_WORKSHOP_REVENUE_GROUP_SPECS[index].name,
    tax_rate: { toString: () => String(DEMO_WORKSHOP_REVENUE_GROUP_SPECS[index].tax_rate) },
    account_number: DEMO_WORKSHOP_REVENUE_GROUP_SPECS[index].account_number,
  }));
}

/** Typical live UAT ids after wipe+reseed when the revenue_groups sequence has advanced. */
const liveUatRevenueGroups = demoRevenueGroupsWithIds([4, 5, 6]);

describe('demo-legal-entity-accounting-profile.fixture', () => {
  it('includes fixed and revenue_group mappings for catalog finalize (live UAT ids 4–6)', () => {
    const mappingRules = buildDemoWorkshopAccountingMappingRules(
      liveUatRevenueGroups as never,
    );
    const keys = mappingRules.map((rule) => rule.sourceCategoryKey);

    expect(keys).toEqual(
      expect.arrayContaining([
        FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE,
        FIXED_SOURCE_CATEGORY_KEYS.LABOR,
        FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
        revenueGroupSourceCategoryKey(4),
        revenueGroupSourceCategoryKey(5),
        revenueGroupSourceCategoryKey(6),
      ]),
    );
    expect(mappingRules).toHaveLength(6);

    const partsRule = mappingRules.find(
      (rule) => rule.sourceCategoryKey === revenueGroupSourceCategoryKey(4),
    );
    expect(partsRule).toMatchObject({
      sourceCategoryLabel: 'Parts / Goods 20%',
      taxMode: 'STANDARD',
      taxRate: '20.00',
      revenueAccount: '4000',
    });

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
        sourceCategoryKey: revenueGroupSourceCategoryKey(4),
        sourceCategoryLabel: 'Parts / Goods 20%',
        taxMode: 'STANDARD',
        taxRate: '20.00',
        revenueGroupId: 4,
      }),
    ).not.toBeNull();

    for (const group of liveUatRevenueGroups) {
      const taxRate = Number.parseFloat(group.tax_rate.toString()).toFixed(2);
      expect(
        resolveAccountingAllocation(profile, 'AT', {
          sourceCategoryKey: revenueGroupSourceCategoryKey(group.id),
          sourceCategoryLabel: group.name,
          taxMode: 'STANDARD',
          taxRate,
          revenueGroupId: group.id,
        }),
      ).not.toBeNull();
    }
  });

  it('seeds a disabled accounting profile with revenue_group rules from finance seed', async () => {
    const mappingRules = buildDemoWorkshopAccountingMappingRules(
      liveUatRevenueGroups as never,
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
      liveUatRevenueGroups as never,
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
        mapping_rules: expect.arrayContaining([
          expect.objectContaining({
            sourceCategoryKey: revenueGroupSourceCategoryKey(4),
            revenueAccount: '4000',
          }),
          expect.objectContaining({
            sourceCategoryKey: revenueGroupSourceCategoryKey(5),
            revenueAccount: '4001',
          }),
          expect.objectContaining({
            sourceCategoryKey: revenueGroupSourceCategoryKey(6),
            revenueAccount: '4099',
          }),
        ]),
      }),
      create: expect.objectContaining({
        tenant_id: 'tenant-1',
        legal_entity_id: 'le-1',
        is_enabled: false,
      }),
    });
  });
});
