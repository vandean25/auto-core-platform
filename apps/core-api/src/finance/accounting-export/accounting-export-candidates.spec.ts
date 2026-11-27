import { InvoiceStatus, InvoiceTaxMode, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  allocationRulesForProfile,
  DATEV_ALLOCATION_RULES,
} from './accounting-export-allocation-rules.js';
import {
  buildCreditRows,
  buildInvoiceRows,
  buildStockAdjustmentRows,
} from './accounting-export-booking-rows.js';
import {
  computeSignedTotals,
  loadAccountingExportCandidates,
} from './accounting-export-candidates.js';
import type { AccountingExportBookingRow } from './accounting-export.types.js';
import { buildBmdNtcsBookingFields } from './bmd-ntcs-import.serializer.js';
import { BMD_MTF_PUBLIC_FIELD_NAMES } from './bmd-format.constants.js';
import { buildRzlFibuImportBookingFields } from './rzl-fibu-import.serializer.js';
import { RZL_BOOKING_COLUMNS } from './rzl-format.constants.js';

describe('computeSignedTotals', () => {
  const baseRow = (
    overrides: Partial<AccountingExportBookingRow>,
  ): AccountingExportBookingRow => ({
    documentId: 'doc-1',
    documentKind: 'INVOICE',
    documentNumber: 'RE-1',
    documentDate: '2026-01-10',
    lineId: 'line-1',
    polarity: 'S',
    net: '100.00',
    tax: '20.00',
    taxRate: '20.00',
    gross: '120.00',
    debtorAccount: '1000',
    revenueAccount: '8400',
    buKey: null,
    bookingText: 'RE RE-1',
    ...overrides,
  });

  it('buckets signed totals by revenue account and frozen tax rate', () => {
    const totals = computeSignedTotals([
      baseRow({
        lineId: 'line-1',
        taxRate: '20.00',
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
      }),
      baseRow({
        lineId: 'line-2',
        taxRate: '7.00',
        net: '50.00',
        tax: '3.50',
        gross: '53.50',
      }),
      baseRow({
        documentKind: 'CREDIT_NOTE',
        lineId: 'line-3',
        polarity: 'H',
        taxRate: '20.00',
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
      }),
    ]);

    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '0.00',
        tax: '0.00',
        gross: '0.00',
      },
      {
        account: '8400',
        taxRate: '7.00',
        net: '50.00',
        tax: '3.50',
        gross: '53.50',
      },
    ]);
  });
});

describe('AUT-1087: accounting export booking rows use per-rate VAT, not informational line VAT', () => {
  const allocation = {
    profileCode: 'ACP-DATEV-DE-EUR-1',
    profileVersion: 1,
    sourceCategoryKey: 'parts',
    sourceCategoryLabel: 'Parts',
    revenueAccount: '8400',
    debtorAccount: '1000',
    taxMode: 'STANDARD' as const,
    taxRate: '20.00',
    taxTreatment: 'automatic' as const,
    buKey: null,
    countryIso: 'DE' as const,
    currency: 'EUR' as const,
  };

  const makeLine = (id: string) => ({
    id,
    description: 'Part',
    quantity: '1.000',
    unit_price: '10.02',
    tax_rate: '20.00',
    line_discount_type: null,
    line_discount_value: null,
    net: '10.02',
    tax: '2.00',
    gross: '12.02',
    revenue_group_name: 'Parts',
    accounting_allocation: allocation,
  });

  const baseSnapshot = (tax: string, gross: string) => ({
    schema_version: 2 as const,
    document_kind: 'INVOICE' as const,
    template_version: 'invoice-pdf-v1',
    country_profile_version: 'legal-invoicing-v1',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR' as const,
    seller: {
      name: 'Garage GmbH',
      country_iso: 'DE' as const,
      address_street: 'Str 1',
      address_line2: null,
      address_zip: '10115',
      address_city: 'Berlin',
      tax_number: '12/345/67890',
      vat_id: null,
      iban: null,
      bic: null,
      bank_name: null,
      email: null,
      phone: null,
      registration_number: null,
      registration_court: null,
      representatives: null,
    },
    customer: {
      type: 'PRIVATE' as const,
      company_name: null,
      first_name: 'Max',
      last_name: 'Muster',
      email: null,
      phone: null,
      vat_id: null,
      address_street: 'Str 2',
      address_city: 'Berlin',
      address_zip: '10115',
      address_country: 'DE',
    },
    vehicle: null,
    date: '2026-10-01',
    due_date: '2026-10-15',
    supply_date_from: '2026-10-01',
    supply_date_to: '2026-10-01',
    payment_terms: { days: 14, text: '14 days' },
    items: [makeLine('l1'), makeLine('l2'), makeLine('l3')],
    tax_breakdown: [{ rate: '20.00', net: '30.06', tax, gross }],
    total_net: '30.06',
    total_tax: tax,
    total_gross: gross,
    notes: null,
    tax_mode: InvoiceTaxMode.STANDARD,
    snapshot_created_at: '2026-10-01T10:00:00.000Z',
  });

  const roundedCandidates = (
    countryIso: 'AT' | 'DE',
    roundingAmount = '0.01',
  ) => {
    const roundedAllocation = { ...allocation, countryIso };
    const snapshot = {
      ...baseSnapshot('5.00', '29.99'),
      items: ['l1', 'l2', 'l3'].map((id) => ({
        ...makeLine(id),
        unit_price: '8.33',
        net: '8.33',
        tax: '1.67',
        gross: '10.00',
        accounting_allocation: roundedAllocation,
      })),
      tax_breakdown: [
        { rate: '20.00', net: '24.99', tax: '5.00', gross: '29.99' },
      ],
      total_net: '24.99',
      rounding_amount: roundingAmount,
      total_gross: roundingAmount === '0.01' ? '30.00' : '29.98',
    };
    const date = new Date('2026-10-01T12:00:00Z');
    const common = { date, site_id: 'site-1', legal_entity_id: 'le-1' };
    const prisma = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...common,
            id: 'inv-1',
            invoice_number: 'RE-1',
            status: InvoiceStatus.ISSUED,
            tax_mode: InvoiceTaxMode.STANDARD,
            snapshot,
            items: snapshot.items.map((item) => ({
              id: item.id,
              accounting_snapshot: roundedAllocation,
            })),
          },
        ]),
      },
      creditNote: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...common,
            id: 'cn-1',
            credit_number: 'CN-1',
            snapshot: {
              ...snapshot,
              document_kind: 'CREDIT_NOTE',
              original_document: { number: 'RE-1' },
            },
          },
        ]),
      },
      inventoryTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      accountingExport: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    return { prisma, date, snapshot };
  };

  it.each([
    {
      profile: 'ACP-DATEV-DE-EUR-1',
      country: 'DE' as const,
      serializer: null,
      amount: '0.01',
    },
    {
      profile: 'ACP-DATEV-DE-EUR-1',
      country: 'DE' as const,
      serializer: null,
      amount: '-0.01',
    },
    {
      profile: 'ACP-RZL-AT-EUR-1',
      country: 'AT' as const,
      serializer: 'rzl',
      amount: '0.01',
    },
    {
      profile: 'ACP-BMD-AT-EUR-1',
      country: 'AT' as const,
      serializer: 'bmd',
      amount: '0.01',
    },
  ])(
    'books the full signed invoice and credit payable for $profile with $amount rounding',
    async ({ profile, country, serializer, amount }) => {
      const { prisma, date, snapshot } = roundedCandidates(country, amount);
      const configuredCodes = { vat20: '20' };
      const rules = allocationRulesForProfile(profile, {
        roundingAccount: '4900',
        ...(serializer
          ? {
              roundingSteuercode: '0',
              [serializer]: { steuercodes: configuredCodes },
            }
          : {}),
      });
      const candidates = await loadAccountingExportCandidates(
        prisma,
        'tenant-1',
        'le-1',
        date,
        date,
        rules,
      );

      expect(
        candidates.map(({ kind, blockers, rows }) => {
          const totals = computeSignedTotals(rows);
          const rounding = rows.find((row) => row.revenueAccount === '4900');
          return {
            kind,
            blockers,
            gross: totals
              .reduce((sum, row) => sum.add(row.gross), new Prisma.Decimal(0))
              .toFixed(2),
            tax: totals
              .reduce((sum, row) => sum.add(row.tax), new Prisma.Decimal(0))
              .toFixed(2),
            rounding: rounding && {
              gross: rounding.gross,
              net: rounding.net,
              tax: rounding.tax,
              debtor: rounding.debtorAccount,
              buKey: rounding.buKey,
            },
            code:
              rounding && serializer === 'rzl'
                ? buildRzlFibuImportBookingFields(rounding, configuredCodes)[
                    RZL_BOOKING_COLUMNS.indexOf('STEUERCODE')
                  ]
                : rounding && serializer === 'bmd'
                  ? buildBmdNtcsBookingFields(rounding, configuredCodes)[
                      BMD_MTF_PUBLIC_FIELD_NAMES.indexOf('Steuercode')
                    ]
                  : undefined,
          };
        }),
      ).toEqual([
        {
          kind: 'CREDIT_NOTE',
          blockers: [],
          gross: '-' + snapshot.total_gross,
          tax: '-5.00',
          rounding: {
            gross: '0.01',
            net: '0.00',
            tax: '0.00',
            debtor: '1000',
            buKey: null,
          },
          code: serializer ? '0' : undefined,
        },
        {
          kind: 'INVOICE',
          blockers: [],
          gross: snapshot.total_gross,
          tax: '5.00',
          rounding: {
            gross: '0.01',
            net: '0.00',
            tax: '0.00',
            debtor: '1000',
            buKey: null,
          },
          code: serializer ? '0' : undefined,
        },
      ]);
    },
  );

  it.each([
    { label: 'the account is missing', amount: '0.01', params: {} },
    {
      label: 'the Austrian non-VAT code is missing',
      amount: '0.01',
      params: { roundingAccount: '4900' },
    },
    {
      label: 'the Austrian layout cannot encode negative rounding',
      amount: '-0.01',
      params: { roundingAccount: '4900', roundingSteuercode: '0' },
    },
  ])(
    'blocks both documents without writing incomplete rows when $label',
    async ({ amount, params }) => {
      const { prisma, date } = roundedCandidates('AT', amount);
      const rules = allocationRulesForProfile('ACP-RZL-AT-EUR-1', {
        ...params,
        rzl: { steuercodes: { vat20: '20' } },
      });
      const candidates = await loadAccountingExportCandidates(
        prisma,
        'tenant-1',
        'le-1',
        date,
        date,
        rules,
      );

      expect(
        candidates.map(({ kind, blockers, rows }) => ({
          kind,
          blocked: blockers.length > 0,
          rows,
        })),
      ).toEqual([
        { kind: 'CREDIT_NOTE', blocked: true, rows: [] },
        { kind: 'INVOICE', blocked: true, rows: [] },
      ]);
    },
  );

  it('AUT-1087 Anti-criterion 3: exports per-rate VAT (6.01 / 36.07) instead of informational line VAT sum (6.00 / 36.06)', () => {
    const rows = buildInvoiceRows(
      {
        id: 'inv-1',
        invoice_number: 'RE-2026-0001',
        snapshot: baseSnapshot('6.01', '36.07'),
        items: [
          { id: 'l1', accounting_snapshot: allocation },
          { id: 'l2', accounting_snapshot: allocation },
          { id: 'l3', accounting_snapshot: allocation },
        ],
      },
      '2026-10-01',
      DATEV_ALLOCATION_RULES,
    );

    const totals = computeSignedTotals(rows);
    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '30.06',
        tax: '6.01',
        gross: '36.07',
      },
    ]);
  });

  it('AUT-1087 Anti-criterion 2: keeps pre-change issued invoice export totals unchanged (6.00 / 36.06)', () => {
    const rows = buildInvoiceRows(
      {
        id: 'inv-old',
        invoice_number: 'RE-2026-0000',
        snapshot: baseSnapshot('6.00', '36.06'),
        items: [
          { id: 'l1', accounting_snapshot: allocation },
          { id: 'l2', accounting_snapshot: allocation },
          { id: 'l3', accounting_snapshot: allocation },
        ],
      },
      '2026-10-01',
      DATEV_ALLOCATION_RULES,
    );

    const totals = computeSignedTotals(rows);
    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '30.06',
        tax: '6.00',
        gross: '36.06',
      },
    ]);
  });

  it('AUT-1087: exports credit note per-rate VAT (6.01 / 36.07) when snapshot tax_breakdown is per-rate', () => {
    const inv = baseSnapshot('6.01', '36.07');
    const cnSnapshot = {
      ...inv,
      document_kind: 'CREDIT_NOTE' as const,
      credit_title: 'Stornorechnung' as const,
      original_document: {
        id: 'inv-1',
        number: 'RE-2026-0001',
        date: '2026-10-01',
        reason: 'Full cancellation',
        snapshot_version: 2,
      },
    };

    const rows = buildCreditRows(
      {
        id: 'cn-1',
        credit_number: 'CN-2026-0001',
        snapshot: cnSnapshot,
      },
      DATEV_ALLOCATION_RULES,
    );

    const totals = computeSignedTotals(rows);
    expect(totals).toEqual([
      {
        account: '8400',
        taxRate: '20.00',
        net: '-30.06',
        tax: '-6.01',
        gross: '-36.07',
      },
    ]);
  });
});

describe('AUT-1049: valued stock corrections as Bestandsveränderung', () => {
  const makeAdjustmentTx = (overrides: Record<string, unknown> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    seq: BigInt(101),
    site_id: 'site-1',
    quantity: new Prisma.Decimal('2.000'),
    cost_basis: new Prisma.Decimal('10.0000'),
    reason: 'INVENTORY_COUNT' as const,
    note: null,
    reversal_of_transaction_id: null,
    reversed_by: [] as { id: string }[],
    item: { sku: 'BRK-001', name: 'Brake Pad' },
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    ...overrides,
  });

  it('rounds extended Wert (quantity * unit cost) to 2 decimals, never 4 decimals (Anti-criterion 5)', () => {
    const rows = buildStockAdjustmentRows(
      makeAdjustmentTx({
        quantity: new Prisma.Decimal('2.000'),
        cost_basis: new Prisma.Decimal('1.2345'),
      }),
      '2026-03-10',
      '5800',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      documentKind: 'STOCK_ADJUSTMENT',
      polarity: 'S',
      net: '2.47',
      tax: '0.00',
      taxRate: '0.00',
      gross: '2.47',
      revenueAccount: '5800',
      debtorAccount: '',
      buKey: null,
    });
  });

  it('emits S for plus correction and H for minus correction, defaulting account to empty when unmapped', () => {
    const plusRows = buildStockAdjustmentRows(
      makeAdjustmentTx({
        id: '11111111-1111-4111-8111-111111111111',
        seq: BigInt(101),
        quantity: new Prisma.Decimal('3.000'),
        cost_basis: new Prisma.Decimal('12.5000'),
      }),
      '2026-03-10',
    );
    const minusRows = buildStockAdjustmentRows(
      makeAdjustmentTx({
        id: '22222222-2222-4222-8222-222222222222',
        seq: BigInt(102),
        quantity: new Prisma.Decimal('-2.000'),
        cost_basis: new Prisma.Decimal('12.5000'),
        reason: 'DAMAGE',
      }),
      '2026-03-11',
    );

    expect(plusRows[0]).toMatchObject({
      polarity: 'S',
      gross: '37.50',
      revenueAccount: '',
      debtorAccount: '',
      buKey: null,
    });
    expect(minusRows[0]).toMatchObject({
      polarity: 'H',
      gross: '25.00',
      revenueAccount: '',
      debtorAccount: '',
      buKey: null,
    });
    expect(computeSignedTotals([...plusRows, ...minusRows])).toEqual([
      {
        account: '',
        taxRate: '0.00',
        net: '12.50',
        tax: '0.00',
        gross: '12.50',
      },
    ]);
  });

  it('includes reversal pointers on both original and Gegenbuchung and nets to zero (Scenario 3)', () => {
    const origId = '11111111-aaaa-4111-8111-111111111111';
    const revId = '22222222-bbbb-4222-8222-222222222222';
    const origRows = buildStockAdjustmentRows(
      makeAdjustmentTx({
        id: origId,
        seq: BigInt(201),
        quantity: new Prisma.Decimal('4.000'),
        cost_basis: new Prisma.Decimal('15.0000'),
        reversed_by: [{ id: revId }],
      }),
      '2026-03-12',
      '5800',
    );
    const revRows = buildStockAdjustmentRows(
      makeAdjustmentTx({
        id: revId,
        seq: BigInt(202),
        quantity: new Prisma.Decimal('-4.000'),
        cost_basis: new Prisma.Decimal('15.0000'),
        reversal_of_transaction_id: origId,
      }),
      '2026-03-12',
      '5800',
    );

    expect(origRows[0].bookingText).toContain(revId.slice(0, 8));
    expect(revRows[0].bookingText).toContain(origId.slice(0, 8));
    expect(computeSignedTotals([...origRows, ...revRows])).toEqual([
      {
        account: '5800',
        taxRate: '0.00',
        net: '0.00',
        tax: '0.00',
        gross: '0.00',
      },
    ]);
  });

  it('loads valued adjustments, omits unvalued (null cost_basis) and already-exported adjustments (Anti-criteria 2 & 4)', async () => {
    const valuedNew = makeAdjustmentTx({
      id: '33333333-3333-4333-8333-333333333333',
      seq: BigInt(301),
    });
    const alreadyExported = makeAdjustmentTx({
      id: '44444444-4444-4444-8444-444444444444',
      seq: BigInt(302),
    });

    const prismaMock = {
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      creditNote: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryTransaction: {
        findMany: jest.fn().mockResolvedValue([valuedNew, alreadyExported]),
      },
      accountingExport: {
        findMany: jest.fn().mockResolvedValue([
          {
            document_manifest: [
              { id: alreadyExported.id, kind: 'STOCK_ADJUSTMENT' },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const candidates = await loadAccountingExportCandidates(
      prismaMock,
      'tenant-1',
      'le-1',
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-03-31T00:00:00.000Z'),
      allocationRulesForProfile('ACP-DATEV-DE-EUR-1', {
        stockAdjustmentAccount: '5800',
      }),
    );

    expect(
      (prismaMock.inventoryTransaction.findMany as jest.Mock).mock.calls[0][0]
        .where,
    ).toMatchObject({
      cost_basis: { not: null },
    });
    expect(candidates.map((c) => c.id)).toEqual([valuedNew.id]);
    expect(candidates[0].kind).toBe('STOCK_ADJUSTMENT');
    expect(candidates[0].blockers).toEqual([]);
  });
});
