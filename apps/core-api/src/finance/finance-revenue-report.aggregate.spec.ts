import { DiscountType, InvoiceTaxMode, Prisma } from '@prisma/client';
import {
  aggregateRevenueReport,
  classifyRevenueSource,
  type RevenueCreditNoteRow,
  type RevenueInvoiceRow,
} from './finance-revenue-report.aggregate.js';

const d = (value: string) => new Prisma.Decimal(value);

function workshopInvoice(
  overrides: Partial<RevenueInvoiceRow> & { id: string },
): RevenueInvoiceRow {
  return {
    tax_mode: InvoiceTaxMode.STANDARD,
    workshop_order_id: 'wo-1',
    vehicle_sale_id: null,
    global_discount_type: null,
    global_discount_value: null,
    total_net: d('0'),
    total_tax: d('0'),
    total_gross: d('0'),
    items: [],
    ...overrides,
  };
}

describe('finance-revenue-report.aggregate', () => {
  it('classifies workshop, vehicle sales, and other sources', () => {
    expect(
      classifyRevenueSource({
        workshop_order_id: 'wo',
        vehicle_sale_id: null,
      }),
    ).toBe('workshop');
    expect(
      classifyRevenueSource({
        workshop_order_id: null,
        vehicle_sale_id: 'vs',
      }),
    ).toBe('vehicle_sales');
    expect(
      classifyRevenueSource({
        workshop_order_id: null,
        vehicle_sale_id: null,
      }),
    ).toBe('other');
  });

  it('aggregates standard lines and subtracts credit notes by group', () => {
    const invoices: RevenueInvoiceRow[] = [
      workshopInvoice({
        id: 'inv-1',
        items: [
          {
            id: 'line-1',
            revenue_group_name: 'Parts',
            quantity: d('1'),
            unit_price: d('100.00'),
            line_total: d('100.00'),
            line_discount_type: null,
            line_discount_value: null,
            tax_rate: d('20'),
          },
        ],
      }),
    ];
    const creditNotes: RevenueCreditNoteRow[] = [
      {
        id: 'cn-1',
        total_net: d('50.00'),
        total_tax: d('10.00'),
        total_gross: d('60.00'),
        original_invoice: {
          workshop_order_id: 'wo-1',
          vehicle_sale_id: null,
          tax_mode: InvoiceTaxMode.STANDARD,
        },
        items: [
          {
            snapshot: { net: '50.00', tax: '10.00', gross: '60.00' },
            original_invoice_item: { revenue_group_name: 'Parts' },
          },
        ],
      },
    ];

    const report = aggregateRevenueReport({
      period: { from: '2026-01-01', to: '2026-01-31', timezone: 'Europe/Vienna' },
      site_id: 'site-1',
      invoices,
      creditNotes,
    });

    expect(report.totals.net.toFixed(2)).toBe('50.00');
    expect(report.totals.vat.toFixed(2)).toBe('10.00');
    expect(report.totals.gross.toFixed(2)).toBe('60.00');
    expect(report.by_source[0]).toMatchObject({
      source: 'workshop',
      net: d('50.00'),
    });
    expect(report.by_revenue_group).toEqual([
      {
        name: 'Parts',
        net: d('50.00'),
        vat: d('10.00'),
        gross: d('60.00'),
      },
    ]);
    expect(report.invoice_count).toBe(1);
  });

  it('uses document net for margin-scheme invoices, not line gross', () => {
    const invoices: RevenueInvoiceRow[] = [
      {
        id: 'margin-1',
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        workshop_order_id: null,
        vehicle_sale_id: 'sale-1',
        global_discount_type: null,
        global_discount_value: null,
        total_net: d('2500.00'),
        total_tax: d('500.00'),
        total_gross: d('3000.00'),
        items: [
          {
            id: 'line-1',
            revenue_group_name: 'Vehicle used (margin)',
            quantity: d('1'),
            unit_price: d('3000.00'),
            line_total: d('3000.00'),
            line_discount_type: null,
            line_discount_value: null,
            tax_rate: d('20'),
          },
        ],
      },
    ];

    const report = aggregateRevenueReport({
      period: { from: '2026-02-01', to: '2026-02-28', timezone: 'Europe/Vienna' },
      site_id: 'site-1',
      invoices,
      creditNotes: [],
    });

    expect(report.by_source.find((row) => row.source === 'vehicle_sales')?.net).toEqual(
      d('2500.00'),
    );
    expect(report.by_revenue_group[0]).toMatchObject({
      name: 'Vehicle used (margin)',
      net: d('2500.00'),
      vat: d('500.00'),
      gross: d('3000.00'),
    });
  });

  it('nets a full credit to zero when line discounts match the credit snapshot', () => {
    const invoices: RevenueInvoiceRow[] = [
      workshopInvoice({
        id: 'inv-disc',
        items: [
          {
            id: 'line-1',
            revenue_group_name: 'Labor',
            quantity: d('2'),
            unit_price: d('25.00'),
            line_total: d('50.00'),
            line_discount_type: DiscountType.PERCENTAGE,
            line_discount_value: d('10'),
            tax_rate: d('20'),
          },
        ],
      }),
    ];
    const creditNotes: RevenueCreditNoteRow[] = [
      {
        id: 'cn-full',
        total_net: d('45.00'),
        total_tax: d('9.00'),
        total_gross: d('54.00'),
        original_invoice: {
          workshop_order_id: 'wo-1',
          vehicle_sale_id: null,
          tax_mode: InvoiceTaxMode.STANDARD,
        },
        items: [
          {
            snapshot: { net: '45.00', tax: '9.00', gross: '54.00' },
            original_invoice_item: { revenue_group_name: 'Labor' },
          },
        ],
      },
    ];

    const report = aggregateRevenueReport({
      period: { from: '2026-03-01', to: '2026-03-31', timezone: 'Europe/Vienna' },
      site_id: 'site-1',
      invoices,
      creditNotes,
    });

    expect(report.totals.net.toFixed(2)).toBe('0.00');
    expect(report.totals.vat.toFixed(2)).toBe('0.00');
    expect(report.totals.gross.toFixed(2)).toBe('0.00');
    expect(report.by_source[0].net.toFixed(2)).toBe('0.00');
    expect(report.by_revenue_group[0].net.toFixed(2)).toBe('0.00');
  });

  it('foots margin revenue when a trade-in reduces the amount due', () => {
    const invoices: RevenueInvoiceRow[] = [
      {
        id: 'margin-trade',
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        workshop_order_id: null,
        vehicle_sale_id: 'sale-2',
        global_discount_type: null,
        global_discount_value: null,
        total_net: d('14500.00'),
        total_tax: d('500.00'),
        total_gross: d('11000.00'),
        items: [
          {
            id: 'line-sale',
            revenue_group_name: 'Vehicle used (margin)',
            quantity: d('1'),
            unit_price: d('15000.00'),
            line_total: d('15000.00'),
            line_discount_type: null,
            line_discount_value: null,
            tax_rate: d('20'),
          },
          {
            id: 'line-trade',
            revenue_group_name: 'Vehicle used (margin)',
            quantity: d('1'),
            unit_price: d('-4000.00'),
            line_total: d('-4000.00'),
            line_discount_type: null,
            line_discount_value: null,
            tax_rate: d('20'),
          },
        ],
      },
    ];

    const report = aggregateRevenueReport({
      period: { from: '2026-04-01', to: '2026-04-30', timezone: 'Europe/Vienna' },
      site_id: 'site-1',
      invoices,
      creditNotes: [],
    });

    expect(report.totals.gross.toFixed(2)).toBe('11000.00');
    expect(report.totals.vat.toFixed(2)).toBe('500.00');
    expect(report.totals.net.toFixed(2)).toBe('10500.00');
    expect(report.totals.net.add(report.totals.vat).toFixed(2)).toBe('11000.00');
  });
});
