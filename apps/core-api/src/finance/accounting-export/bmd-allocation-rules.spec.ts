import type { ResolvedAccountingAllocation } from '../accounting-profile/accounting-profile.types.js';
import {
  allocationRulesForProfile,
  buildBmdAllocationRules,
} from './accounting-export-allocation-rules.js';
import { collectBlockersForInvoice } from './accounting-export-candidates.js';

const steuercodes = { vat20: '5020', vat13: '5013', vat10: '5010' };
const bmdRules = buildBmdAllocationRules(steuercodes);

type TestLine = {
  id: string;
  gross: string;
  taxRate: string;
  countryIso?: 'AT' | 'DE';
  taxTreatment?: 'automatic' | 'manual_bu';
  buKey?: string | null;
};

function allocationFor(line: TestLine): ResolvedAccountingAllocation {
  return {
    profileCode: 'ACP-BMD-AT-EUR-1',
    profileVersion: 3,
    sourceCategoryKey: 'manual_line',
    sourceCategoryLabel: 'Manual invoice lines',
    revenueAccount: '8400',
    debtorAccount: '2000',
    taxMode: 'STANDARD',
    taxRate: line.taxRate,
    taxTreatment: line.taxTreatment ?? 'automatic',
    buKey: line.buKey ?? null,
    countryIso: line.countryIso ?? 'AT',
    currency: 'EUR',
  };
}

function invoiceFixture(lines: TestLine[]) {
  return {
    id: 'inv-1',
    status: 'FINALIZED' as const,
    invoice_number: 'RE-2026-0001',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    tax_mode: 'STANDARD' as const,
    snapshot: {
      schema_version: 2,
      document_kind: 'INVOICE',
      site_id: 'site-1',
      legal_entity_id: 'le-1',
      currency: 'EUR',
      seller: { name: 'Seller GmbH' },
      items: lines.map((line) => ({
        id: line.id,
        net: line.gross,
        tax: '0.00',
        gross: line.gross,
        accounting_allocation: allocationFor(line),
      })),
      tax_breakdown: [],
      total_net: '0.00',
      total_tax: '0.00',
      total_gross: '0.00',
      snapshot_created_at: '2026-01-10T00:00:00.000Z',
      tax_mode: 'STANDARD',
    },
    items: lines.map((line) => ({
      id: line.id,
      accounting_snapshot: allocationFor(line),
    })),
  };
}

describe('BMD allocation rules', () => {
  it('selects the BMD rules for the BMD profile code and reads its tax keys', () => {
    const rules = allocationRulesForProfile('ACP-BMD-AT-EUR-1', {
      bmd: { steuercodes },
    });

    expect(rules.countryIso).toBe('AT');
    expect(rules.allowManualBu).toBe(false);
    expect(rules.taxRateIssue('20.00')).toBeNull();
  });

  it('accepts 20, 13 and 10 percent when their tax keys are configured', () => {
    for (const rate of ['20.00', '13.00', '10.00']) {
      expect(bmdRules.taxRateIssue(rate)).toBeNull();
    }
  });

  it('blocks a rate whose tax key is not configured', () => {
    expect(
      buildBmdAllocationRules({ vat13: '5013' }).taxRateIssue('20.00'),
    ).toEqual({
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message: 'The BMD Steuercode for 20% VAT is not configured.',
    });
  });

  it('blocks zero-rate VAT, which has no approved BMD tax key', () => {
    expect(bmdRules.taxRateIssue('0.00')).toMatchObject({
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
    });
  });

  it('blocks any other rate', () => {
    expect(bmdRules.taxRateIssue('5.00')).toMatchObject({
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
    });
  });

  it('blocks revenue or debtor accounts the file cannot carry', () => {
    const allocation = allocationFor({ id: 'l1', gross: '1.00', taxRate: '20.00' });

    expect(
      bmdRules.allocationIssue?.({ ...allocation, revenueAccount: 'Erlöse' }),
    ).toMatchObject({ code: 'ACCOUNTING_MAPPING_INCOMPLETE' });
    expect(
      bmdRules.allocationIssue?.({ ...allocation, debtorAccount: '2000;1' }),
    ).toMatchObject({ code: 'ACCOUNTING_MAPPING_INCOMPLETE' });
    expect(bmdRules.allocationIssue?.(allocation)).toBeNull();
  });

  it('blocks manual BU keys with the BMD wording', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        { id: 'l1', gross: '120.00', taxRate: '20.00', taxTreatment: 'manual_bu', buKey: '9' },
      ]),
      bmdRules,
    );

    expect(blockers).toContainEqual(
      expect.objectContaining({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message:
          'Manual BU keys are not used by the BMD profile. Use automatic tax treatment.',
      }),
    );
  });

  it('blocks a DE allocation with the BMD country wording', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        { id: 'l1', gross: '120.00', taxRate: '20.00', countryIso: 'DE' },
      ]),
      bmdRules,
    );

    expect(blockers).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_EXPORT_COUNTRY',
        message:
          'Only AT STANDARD VAT allocations can be exported with the BMD profile.',
      }),
    );
  });

  it('ignores a zero-rate line with zero gross', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([{ id: 'l1', gross: '0.00', taxRate: '0.00' }]),
      bmdRules,
    );

    expect(blockers).toEqual([]);
  });

  it('blocks a zero-rate line with non-zero gross', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([{ id: 'l1', gross: '50.00', taxRate: '0.00' }]),
      bmdRules,
    );

    expect(blockers).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_EXPORT_TAX_MODE' }),
    );
  });
});
