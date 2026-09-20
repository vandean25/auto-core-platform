import type { LegalEntityAccountingProfile } from '@prisma/client';
import { resolveAccountingAllocation } from './accounting-profile.resolver.js';

const baseProfile = (
  overrides: Partial<LegalEntityAccountingProfile> = {},
): LegalEntityAccountingProfile => ({
  id: 'profile-1',
  tenant_id: 'tenant-1',
  legal_entity_id: 'entity-1',
  version: 1,
  is_enabled: false,
  profile_code: 'ACP-DATEV-DE-EUR-1',
  format_version: 'EXTF-700-Buchungsstapel-13',
  chart: null,
  account_length: 4,
  advisor_number: '12345',
  client_number: '1',
  fiscal_year_start_month: 1,
  default_debtor_account: '10000',
  mapping_rules: [
    {
      sourceCategoryKey: 'revenue_group:1',
      sourceCategoryLabel: 'Parts',
      taxMode: 'STANDARD',
      taxRate: '20.00',
      revenueAccount: '4000',
      taxTreatment: 'automatic',
      buKey: null,
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('accounting-profile.resolver', () => {
  it('resolves a mapped revenue group allocation', () => {
    const allocation = resolveAccountingAllocation(
      baseProfile(),
      'DE',
      {
        sourceCategoryKey: 'revenue_group:1',
        sourceCategoryLabel: 'Parts',
        taxMode: 'STANDARD',
        taxRate: '20.00',
        revenueGroupId: 1,
      },
    );

    expect(allocation).toEqual({
      profileCode: 'ACP-DATEV-DE-EUR-1',
      profileVersion: 1,
      sourceCategoryKey: 'revenue_group:1',
      sourceCategoryLabel: 'Parts',
      revenueAccount: '4000',
      debtorAccount: '10000',
      taxMode: 'STANDARD',
      taxRate: '20.00',
      taxTreatment: 'automatic',
      buKey: null,
      countryIso: 'DE',
      currency: 'EUR',
    });
  });

  it('returns null when mapping is missing', () => {
    const allocation = resolveAccountingAllocation(
      baseProfile(),
      'DE',
      {
        sourceCategoryKey: 'labor',
        sourceCategoryLabel: 'Labor',
        taxMode: 'STANDARD',
        taxRate: '20.00',
      },
    );

    expect(allocation).toBeNull();
  });
});
