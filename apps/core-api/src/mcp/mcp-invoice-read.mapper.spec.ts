import { DiscountType, InvoiceStatus, Prisma } from '@prisma/client';
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
