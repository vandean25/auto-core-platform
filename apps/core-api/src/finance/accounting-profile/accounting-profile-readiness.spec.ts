import { computeAccountingProfileReadiness } from './accounting-profile-readiness.js';
import type { AccountingMappingRule } from './accounting-profile.types.js';

const baseRule = (
  overrides: Partial<AccountingMappingRule> = {},
): AccountingMappingRule => ({
  sourceCategoryKey: 'revenue_group:1',
  sourceCategoryLabel: 'Parts',
  taxMode: 'STANDARD',
  taxRate: '20.00',
  revenueAccount: '4000',
  taxTreatment: 'automatic',
  buKey: null,
  ...overrides,
});

describe('accounting-profile-readiness', () => {
  it('marks a fully mapped profile as ready', () => {
    const readiness = computeAccountingProfileReadiness({
      countryIso: 'DE',
      advisorNumber: '12345',
      clientNumber: '1',
      accountLength: 4,
      defaultDebtorAccount: '10000',
      mappingRules: [
        baseRule(),
        baseRule({
          sourceCategoryKey: 'labor',
          sourceCategoryLabel: 'Labor',
        }),
        baseRule({
          sourceCategoryKey: 'manual_line',
          sourceCategoryLabel: 'Manual',
        }),
        baseRule({
          sourceCategoryKey: 'vehicle_margin',
          sourceCategoryLabel: 'Margin',
          taxMode: 'MARGIN_SCHEME',
          taxRate: '0.00',
        }),
      ],
      requiredSourceCategories: [
        {
          key: 'revenue_group:1',
          label: 'Parts',
          taxMode: 'STANDARD',
          taxRate: '20.00',
        },
        {
          key: 'labor',
          label: 'Labor',
          taxMode: 'STANDARD',
          taxRate: '20.00',
        },
        {
          key: 'manual_line',
          label: 'Manual',
          taxMode: 'STANDARD',
          taxRate: '20.00',
        },
        {
          key: 'vehicle_margin',
          label: 'Margin',
          taxMode: 'MARGIN_SCHEME',
          taxRate: '0.00',
        },
      ],
    });

    expect(readiness.isReady).toBe(true);
    expect(readiness.missingFields).toEqual([]);
    expect(readiness.unmappedCategories).toEqual([]);
  });

  it('reports missing profile fields and unmapped categories', () => {
    const readiness = computeAccountingProfileReadiness({
      countryIso: 'DE',
      advisorNumber: null,
      clientNumber: null,
      accountLength: null,
      defaultDebtorAccount: null,
      mappingRules: [],
      requiredSourceCategories: [
        {
          key: 'labor',
          label: 'Labor',
          taxMode: 'STANDARD',
          taxRate: '20.00',
        },
      ],
    });

    expect(readiness.isReady).toBe(false);
    expect(readiness.missingFields).toEqual([
      'advisor_number',
      'client_number',
      'account_length',
      'default_debtor_account',
      'mapping_rules',
    ]);
    expect(readiness.unmappedCategories).toEqual(['labor']);
  });

  it('requires manual_bu rules to include a BU key', () => {
    const readiness = computeAccountingProfileReadiness({
      countryIso: 'DE',
      advisorNumber: '12345',
      clientNumber: '1',
      accountLength: 4,
      defaultDebtorAccount: '10000',
      mappingRules: [
        baseRule({
          sourceCategoryKey: 'labor',
          sourceCategoryLabel: 'Labor',
          taxTreatment: 'manual_bu',
          buKey: null,
        }),
      ],
      requiredSourceCategories: [
        {
          key: 'labor',
          label: 'Labor',
          taxMode: 'STANDARD',
          taxRate: '20.00',
        },
      ],
    });

    expect(readiness.isReady).toBe(false);
    expect(readiness.unmappedCategories).toEqual(['labor']);
  });
});
