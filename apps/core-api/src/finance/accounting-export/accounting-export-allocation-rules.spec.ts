import {
  allocationRulesForProfile,
  buildRzlAllocationRules,
  DATEV_ALLOCATION_RULES,
} from './accounting-export-allocation-rules.js';
import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';

const fullSteuercodes = { vat20: '20', vat13: '13', vat10: '10' };

function allocation(
  overrides: Partial<ResolvedAccountingAllocation> = {},
): ResolvedAccountingAllocation {
  return {
    revenueAccount: '8400',
    debtorAccount: '2000',
    ...overrides,
  } as ResolvedAccountingAllocation;
}

describe('accounting-export allocation rules', () => {
  it('keeps the DATEV rules: DE country, manual BU allowed, any rate accepted', () => {
    expect(DATEV_ALLOCATION_RULES.countryIso).toBe('DE');
    expect(DATEV_ALLOCATION_RULES.allowManualBu).toBe(true);
    expect(DATEV_ALLOCATION_RULES.unsupportedCountryMessage).toBe(
      'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
    );
    expect(DATEV_ALLOCATION_RULES.taxRateIssue('19.00')).toBeNull();
  });

  it('uses DATEV rules for null and unknown profile codes', () => {
    expect(allocationRulesForProfile(null, {})).toBe(DATEV_ALLOCATION_RULES);
    expect(
      allocationRulesForProfile('ACP-DATEV-DE-EUR-1', {}),
    ).toBe(DATEV_ALLOCATION_RULES);
  });

  it('accepts the configured standard RZL rates', () => {
    const rules = buildRzlAllocationRules(fullSteuercodes);

    expect(rules.countryIso).toBe('AT');
    expect(rules.allowManualBu).toBe(false);
    expect(rules.taxRateIssue('20.00')).toBeNull();
    expect(rules.taxRateIssue('13.00')).toBeNull();
    expect(rules.taxRateIssue('10')).toBeNull();
  });

  it('blocks zero-rate VAT with an explicit deferral reason', () => {
    const issue = buildRzlAllocationRules(fullSteuercodes).taxRateIssue('0.00');

    expect(issue).toEqual({
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
      message: expect.stringContaining('Zero-rate VAT has no approved RZL Steuercode'),
    });
  });

  it('blocks rates without an RZL Steuercode mapping', () => {
    expect(
      buildRzlAllocationRules(fullSteuercodes).taxRateIssue('19.00'),
    ).toEqual({
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
      message: 'VAT rate 19.00% has no RZL Steuercode in this profile version.',
    });
  });

  it('reports an unconfigured Steuercode as an incomplete mapping', () => {
    const issue = buildRzlAllocationRules({ vat20: '20' }).taxRateIssue('13.00');

    expect(issue).toEqual({
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message: 'The RZL Steuercode for 13.00% VAT is not configured.',
    });
  });

  it('treats a blank configured Steuercode as missing', () => {
    expect(
      buildRzlAllocationRules({ vat20: '   ' }).taxRateIssue('20.00'),
    ).toMatchObject({ code: 'ACCOUNTING_MAPPING_INCOMPLETE' });
  });

  it('reads RZL Steuercodes from stored serializer params', () => {
    const rules = allocationRulesForProfile('ACP-RZL-AT-EUR-1', {
      rzl: { firmNumber: 'FN-1', steuercodes: fullSteuercodes },
    });

    expect(rules.countryIso).toBe('AT');
    expect(rules.taxRateIssue('10.00')).toBeNull();
  });

  it('accepts plain revenue and debtor accounts on RZL lines', () => {
    expect(
      buildRzlAllocationRules(fullSteuercodes).allocationIssue?.(allocation()),
    ).toBeNull();
  });

  it('blocks revenue and debtor accounts the RZL file cannot carry', () => {
    const rules = buildRzlAllocationRules(fullSteuercodes);

    expect(
      rules.allocationIssue?.(allocation({ revenueAccount: '8400;1' })),
    ).toEqual({
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message:
        'Revenue account 8400;1 cannot be written to an RZL file. Use plain text without ; or quotes.',
    });
    expect(
      rules.allocationIssue?.(allocation({ debtorAccount: '"2000"' })),
    ).toEqual({
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message:
        'Debtor account "2000" cannot be written to an RZL file. Use plain text without ; or quotes.',
    });
  });

  it('leaves DATEV rules without an allocation check', () => {
    expect(DATEV_ALLOCATION_RULES.allocationIssue).toBeUndefined();
  });
});
