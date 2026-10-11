import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import {
  purchaseLineNet,
  purchaseOrderNetTotal,
  toMcpPurchaseOrderDetail,
  toMcpPurchaseOrderListRow,
  toMcpVendorRow,
} from './mcp-purchasing-read.mapper.js';
import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const VENDOR_ID = '00000000-0000-4000-8000-0000000000f1';
const PART_ID = '00000000-0000-4000-8000-0000000000c1';
const LINE_ID = '00000000-0000-4000-8000-0000000000d1';
const LINE_ID_2 = '00000000-0000-4000-8000-0000000000d2';
const VENDOR_NAME = 'Musterlieferant Süd GmbH';

const decimal = (value: string) => new Prisma.Decimal(value);

describe('purchaseLineNet', () => {
  it('multiplies quantity by the net unit cost', () => {
    expect(
      purchaseLineNet({
        quantity: decimal('3.000'),
        unit_cost: decimal('12.50'),
      }).toFixed(2),
    ).toBe('37.50');
  });

  it('rounds the line net half-up to the cent', () => {
    expect(
      purchaseLineNet({
        quantity: decimal('1.500'),
        unit_cost: decimal('0.01'),
      }).toFixed(2),
    ).toBe('0.02');
    expect(
      purchaseLineNet({
        quantity: decimal('0.333'),
        unit_cost: decimal('10.00'),
      }).toFixed(2),
    ).toBe('3.33');
  });
});

describe('purchaseOrderNetTotal', () => {
  it('sums line nets that are each rounded to the cent', () => {
    // Each line is 0.005 and rounds up to 0.01 on its own; the unrounded sum would be 0.01.
    const total = purchaseOrderNetTotal([
      { quantity: decimal('0.500'), unit_cost: decimal('0.01') },
      { quantity: decimal('0.500'), unit_cost: decimal('0.01') },
    ]);
    expect(total.toFixed(2)).toBe('0.02');
  });

  it('is zero for an order without lines', () => {
    expect(purchaseOrderNetTotal([]).toFixed(2)).toBe('0.00');
  });
});

describe('toMcpPurchaseOrderListRow', () => {
  it('returns the compact row with the order date and the net total as a EUR string', () => {
    const row = toMcpPurchaseOrderListRow({
      id: ORDER_ID,
      order_number: 'PO-2026-0007',
      status: PurchaseOrderStatus.SENT,
      createdAt: new Date('2026-09-14T08:30:00.000Z'),
      vendor: { id: VENDOR_ID, name: VENDOR_NAME },
      items: [
        { quantity: decimal('2.000'), unit_cost: decimal('15.00') },
        { quantity: decimal('1.000'), unit_cost: decimal('4.25') },
      ],
    });

    expect(row).toEqual({
      id: ORDER_ID,
      number: 'PO-2026-0007',
      status: 'SENT',
      vendor: { id: VENDOR_ID, name: VENDOR_NAME },
      ordered_at: '2026-09-14T08:30:00.000Z',
      total_net: '34.25',
    });
  });

  it('carries no line data in the row', () => {
    const row = toMcpPurchaseOrderListRow({
      id: ORDER_ID,
      order_number: 'PO-2026-0007',
      status: PurchaseOrderStatus.DRAFT,
      createdAt: new Date('2026-09-14T08:30:00.000Z'),
      vendor: { id: VENDOR_ID, name: VENDOR_NAME },
      items: [{ quantity: decimal('1.000'), unit_cost: decimal('1.00') }],
    });

    expect(Object.keys(row).sort()).toEqual(
      ['id', 'number', 'ordered_at', 'status', 'total_net', 'vendor'].sort(),
    );
  });
});

describe('toMcpPurchaseOrderDetail', () => {
  const detailRecord = () => ({
    id: ORDER_ID,
    order_number: 'PO-2026-0007',
    status: PurchaseOrderStatus.PARTIAL,
    createdAt: new Date('2026-09-14T08:30:00.000Z'),
    vendor: { id: VENDOR_ID, name: VENDOR_NAME },
    items: [
      {
        id: LINE_ID,
        quantity: decimal('4.000'),
        quantity_received: decimal('1.500'),
        unit_cost: decimal('6.10'),
        catalog_item: { id: PART_ID, sku: 'FILTER-DEMO-01', name: 'Ölfilter' },
      },
      {
        id: LINE_ID_2,
        quantity: decimal('2.000'),
        quantity_received: decimal('0.000'),
        unit_cost: decimal('3.33'),
        catalog_item: {
          id: PART_ID,
          sku: 'FILTER-DEMO-02',
          name: 'Luftfilter',
        },
      },
    ],
  });

  it('returns lines with quantities as decimal strings and net unit cost and line net', () => {
    const detail = toMcpPurchaseOrderDetail(detailRecord(), {
      movement_count: 0,
      last_received_at: null,
    });

    expect(detail.lines).toEqual([
      {
        id: LINE_ID,
        part: { id: PART_ID, sku: 'FILTER-DEMO-01', name: 'Ölfilter' },
        quantity_ordered: '4.000',
        quantity_received: '1.500',
        unit_cost_net: '6.10',
        line_net: '24.40',
      },
      {
        id: LINE_ID_2,
        part: { id: PART_ID, sku: 'FILTER-DEMO-02', name: 'Luftfilter' },
        quantity_ordered: '2.000',
        quantity_received: '0.000',
        unit_cost_net: '3.33',
        line_net: '6.66',
      },
    ]);
    expect(detail.totals).toEqual({ net: '31.06' });
    expect(detail.currency).toBe('EUR');
    expect(detail.status).toBe('PARTIAL');
    expect(detail.lines_total).toBe(2);
    expect(detail.lines_truncated).toBe(false);
  });

  it('summarizes receipts from the ledger, and reports null when nothing was received', () => {
    const received = toMcpPurchaseOrderDetail(detailRecord(), {
      movement_count: 3,
      last_received_at: new Date('2026-10-02T09:15:00.000Z'),
    });
    expect(received.receipts).toEqual({
      movement_count: 3,
      last_received_at: '2026-10-02T09:15:00.000Z',
    });

    const none = toMcpPurchaseOrderDetail(detailRecord(), {
      movement_count: 0,
      last_received_at: null,
    });
    expect(none.receipts).toEqual({
      movement_count: 0,
      last_received_at: null,
    });
  });

  it('caps the lines to the result size and says how many were left out', () => {
    const record = detailRecord();
    const longName = 'Ersatzteil '.repeat(10).trim();
    record.items = Array.from({ length: 400 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      quantity: decimal('1.000'),
      quantity_received: decimal('0.000'),
      unit_cost: decimal('1.00'),
      catalog_item: { id: PART_ID, sku: `SKU-${index}`, name: longName },
    }));

    const detail = toMcpPurchaseOrderDetail(record, {
      movement_count: 0,
      last_received_at: null,
    });

    expect(detail.lines_total).toBe(400);
    expect(detail.lines_truncated).toBe(true);
    expect(detail.lines.length).toBeLessThan(400);
    expect(
      Buffer.byteLength(JSON.stringify(detail), 'utf8'),
    ).toBeLessThanOrEqual(MCP_TOOL_RESULT_MAX_BYTES);
    // The totals are still the full order, not the lines that fit.
    expect(detail.totals.net).toBe('400.00');
  });
});

describe('toMcpVendorRow', () => {
  it('returns id, name, and active', () => {
    expect(toMcpVendorRow({ id: VENDOR_ID, name: VENDOR_NAME })).toEqual({
      id: VENDOR_ID,
      name: VENDOR_NAME,
      active: true,
    });
  });

  it('never copies bank or contact fields into the row', () => {
    const leaked = {
      id: VENDOR_ID,
      name: VENDOR_NAME,
      account_number: 'AT00 0000 0000 0000 0000',
      email: 'orders@example.invalid',
    };

    const row = toMcpVendorRow(leaked);

    expect(Object.keys(row).sort()).toEqual(['active', 'id', 'name']);
    expect(JSON.stringify(row)).not.toMatch(/AT00|example\.invalid/);
  });
});
