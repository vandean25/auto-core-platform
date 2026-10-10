import { DiscountType, InvoiceStatus, Prisma } from '@prisma/client';
import { buildInvoiceSnapshotV2 } from '../invoices/invoice-snapshot-v2.js';
import {
  mcpCustomerName,
  toMcpInvoiceDetail,
  toMcpInvoiceListRow,
} from './mcp-invoice-read.mapper.js';

const INVOICE_ID = '00000000-0000-4000-8000-0000000000f1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

function draftWithItems(
  items: Array<{
    quantity: string;
    unit_price: string;
    tax_rate: string;
    line_discount_type?: DiscountType | null;
    line_discount_value?: string | null;
  }>,
) {
  return {
    id: INVOICE_ID,
    invoice_number: null,
    status: InvoiceStatus.DRAFT,
    date: new Date('2026-09-20T00:00:00.000Z'),
    due_date: new Date('2026-10-04T00:00:00.000Z'),
    currency: null,
    tax_mode: 'STANDARD' as const,
    total_gross: new Prisma.Decimal('0'),
    total_net: new Prisma.Decimal('0'),
    total_tax: new Prisma.Decimal('0'),
    global_discount_type: null,
    snapshot: null,
    workshop_order_id: null,
    sales_order_id: null,
    customer: {
      id: CUSTOMER_ID,
      type: 'PRIVATE' as const,
      company_name: null,
      first_name: 'Erika',
      last_name: 'Beispiel',
    },
    items: items.map((item) => ({
      description: 'Position',
      quantity: new Prisma.Decimal(item.quantity),
      unit_price: new Prisma.Decimal(item.unit_price),
      tax_rate: new Prisma.Decimal(item.tax_rate),
      line_discount_type: item.line_discount_type ?? null,
      line_discount_value:
        item.line_discount_value == null
          ? null
          : new Prisma.Decimal(item.line_discount_value),
    })),
    credit_notes: [],
  };
}

function firstLine(detail: ReturnType<typeof toMcpInvoiceDetail>) {
  return detail.lines[0];
}

describe('mcpCustomerName', () => {
  it('uses first and last name for a private customer, as the PDF does', () => {
    expect(
      mcpCustomerName({
        type: 'PRIVATE',
        company_name: 'Ignored GmbH',
        first_name: 'Erika',
        last_name: 'Beispiel',
      }),
    ).toBe('Erika Beispiel');
  });

  it('uses the company name for a company customer', () => {
    expect(
      mcpCustomerName({
        type: 'COMPANY',
        company_name: 'Beispiel Autohaus GmbH',
        first_name: 'Erika',
        last_name: 'Beispiel',
      }),
    ).toBe('Beispiel Autohaus GmbH');
  });

  it('falls back to the person name when a company has no company name', () => {
    expect(
      mcpCustomerName({
        type: 'COMPANY',
        company_name: null,
        first_name: 'Erika',
        last_name: 'Beispiel',
      }),
    ).toBe('Erika Beispiel');
  });
});

describe('toMcpInvoiceListRow', () => {
  it('formats the gross total as a two-decimal EUR string and defaults the currency', () => {
    const row = toMcpInvoiceListRow({
      id: INVOICE_ID,
      invoice_number: 'RE-2026-0001',
      status: InvoiceStatus.ISSUED,
      date: new Date('2026-09-20T00:00:00.000Z'),
      currency: null,
      total_gross: new Prisma.Decimal('1234.5'),
      snapshot: null,
      customer: {
        id: CUSTOMER_ID,
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Erika',
        last_name: 'Beispiel',
      },
    });

    expect(row).toEqual({
      id: INVOICE_ID,
      number: 'RE-2026-0001',
      status: 'ISSUED',
      customer: { id: CUSTOMER_ID, name: 'Erika Beispiel' },
      issued_at: '2026-09-20T00:00:00.000Z',
      total_gross: '1234.50',
      currency: 'EUR',
    });
  });
});

describe('list total for committed and draft invoices', () => {
  const snapshot = {
    schema_version: 2,
    document_kind: 'INVOICE',
    template_version: 'invoice-pdf-v1',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    currency: 'EUR',
    seller: { name: 'Musterwerkstatt Nord GmbH' },
    items: [{ description: 'Position' }],
    tax_breakdown: [],
    total_net: '1.50',
    total_tax: '0.30',
    total_gross: '1.80',
    snapshot_created_at: '2026-09-20T12:00:00.000Z',
  };

  /** Three lines of 0.50 at 19%: the stored column keeps the unrounded tax, the snapshot rounds each line. */
  function listRecord(status: InvoiceStatus) {
    return {
      id: INVOICE_ID,
      invoice_number: 'RE-2026-0002',
      status,
      date: new Date('2026-09-20T00:00:00.000Z'),
      currency: 'EUR',
      total_gross: new Prisma.Decimal('1.79'),
      snapshot,
      customer: {
        id: CUSTOMER_ID,
        type: 'PRIVATE' as const,
        company_name: null,
        first_name: 'Erika',
        last_name: 'Beispiel',
      },
    };
  }

  it('shows the snapshot total for an issued invoice, the figure the PDF prints', () => {
    expect(toMcpInvoiceListRow(listRecord(InvoiceStatus.ISSUED))).toMatchObject({
      total_gross: '1.80',
    });
  });

  it('shows the snapshot total for finalized, paid, and cancelled invoices', () => {
    for (const status of [
      InvoiceStatus.FINALIZED,
      InvoiceStatus.PAID,
      InvoiceStatus.CANCELLED,
    ]) {
      expect(toMcpInvoiceListRow(listRecord(status))).toMatchObject({
        total_gross: '1.80',
      });
    }
  });

  it('shows the snapshot total for a committed invoice with a legacy V1 snapshot', () => {
    const legacySnapshot = {
      id: INVOICE_ID,
      invoice_number: 'RE-2025-0007',
      date: '2025-06-01T00:00:00.000Z',
      due_date: '2025-06-15T00:00:00.000Z',
      total_net: '1.50',
      total_tax: '0.30',
      total_gross: '1.80',
      notes: null,
      tax_mode: 'STANDARD',
      customer: {
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Erika',
        last_name: 'Beispiel',
        email: null,
        phone: null,
        vat_id: null,
        address_street: null,
        address_city: null,
        address_zip: null,
        address_country: null,
      },
      vehicle: null,
      items: [
        {
          description: 'Position',
          quantity: '3.00',
          unit_price: '0.50',
          tax_rate: '19.00',
          line_discount_type: null,
          line_discount_value: null,
          line_total: '1.50',
          revenue_group_name: null,
        },
      ],
      snapshot_created_at: '2025-06-01T12:00:00.000Z',
    };

    expect(
      toMcpInvoiceListRow({
        ...listRecord(InvoiceStatus.ISSUED),
        snapshot: legacySnapshot,
      }),
    ).toMatchObject({ total_gross: '1.80' });
  });

  it('shows the stored total for a draft even when a snapshot is present', () => {
    expect(toMcpInvoiceListRow(listRecord(InvoiceStatus.DRAFT))).toMatchObject({
      total_gross: '1.79',
    });
  });

  it('shows the stored total for a committed invoice without a usable snapshot', () => {
    expect(
      toMcpInvoiceListRow({ ...listRecord(InvoiceStatus.ISSUED), snapshot: null }),
    ).toMatchObject({ total_gross: '1.79' });
  });
});

describe('stored draft line amounts', () => {
  it('rounds the line tax half-up, not to even', () => {
    // 0.05 net at 10% is 0.005 tax, which rounds up to 0.01 (not to 0.00).
    const detail = toMcpInvoiceDetail(
      draftWithItems([{ quantity: '1', unit_price: '0.05', tax_rate: '10' }]),
      new Map(),
    );

    expect(firstLine(detail)).toMatchObject({ net: '0.05', gross: '0.06' });
  });

  it('applies a percentage line discount before tax', () => {
    // 1 x 33.33 less 10% is 30.00 net; the discount is rounded to cents first.
    const detail = toMcpInvoiceDetail(
      draftWithItems([
        {
          quantity: '1',
          unit_price: '33.33',
          tax_rate: '20',
          line_discount_type: DiscountType.PERCENTAGE,
          line_discount_value: '10',
        },
      ]),
      new Map(),
    );

    expect(firstLine(detail)).toMatchObject({
      quantity: '1.000',
      unit_net: '33.33',
      net: '30.00',
      gross: '36.00',
    });
  });

  it('applies a flat line discount and never goes below zero', () => {
    const detail = toMcpInvoiceDetail(
      draftWithItems([
        {
          quantity: '1',
          unit_price: '40',
          tax_rate: '20',
          line_discount_type: DiscountType.FLAT_AMOUNT,
          line_discount_value: '50',
        },
      ]),
      new Map(),
    );

    expect(firstLine(detail)).toMatchObject({ net: '0.00', gross: '0.00' });
  });
});

describe('stored lines against the snapshot builder', () => {
  const SITE_ID = '00000000-0000-4000-8000-0000000000a1';
  const LEGAL_ENTITY_ID = '00000000-0000-4000-8000-0000000000e1';
  const SELLER = {
    name: 'Musterwerkstatt Nord GmbH',
    country_iso: 'DE',
    address_street: 'Testgasse 1',
    address_line2: null,
    address_zip: '10115',
    address_city: 'Berlin',
    tax_number: null,
    vat_id: 'DE000000000',
    iban: null,
    bic: null,
    bank_name: null,
    email: null,
    phone: null,
    registration_number: null,
    registration_court: null,
    representatives: null,
    payment_terms_days: 14,
    payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
  };

  type LineInput = {
    quantity: string;
    unit_price: string;
    tax_rate: string;
    line_discount_type?: DiscountType | null;
    line_discount_value?: string | null;
  };

  /** Net and gross that the snapshot builder, the PDF source, gives for the same lines. */
  function builderLines(items: LineInput[], taxMode: 'STANDARD' | 'MARGIN_SCHEME') {
    const snapshot = buildInvoiceSnapshotV2({
      invoice: {
        id: INVOICE_ID,
        tax_mode: taxMode,
        global_discount_type: null,
        global_discount_value: null,
        date: new Date('2026-09-20T00:00:00.000Z'),
        due_date: new Date('2026-10-04T00:00:00.000Z'),
        supply_date_from: null,
        supply_date_to: null,
        notes: null,
        total_gross: new Prisma.Decimal('0'),
        customer: { type: 'PRIVATE', first_name: 'Erika', last_name: 'Beispiel' },
        vehicle: null,
      } as never,
      seller: SELLER as never,
      siteId: SITE_ID,
      legalEntityId: LEGAL_ENTITY_ID,
      lineAllocations: items.map((item, index) => ({
        id: `line-${index + 1}`,
        description: 'Position',
        quantity: new Prisma.Decimal(item.quantity),
        unitPrice: new Prisma.Decimal(item.unit_price),
        taxRate: new Prisma.Decimal(item.tax_rate),
        lineDiscountType: item.line_discount_type ?? null,
        lineDiscountValue:
          item.line_discount_value == null
            ? null
            : new Prisma.Decimal(item.line_discount_value),
        revenueGroupName: null,
        accountingAllocation: {} as never,
      })),
    });
    return snapshot.items.map((item) => ({ net: item.net, gross: item.gross }));
  }

  it('matches the builder for three-decimal quantities, cent prices, and both discount kinds', () => {
    const items: LineInput[] = [
      { quantity: '1.500', unit_price: '8.23', tax_rate: '10.00' },
      {
        quantity: '2.000',
        unit_price: '25.00',
        tax_rate: '20.00',
        line_discount_type: DiscountType.PERCENTAGE,
        line_discount_value: '10.00',
      },
      {
        quantity: '1.000',
        unit_price: '40.00',
        tax_rate: '20.00',
        line_discount_type: DiscountType.FLAT_AMOUNT,
        line_discount_value: '50.00',
      },
      {
        quantity: '3.000',
        unit_price: '3.33',
        tax_rate: '20.00',
        line_discount_type: DiscountType.PERCENTAGE,
        line_discount_value: '15.00',
      },
    ];

    const stored = toMcpInvoiceDetail(draftWithItems(items), new Map());

    expect(
      stored.lines.map((line) => ({ net: line.net, gross: line.gross })),
    ).toEqual(builderLines(items, 'STANDARD'));
    expect(stored.lines[0]).toMatchObject({ net: '12.35', gross: '13.58' });
  });

  it('gives a margin-scheme line a gross equal to its net, as the builder does', () => {
    const items: LineInput[] = [
      { quantity: '1.000', unit_price: '100.00', tax_rate: '20.00' },
    ];

    const stored = toMcpInvoiceDetail(
      { ...draftWithItems(items), tax_mode: 'MARGIN_SCHEME' },
      new Map(),
    );

    expect(
      stored.lines.map((line) => ({ net: line.net, gross: line.gross })),
    ).toEqual(builderLines(items, 'MARGIN_SCHEME'));
    expect(stored.lines[0]).toMatchObject({ net: '100.00', gross: '100.00' });
  });
});

describe('toMcpInvoiceDetail source labelling', () => {
  it('labels a draft as stored and reports no seller', () => {
    const detail = toMcpInvoiceDetail(
      draftWithItems([{ quantity: '1', unit_price: '10', tax_rate: '20' }]),
      new Map(),
    );

    expect(detail.amount_source).toBe('stored');
    expect(detail.seller).toBeNull();
    expect(detail.workshop_order).toBeNull();
    expect(detail.sales_order).toBeNull();
  });

  it('reports an order link with a null number when the order is not in the given map', () => {
    const orderId = '00000000-0000-4000-8000-0000000000d1';
    const base = draftWithItems([]);
    const detail = toMcpInvoiceDetail(
      { ...base, workshop_order_id: orderId },
      new Map(),
    );

    expect(detail.workshop_order).toEqual({ id: orderId, order_number: null });
  });
});
