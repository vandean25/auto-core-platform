import type { PrismaService } from '../../prisma/prisma.service.js';
import { loadAccountingExportCandidates } from './accounting-export-candidates.js';
import {
  allocationRulesForProfile,
  DATEV_ALLOCATION_RULES,
  type AccountingExportAllocationRules,
} from './accounting-export-allocation-rules.js';
import type { AccountingExportCandidate } from './accounting-export.types.js';

/**
 * One closed period holding every document class ADR-0023 distinguishes:
 * legacy version 1, version 2 DE and AT, standard and margin-scheme, plus a DE
 * credit. Each profile state must block exactly the documents it should.
 */

const DATEV_CODE = 'ACP-DATEV-DE-EUR-1';
const RZL_CODE = 'ACP-RZL-AT-EUR-1';
const PERIOD_FROM = new Date('2026-03-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-03-31T00:00:00.000Z');

const RZL_STEUERCODES = {
  rzl: { steuercodes: { vat20: '20', vat13: '13', vat10: '10' } },
};

type Country = 'AT' | 'DE';

function allocation(country: Country, taxMode: 'STANDARD' | 'MARGIN_SCHEME') {
  const margin = taxMode === 'MARGIN_SCHEME';
  return {
    profileCode: country === 'AT' ? RZL_CODE : DATEV_CODE,
    profileVersion: 1,
    sourceCategoryKey: margin ? 'vehicle_margin' : 'revenue_group:1',
    sourceCategoryLabel: margin ? 'Vehicle margin scheme' : 'Workshop labour',
    revenueAccount: margin ? '8195' : '8400',
    debtorAccount: '2000',
    taxMode,
    taxRate: margin ? '0.00' : '20.00',
    taxTreatment: 'automatic',
    buKey: null,
    countryIso: country,
    currency: 'EUR',
  };
}

function v2Snapshot(
  country: Country,
  taxMode: 'STANDARD' | 'MARGIN_SCHEME',
  documentKind: 'INVOICE' | 'CREDIT_NOTE',
) {
  const margin = taxMode === 'MARGIN_SCHEME';
  const item = {
    id: `${documentKind.toLowerCase()}-${country}-${taxMode.toLowerCase()}-line`,
    net: margin ? '120.00' : '100.00',
    tax: margin ? '0.00' : '20.00',
    gross: '120.00',
    accounting_allocation: allocation(country, taxMode),
  };
  return {
    schema_version: 2,
    document_kind: documentKind,
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR',
    seller: { name: 'Seller' },
    items: [item],
    tax_breakdown: [],
    total_net: item.net,
    total_tax: item.tax,
    total_gross: '120.00',
    snapshot_created_at: '2026-03-05T00:00:00.000Z',
    tax_mode: taxMode,
    ...(margin
      ? {
          margin: {
            cost_basis: '0.00',
            margin_tax: '20.00',
            tax_rate: '20.00',
            calculation_profile: 'vehicle-margin-v1',
          },
        }
      : {}),
  };
}

function invoiceRecord(
  id: string,
  number: string,
  country: Country,
  taxMode: 'STANDARD' | 'MARGIN_SCHEME',
) {
  const snapshot = v2Snapshot(country, taxMode, 'INVOICE');
  return {
    id,
    status: 'FINALIZED',
    invoice_number: number,
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    date: new Date('2026-03-10T00:00:00.000Z'),
    tax_mode: taxMode,
    snapshot,
    items: snapshot.items.map((item) => ({
      id: item.id,
      accounting_snapshot: item.accounting_allocation,
    })),
  };
}

function legacyInvoiceRecord(id: string, number: string) {
  return {
    id,
    status: 'FINALIZED',
    invoice_number: number,
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    date: new Date('2026-03-08T00:00:00.000Z'),
    tax_mode: 'STANDARD',
    snapshot: { schema_version: 1, tax_mode: 'STANDARD' },
    items: [{ id: `${id}-line`, accounting_snapshot: null }],
  };
}

function creditRecord(id: string, number: string) {
  const snapshot = v2Snapshot('DE', 'STANDARD', 'CREDIT_NOTE');
  return {
    id,
    credit_number: number,
    status: 'FINALIZED',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    date: new Date('2026-03-20T00:00:00.000Z'),
    snapshot: {
      ...snapshot,
      date: '2026-03-20',
      credit_title: 'Rechnungskorrektur',
      original_document: {
        id: 'inv-v2-de',
        number: 'RE-2026-0002',
        date: '2026-03-10',
        reason: 'Correction',
        snapshot_version: 2,
      },
    },
    items: [],
  };
}

const invoices = [
  legacyInvoiceRecord('inv-v1-de', 'RE-2026-0001'),
  invoiceRecord('inv-v2-de', 'RE-2026-0002', 'DE', 'STANDARD'),
  invoiceRecord('inv-v2-at', 'RE-2026-0003', 'AT', 'STANDARD'),
  invoiceRecord('inv-v2-de-margin', 'RE-2026-0004', 'DE', 'MARGIN_SCHEME'),
  invoiceRecord('inv-v2-at-margin', 'RE-2026-0005', 'AT', 'MARGIN_SCHEME'),
];
const creditNotes = [creditRecord('cn-v2-de', 'CN-2026-0001')];

function prismaFixture(): PrismaService {
  return {
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    creditNote: { findMany: jest.fn().mockResolvedValue(creditNotes) },
  } as unknown as PrismaService;
}

async function evaluate(
  rules: AccountingExportAllocationRules,
): Promise<Record<string, AccountingExportCandidate>> {
  const candidates = await loadAccountingExportCandidates(
    prismaFixture(),
    'tenant-1',
    'le-1',
    PERIOD_FROM,
    PERIOD_TO,
    rules,
  );
  return Object.fromEntries(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
}

function blockerCodes(candidate: AccountingExportCandidate): string[] {
  return [...new Set(candidate.blockers.map((blocker) => blocker.code))].sort();
}

const DATEV_MARGIN_ENABLED = allocationRulesForProfile(DATEV_CODE, {
  marginScheme: { enabled: true, vatAccount: '1776' },
});
const RZL_PROFILE = allocationRulesForProfile(RZL_CODE, RZL_STEUERCODES);
const RZL_MARGIN_ENABLED = allocationRulesForProfile(RZL_CODE, {
  ...RZL_STEUERCODES,
  marginScheme: { enabled: true, vatAccount: '1776' },
});

describe('accounting-export mixed period (v1 + v2 + AT + DE, AUT-369)', () => {
  it('keeps the DATEV default unchanged: AT and margin documents stay blocked with reasons', async () => {
    const byId = await evaluate(DATEV_ALLOCATION_RULES);

    expect(blockerCodes(byId['inv-v1-de'])).toEqual([
      'LEGACY_DOCUMENT_UNSUPPORTED',
    ]);
    expect(blockerCodes(byId['inv-v2-de'])).toEqual([]);
    expect(blockerCodes(byId['inv-v2-at'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
    ]);
    expect(blockerCodes(byId['inv-v2-de-margin'])).toEqual([
      'UNSUPPORTED_EXPORT_TAX_MODE',
    ]);
    expect(blockerCodes(byId['inv-v2-at-margin'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
      'UNSUPPORTED_EXPORT_TAX_MODE',
    ]);
    expect(blockerCodes(byId['cn-v2-de'])).toEqual([]);
  });

  it('lifts only the DE margin documents when the DATEV margin scheme is enabled', async () => {
    const byId = await evaluate(DATEV_MARGIN_ENABLED);

    expect(blockerCodes(byId['inv-v1-de'])).toEqual([
      'LEGACY_DOCUMENT_UNSUPPORTED',
    ]);
    expect(blockerCodes(byId['inv-v2-de'])).toEqual([]);
    expect(blockerCodes(byId['inv-v2-at'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
    ]);
    expect(blockerCodes(byId['inv-v2-de-margin'])).toEqual([]);
    expect(byId['inv-v2-de-margin'].rows).toHaveLength(2);
    expect(blockerCodes(byId['inv-v2-at-margin'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
    ]);
    expect(blockerCodes(byId['cn-v2-de'])).toEqual([]);
  });

  it('exports only the AT standard documents on the RZL profile', async () => {
    const byId = await evaluate(RZL_PROFILE);

    expect(blockerCodes(byId['inv-v1-de'])).toEqual([
      'LEGACY_DOCUMENT_UNSUPPORTED',
    ]);
    expect(blockerCodes(byId['inv-v2-de'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
    ]);
    expect(blockerCodes(byId['inv-v2-at'])).toEqual([]);
    expect(blockerCodes(byId['inv-v2-de-margin'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
      'UNSUPPORTED_EXPORT_TAX_MODE',
    ]);
    expect(blockerCodes(byId['inv-v2-at-margin'])).toEqual([
      'UNSUPPORTED_EXPORT_TAX_MODE',
    ]);
    expect(blockerCodes(byId['cn-v2-de'])).toEqual([
      'UNSUPPORTED_EXPORT_COUNTRY',
    ]);
  });

  it('books one row per clean document and none for blocked documents', async () => {
    const byId = await evaluate(DATEV_MARGIN_ENABLED);

    expect(byId['inv-v2-de'].rows).toHaveLength(1);
    expect(byId['inv-v2-de-margin'].rows).toHaveLength(2);
    expect(byId['cn-v2-de'].rows).toHaveLength(1);
    expect(byId['inv-v2-at'].rows).toEqual([]);
    expect(byId['inv-v1-de'].rows).toEqual([]);
  });

  it('never lifts margin documents on the RZL profile, even with the margin setting on', async () => {
    const byId = await evaluate(RZL_MARGIN_ENABLED);

    expect(blockerCodes(byId['inv-v2-at-margin'])).toEqual([
      'UNSUPPORTED_EXPORT_TAX_MODE',
    ]);
    expect(blockerCodes(byId['inv-v2-at'])).toEqual([]);
    expect(blockerCodes(byId['inv-v1-de'])).toEqual([
      'LEGACY_DOCUMENT_UNSUPPORTED',
    ]);
  });
});
