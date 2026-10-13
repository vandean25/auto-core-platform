import {
  collectBlockersForCreditNote,
  collectBlockersForInvoice,
} from './accounting-export-candidates.js';
import {
  buildRzlAllocationRules,
  DATEV_ALLOCATION_RULES,
} from './accounting-export-allocation-rules.js';

const rzlRules = buildRzlAllocationRules({
  vat20: '20',
  vat13: '13',
  vat10: '10',
});

type TestLine = {
  id: string;
  gross: string;
  taxRate: string;
  revenueAccount?: string;
  countryIso?: 'AT' | 'DE';
  taxTreatment?: 'automatic' | 'manual_bu';
  buKey?: string | null;
};

function allocationFor(line: TestLine) {
  return {
    profileCode: 'ACP-RZL-AT-EUR-1',
    profileVersion: 1,
    sourceCategoryKey: 'manual_line',
    sourceCategoryLabel: 'Manual invoice lines',
    revenueAccount: line.revenueAccount ?? '8400',
    debtorAccount: '2000',
    taxMode: 'STANDARD',
    taxRate: line.taxRate,
    taxTreatment: line.taxTreatment ?? 'automatic',
    buKey: line.buKey ?? null,
    countryIso: line.countryIso ?? 'AT',
    currency: 'EUR',
  };
}

function snapshotItems(lines: TestLine[]) {
  return lines.map((line) => ({
    id: line.id,
    net: line.gross,
    tax: '0.00',
    gross: line.gross,
    accounting_allocation: allocationFor(line),
  }));
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
      items: snapshotItems(lines),
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

function creditFixture(lines: TestLine[]) {
  return {
    id: 'cn-1',
    credit_number: 'CN-2026-0001',
    snapshot: {
      schema_version: 2,
      document_kind: 'CREDIT_NOTE',
      tax_mode: 'STANDARD',
      date: '2026-01-20',
      original_document: { number: 'RE-2026-0001' },
      items: lines.map((line) => ({
        id: line.id,
        gross: line.gross,
        net: line.gross,
        tax: '0.00',
        accounting_allocation: allocationFor(line),
      })),
    },
  };
}

function blockerCodes(
  blockers: { code: string; message: string }[],
): string[] {
  return blockers.map((blocker) => blocker.code);
}

describe('accounting-export candidate blockers for the RZL profile', () => {
  it('passes configured AT standard-rate lines without blockers', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        { id: 'l-20', gross: '120.00', taxRate: '20.00' },
        { id: 'l-13', gross: '113.00', taxRate: '13.00' },
        { id: 'l-10', gross: '110.00', taxRate: '10.00' },
      ]),
      rzlRules,
    );

    expect(blockers).toEqual([]);
  });

  it('blocks DE allocations on the RZL profile with the RZL message', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        { id: 'l-de', gross: '119.00', taxRate: '19.00', countryIso: 'DE' },
      ]),
      rzlRules,
    );

    expect(blockerCodes(blockers)).toContain('UNSUPPORTED_EXPORT_COUNTRY');
    expect(blockers[0]?.message).toBe(
      'Only AT STANDARD VAT allocations can be exported with the RZL profile.',
    );
  });

  it('blocks non-zero zero-rate VAT lines', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([{ id: 'l-0', gross: '50.00', taxRate: '0.00' }]),
      rzlRules,
    );

    expect(blockerCodes(blockers)).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
  });

  it('does not block zero-gross zero-rate lines', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        { id: 'l-20', gross: '120.00', taxRate: '20.00' },
        { id: 'l-note', gross: '0.00', taxRate: '0.00' },
      ]),
      rzlRules,
    );

    expect(blockers).toEqual([]);
  });

  it('blocks rates without an RZL Steuercode', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([{ id: 'l-19', gross: '119.00', taxRate: '19.00' }]),
      rzlRules,
    );

    expect(blockerCodes(blockers)).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
  });

  it('blocks DATEV manual BU keys on RZL lines', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        {
          id: 'l-bu',
          gross: '120.00',
          taxRate: '20.00',
          taxTreatment: 'manual_bu',
          buKey: '9',
        },
      ]),
      rzlRules,
    );

    expect(blockerCodes(blockers)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
  });

  it('reports an unconfigured Steuercode as incomplete mapping', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([{ id: 'l-13', gross: '113.00', taxRate: '13.00' }]),
      buildRzlAllocationRules({ vat20: '20' }),
    );

    expect(blockerCodes(blockers)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
  });

  it('applies the same RZL rules to credit notes', () => {
    expect(
      collectBlockersForCreditNote(
        creditFixture([
          { id: 'c-20', gross: '120.00', taxRate: '20.00' },
          { id: 'c-0', gross: '0.00', taxRate: '0.00' },
        ]),
        rzlRules,
      ),
    ).toEqual([]);

    expect(
      blockerCodes(
        collectBlockersForCreditNote(
          creditFixture([{ id: 'c-0', gross: '5.00', taxRate: '0.00' }]),
          rzlRules,
        ),
      ),
    ).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
  });

  it('keeps DATEV rules: DE lines pass and AT lines keep the DATEV message', () => {
    expect(
      collectBlockersForInvoice(
        invoiceFixture([
          {
            id: 'de-1',
            gross: '119.00',
            taxRate: '19.00',
            countryIso: 'DE',
          },
        ]),
        DATEV_ALLOCATION_RULES,
      ),
    ).toEqual([]);

    const atBlockers = collectBlockersForInvoice(
      invoiceFixture([{ id: 'at-1', gross: '120.00', taxRate: '20.00' }]),
      DATEV_ALLOCATION_RULES,
    );
    expect(atBlockers[0]?.message).toBe(
      'Only DE domestic STANDARD VAT exports are enabled in slice 1.',
    );
  });

  it('blocks revenue accounts the RZL file cannot carry', () => {
    const blockers = collectBlockersForInvoice(
      invoiceFixture([
        {
          id: 'l-acc',
          gross: '120.00',
          taxRate: '20.00',
          revenueAccount: '8400;1',
        },
      ]),
      rzlRules,
    );

    expect(blockers).toEqual([
      expect.objectContaining({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message:
          'Revenue account 8400;1 cannot be written to an RZL file. Use plain text without ; or quotes.',
      }),
    ]);
  });

  it('applies the revenue account check to credit notes', () => {
    expect(
      blockerCodes(
        collectBlockersForCreditNote(
          creditFixture([
            {
              id: 'c-acc',
              gross: '5.00',
              taxRate: '20.00',
              revenueAccount: '"8400"',
            },
          ]),
          rzlRules,
        ),
      ),
    ).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
  });
});
