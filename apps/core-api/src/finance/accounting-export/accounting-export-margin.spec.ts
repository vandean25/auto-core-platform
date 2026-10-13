import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  buildManifestDocuments,
  loadAccountingExportCandidates,
} from './accounting-export-candidates.js';
import {
  allocationRulesForProfile,
  buildDatevAllocationRules,
  DATEV_ALLOCATION_RULES,
  type AccountingExportAllocationRules,
} from './accounting-export-allocation-rules.js';
import { marginSchemeAvailability } from './accounting-export-margin.js';
import type { AccountingExportCandidate } from './accounting-export.types.js';

const DATEV_CODE = 'ACP-DATEV-DE-EUR-1';
const RZL_CODE = 'ACP-RZL-AT-EUR-1';
const PERIOD_FROM = new Date('2026-03-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-03-31T00:00:00.000Z');

const marginEnabledRules = allocationRulesForProfile(DATEV_CODE, {
  marginScheme: { enabled: true, vatAccount: '1776' },
});

type LineFixture = {
  id: string;
  gross: string;
  countryIso?: 'AT' | 'DE';
};

function marginAllocation(line: LineFixture) {
  return {
    profileCode: line.countryIso === 'AT' ? RZL_CODE : DATEV_CODE,
    profileVersion: 1,
    sourceCategoryKey: 'vehicle_margin',
    sourceCategoryLabel: 'Vehicle margin scheme',
    revenueAccount: '8195',
    debtorAccount: '2000',
    taxMode: 'MARGIN_SCHEME',
    taxRate: '0.00',
    taxTreatment: 'automatic',
    buKey: null,
    countryIso: line.countryIso ?? 'DE',
    currency: 'EUR',
  };
}

function sumGross(lines: LineFixture[]): string {
  return lines.reduce((sum, line) => sum + Number(line.gross), 0).toFixed(2);
}

function marginSnapshot(
  lines: LineFixture[],
  margin: { margin_tax: string } | null,
) {
  return {
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
      accounting_allocation: marginAllocation(line),
    })),
    tax_breakdown: [],
    total_net: sumGross(lines),
    total_tax: '0.00',
    total_gross: sumGross(lines),
    snapshot_created_at: '2026-03-05T00:00:00.000Z',
    tax_mode: 'MARGIN_SCHEME',
    ...(margin
      ? {
          margin: {
            cost_basis: '0.00',
            margin_tax: margin.margin_tax,
            tax_rate: '19.00',
            calculation_profile: 'vehicle-margin-v1',
          },
        }
      : {}),
  };
}

function marginInvoice(
  overrides: {
    id?: string;
    lines?: LineFixture[];
    margin?: { margin_tax: string } | null;
    snapshot?: unknown;
  } = {},
) {
  const lines = overrides.lines ?? [{ id: 'item-1', gross: '12000.00' }];
  return {
    id: overrides.id ?? 'inv-margin',
    status: 'FINALIZED',
    invoice_number: 'RE-2026-0010',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    date: new Date('2026-03-10T00:00:00.000Z'),
    tax_mode: 'MARGIN_SCHEME',
    snapshot:
      overrides.snapshot ??
      marginSnapshot(
        lines,
        overrides.margin === undefined
          ? { margin_tax: '1000.00' }
          : overrides.margin,
      ),
    items: lines.map((line) => ({
      id: line.id,
      accounting_snapshot: marginAllocation(line),
    })),
  };
}

function marginCreditNote(overrides: { id?: string } = {}) {
  const line = { id: 'item-1', gross: '12000.00' };
  return {
    id: overrides.id ?? 'cn-margin',
    credit_number: 'CN-2026-0004',
    status: 'FINALIZED',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    date: new Date('2026-03-20T00:00:00.000Z'),
    snapshot: {
      schema_version: 2,
      document_kind: 'CREDIT_NOTE',
      tax_mode: 'MARGIN_SCHEME',
      date: '2026-03-20',
      credit_title: 'Stornorechnung',
      original_document: {
        id: 'inv-margin',
        number: 'RE-2026-0010',
        date: '2026-03-10',
        reason: 'Storno',
        snapshot_version: 2,
      },
      items: [
        {
          id: line.id,
          gross: line.gross,
          net: line.gross,
          tax: '0.00',
          accounting_allocation: marginAllocation(line),
        },
      ],
      margin: {
        cost_basis: '0.00',
        margin_tax: '1000.00',
        tax_rate: '19.00',
        calculation_profile: 'vehicle-margin-v1',
      },
    },
    items: [],
  };
}

function prismaWith(invoices: unknown[], creditNotes: unknown[] = []) {
  return {
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    creditNote: { findMany: jest.fn().mockResolvedValue(creditNotes) },
  } as unknown as PrismaService;
}

async function loadFor(
  rules: AccountingExportAllocationRules,
  invoices: unknown[],
  creditNotes: unknown[] = [],
): Promise<AccountingExportCandidate[]> {
  return loadAccountingExportCandidates(
    prismaWith(invoices, creditNotes),
    'tenant-1',
    'le-1',
    PERIOD_FROM,
    PERIOD_TO,
    rules,
  );
}

function codesOf(candidate: AccountingExportCandidate): string[] {
  return [...new Set(candidate.blockers.map((blocker) => blocker.code))].sort();
}

describe('accounting-export margin-scheme lift (AUT-369)', () => {
  it('keeps margin documents blocked while the margin scheme is not enabled', async () => {
    const [candidate] = await loadFor(DATEV_ALLOCATION_RULES, [
      marginInvoice(),
    ]);

    expect(codesOf(candidate)).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
    expect(candidate.blockers[0].message).toBe(
      'Margin-scheme invoices are not supported by the active export profile.',
    );
    expect(candidate.blockers.map((blocker) => blocker.message)).toContain(
      'Margin-scheme allocations cannot be exported with the active profile.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('exports an enabled margin document as a net sale row plus a margin VAT row', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [marginInvoice()]);

    expect(candidate.blockers).toEqual([]);
    expect(candidate.rows).toEqual([
      expect.objectContaining({
        documentId: 'inv-margin',
        lineId: 'item-1',
        polarity: 'S',
        net: '11000.00',
        tax: '0.00',
        taxRate: '0.00',
        gross: '11000.00',
        debtorAccount: '2000',
        revenueAccount: '8195',
        buKey: null,
      }),
      expect.objectContaining({
        documentId: 'inv-margin',
        lineId: 'item-1',
        polarity: 'S',
        net: '0.00',
        tax: '1000.00',
        taxRate: '0.00',
        gross: '1000.00',
        debtorAccount: '2000',
        revenueAccount: '1776',
        buKey: null,
      }),
    ]);
    const grossTotal = candidate.rows.reduce(
      (sum, row) => sum.plus(row.gross),
      new Prisma.Decimal(0),
    );
    expect(grossTotal.toFixed(2)).toBe('12000.00');
  });

  it('keeps the two rows exact to the cent when the margin VAT has cents', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [
      marginInvoice({
        lines: [{ id: 'item-1', gross: '1234.56' }],
        margin: { margin_tax: '123.45' },
      }),
    ]);

    expect(candidate.blockers).toEqual([]);
    expect(
      candidate.rows.map((row) => [row.revenueAccount, row.net, row.gross]),
    ).toEqual([
      ['8195', '1111.11', '1111.11'],
      ['1776', '0.00', '123.45'],
    ]);
  });

  it('lists a margin document line once in the manifest even though it books two rows', async () => {
    const candidates = await loadFor(marginEnabledRules, [marginInvoice()]);

    expect(buildManifestDocuments(candidates)[0].lineIds).toEqual(['item-1']);
  });

  it('blocks an enabled margin document when the margin VAT account is missing', async () => {
    // Stored params cannot reach this state (the parser requires the account), so build the rules directly.
    const rules = buildDatevAllocationRules({
      enabled: true,
      vatAccount: null,
    });
    const [candidate] = await loadFor(rules, [marginInvoice()]);

    expect(codesOf(candidate)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
    expect(candidate.blockers[0].message).toBe(
      'The margin VAT account is not configured for this export profile.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('blocks a multi-line margin document because the margin VAT is held per document', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [
      marginInvoice({
        lines: [
          { id: 'item-1', gross: '10000.00' },
          { id: 'item-2', gross: '2000.00' },
        ],
      }),
    ]);

    expect(codesOf(candidate)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
    expect(candidate.blockers[0].message).toBe(
      'Margin-scheme export supports one vehicle line per document.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('blocks an enabled margin document without frozen margin facts', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [
      marginInvoice({ margin: null }),
    ]);

    expect(codesOf(candidate)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
    expect(candidate.blockers[0].message).toBe(
      'Margin-scheme VAT facts are missing from the document snapshot.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('blocks an enabled margin document whose margin VAT exceeds its gross', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [
      marginInvoice({ margin: { margin_tax: '13000.00' } }),
    ]);

    expect(codesOf(candidate)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
    expect(candidate.blockers[0].message).toBe(
      'Margin-scheme VAT facts are inconsistent with the document total.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('keeps margin documents blocked on the RZL profile even when the margin scheme is set', async () => {
    const rules = allocationRulesForProfile(RZL_CODE, {
      marginScheme: { enabled: true, vatAccount: '1776' },
    });
    const [candidate] = await loadFor(rules, [
      marginInvoice({
        lines: [{ id: 'item-1', gross: '12000.00', countryIso: 'AT' }],
      }),
    ]);

    expect(codesOf(candidate)).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
    expect(candidate.rows).toEqual([]);
  });

  it('keeps legacy (version 1) margin documents blocked even when the margin scheme is enabled', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [
      marginInvoice({
        snapshot: { schema_version: 1, tax_mode: 'MARGIN_SCHEME' },
      }),
    ]);

    expect(codesOf(candidate)).toEqual(['LEGACY_DOCUMENT_UNSUPPORTED']);
    expect(candidate.rows).toEqual([]);
  });

  it('keeps a standard document with a margin allocation blocked', async () => {
    const standard = marginInvoice();
    const [candidate] = await loadFor(marginEnabledRules, [
      {
        ...standard,
        tax_mode: 'STANDARD',
        snapshot: { ...standard.snapshot, tax_mode: 'STANDARD' },
      },
    ]);

    expect(codesOf(candidate)).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
    expect(candidate.rows).toEqual([]);
  });

  it('blocks a margin document whose line carries a standard allocation', async () => {
    const standardAllocation = {
      ...marginAllocation({ id: 'item-1', gross: '12000.00' }),
      sourceCategoryKey: 'revenue_group:1',
      sourceCategoryLabel: 'Workshop labour',
      revenueAccount: '8400',
      taxMode: 'STANDARD',
      taxRate: '20.00',
    };
    const invoice = marginInvoice();
    const [candidate] = await loadFor(marginEnabledRules, [
      {
        ...invoice,
        items: [{ id: 'item-1', accounting_snapshot: standardAllocation }],
      },
    ]);

    expect(codesOf(candidate)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
    expect(candidate.blockers[0].message).toBe(
      'Margin-scheme document line has no margin accounting allocation.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('blocks a margin line that carries a manual BU key', async () => {
    const manualBuAllocation = {
      ...marginAllocation({ id: 'item-1', gross: '12000.00' }),
      taxTreatment: 'manual_bu',
      buKey: '9',
    };
    const invoice = marginInvoice();
    const [candidate] = await loadFor(marginEnabledRules, [
      {
        ...invoice,
        items: [{ id: 'item-1', accounting_snapshot: manualBuAllocation }],
      },
    ]);

    expect(codesOf(candidate)).toEqual(['ACCOUNTING_MAPPING_INCOMPLETE']);
    expect(candidate.blockers[0].message).toBe(
      'Manual BU keys are not used for margin-scheme documents.',
    );
    expect(candidate.rows).toEqual([]);
  });

  it('books only the margin VAT row when the margin VAT equals the gross', async () => {
    const [candidate] = await loadFor(marginEnabledRules, [
      marginInvoice({ margin: { margin_tax: '12000.00' } }),
    ]);

    expect(candidate.blockers).toEqual([]);
    expect(
      candidate.rows.map((row) => [row.revenueAccount, row.gross]),
    ).toEqual([['1776', '12000.00']]);
  });

  it('names the credit wording when a margin credit is blocked by the default profile', async () => {
    const [candidate] = await loadFor(
      DATEV_ALLOCATION_RULES,
      [],
      [marginCreditNote()],
    );

    expect(candidate.blockers.map((blocker) => blocker.message)).toContain(
      'Margin-scheme credits are not supported by the active export profile.',
    );
  });

  it('applies the same lift to a full credit of a margin document', async () => {
    const [candidate] = await loadFor(
      marginEnabledRules,
      [],
      [marginCreditNote()],
    );

    expect(candidate.blockers).toEqual([]);
    expect(candidate.rows).toEqual([
      expect.objectContaining({
        polarity: 'H',
        net: '11000.00',
        gross: '11000.00',
        revenueAccount: '8195',
        buKey: null,
        originalInvoiceNumber: 'RE-2026-0010',
      }),
      expect.objectContaining({
        polarity: 'H',
        tax: '1000.00',
        gross: '1000.00',
        revenueAccount: '1776',
        buKey: null,
        originalInvoiceNumber: 'RE-2026-0010',
      }),
    ]);
  });

  it('keeps credits of margin documents blocked while the margin scheme is not enabled', async () => {
    const [candidate] = await loadFor(
      DATEV_ALLOCATION_RULES,
      [],
      [marginCreditNote()],
    );

    expect(codesOf(candidate)).toEqual(['UNSUPPORTED_EXPORT_TAX_MODE']);
    expect(candidate.rows).toEqual([]);
  });
});

describe('marginSchemeAvailability', () => {
  it('reports the three states the candidate builder branches on', () => {
    expect(marginSchemeAvailability(DATEV_ALLOCATION_RULES)).toBe(
      'NOT_ENABLED',
    );
    expect(marginSchemeAvailability(marginEnabledRules)).toBe('AVAILABLE');
    expect(
      marginSchemeAvailability(
        buildDatevAllocationRules({ enabled: true, vatAccount: null }),
      ),
    ).toBe('VAT_ACCOUNT_MISSING');
  });
});

describe('allocationRulesForProfile margin scheme', () => {
  it('leaves the margin scheme disabled by default on DATEV and RZL', () => {
    expect(DATEV_ALLOCATION_RULES.marginScheme).toEqual({
      enabled: false,
      vatAccount: null,
    });
    expect(allocationRulesForProfile(DATEV_CODE, null).marginScheme).toEqual({
      enabled: false,
      vatAccount: null,
    });
  });

  it('reads the DATEV margin setting from the stored serializer params', () => {
    expect(marginEnabledRules.marginScheme).toEqual({
      enabled: true,
      vatAccount: '1776',
    });
  });

  it('never enables the margin scheme on the RZL profile', () => {
    expect(
      allocationRulesForProfile(RZL_CODE, {
        marginScheme: { enabled: true, vatAccount: '1776' },
      }).marginScheme.enabled,
    ).toBe(false);
  });
});
