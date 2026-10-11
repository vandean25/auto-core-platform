import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import {
  decodeMcpKeysetCursor,
  encodeMcpKeysetCursor,
} from './mcp-output.util.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000b1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const ORDER_ID_2 = '00000000-0000-4000-8000-0000000000e2';
const ORDER_ID_3 = '00000000-0000-4000-8000-0000000000e3';
const VENDOR_ID = '00000000-0000-4000-8000-0000000000f1';
const VENDOR_ID_2 = '00000000-0000-4000-8000-0000000000f2';
const PART_ID = '00000000-0000-4000-8000-0000000000c1';
const LINE_ID = '00000000-0000-4000-8000-0000000000d1';
const VENDOR_NAME = 'Musterlieferant Süd GmbH';

type Row = Record<string, unknown>;

/** Equality on the top-level keys of a where clause, as the in-memory findFirst needs. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function orderRow(overrides: Row = {}): Row {
  return {
    id: ORDER_ID,
    tenant_id: TENANT_A,
    site_id: SITE_A,
    order_number: 'PO-2026-0007',
    status: 'SENT',
    createdAt: new Date('2026-09-14T08:30:00.000Z'),
    vendor: { id: VENDOR_ID, name: VENDOR_NAME },
    items: [
      {
        id: LINE_ID,
        quantity: new Prisma.Decimal('2.000'),
        quantity_received: new Prisma.Decimal('1.000'),
        unit_cost: new Prisma.Decimal('15.00'),
        catalog_item: { id: PART_ID, sku: 'FILTER-DEMO-01', name: 'Ölfilter' },
      },
    ],
    ...overrides,
  };
}

function build(
  options: {
    tenantId?: string;
    siteId?: string;
    orders?: Row[];
    vendors?: Row[];
    receipts?: { count: number; last: Date | null };
  } = {},
) {
  const orders = options.orders ?? [];
  const prisma = {
    purchaseOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          orders.find((row) => matches(row, where)) ?? null,
      ),
    },
    vendor: {
      findMany: jest.fn().mockResolvedValue(options.vendors ?? []),
    },
    inventoryTransaction: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: options.receipts?.count ?? 0 },
        _max: { createdAt: options.receipts?.last ?? null },
      }),
    },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(options.tenantId ?? TENANT_A),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(options.siteId ?? SITE_A),
  };
  const service = new McpPurchasingReadService(
    prisma as unknown as PrismaService,
    siteContext as unknown as SiteContextService,
    tenantContext as unknown as TenantContextService,
  );
  return { service, prisma, tenantContext, siteContext };
}

describe('McpPurchasingReadService.listPurchaseOrders', () => {
  it('scopes every query to the session tenant and the active site', async () => {
    const { service, prisma, tenantContext, siteContext } = build();

    await service.listPurchaseOrders({});

    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(siteContext.getSiteId).toHaveBeenCalled();
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: TENANT_A, site_id: SITE_A },
      }),
    );
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({
            where: { tenant_id: TENANT_A },
          }),
        }),
      }),
    );
  });

  it('filters by status, vendor, and part', async () => {
    const { service, prisma } = build();

    await service.listPurchaseOrders({
      status: 'SENT',
      vendor_id: VENDOR_ID,
      part_id: PART_ID,
    });

    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: TENANT_A,
          site_id: SITE_A,
          status: 'SENT',
          vendor_id: VENDOR_ID,
          items: {
            some: { tenant_id: TENANT_A, catalog_item_id: PART_ID },
          },
        },
      }),
    );
  });

  it('bounds the order date inclusively by whole UTC days', async () => {
    const { service, prisma } = build();

    await service.listPurchaseOrders({ from: '2026-09-01', to: '2026-09-30' });

    const { where } = prisma.purchaseOrder.findMany.mock.calls[0][0];
    expect(where.createdAt).toEqual({
      gte: new Date('2026-09-01T00:00:00.000Z'),
      lte: new Date('2026-09-30T23:59:59.999Z'),
    });
  });

  it('takes one row more than the page size to detect a next page', async () => {
    const { service, prisma } = build();

    await service.listPurchaseOrders({});
    await service.listPurchaseOrders({ pageSize: 25 });

    expect(prisma.purchaseOrder.findMany.mock.calls[0][0].take).toBe(11);
    expect(prisma.purchaseOrder.findMany.mock.calls[1][0].take).toBe(26);
  });

  it('returns at most the page size and a cursor for the last row kept', async () => {
    const newest = orderRow({
      id: ORDER_ID,
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
    });
    const middle = orderRow({
      id: ORDER_ID_2,
      createdAt: new Date('2026-09-19T00:00:00.000Z'),
    });
    const oldest = orderRow({
      id: ORDER_ID_3,
      createdAt: new Date('2026-09-18T00:00:00.000Z'),
    });
    const { service, prisma } = build();
    prisma.purchaseOrder.findMany.mockResolvedValueOnce([
      newest,
      middle,
      oldest,
    ]);

    const page = await service.listPurchaseOrders({ pageSize: 2 });

    expect(page.data.map((row) => row.id)).toEqual([ORDER_ID, ORDER_ID_2]);
    expect(page.meta.page_size).toBe(2);
    expect(page.truncated).toBe(false);
    expect(decodeMcpKeysetCursor(page.meta.next_cursor ?? '')).toEqual({
      at: '2026-09-19T00:00:00.000Z',
      id: ORDER_ID_2,
    });
  });

  it('resumes after the cursor with newest-first keyset conditions', async () => {
    const { service, prisma } = build();
    const cursor = encodeMcpKeysetCursor({
      at: '2026-09-19T00:00:00.000Z',
      id: ORDER_ID_2,
    });

    await service.listPurchaseOrders({ cursor });

    const { where, orderBy } = prisma.purchaseOrder.findMany.mock.calls[0][0];
    expect(where.AND).toEqual([
      {
        OR: [
          { createdAt: { lt: new Date('2026-09-19T00:00:00.000Z') } },
          {
            createdAt: new Date('2026-09-19T00:00:00.000Z'),
            id: { lt: ORDER_ID_2 },
          },
        ],
      },
    ]);
    expect(orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('rejects a malformed cursor before any query runs', async () => {
    const { service, prisma } = build();

    await expect(
      service.listPurchaseOrders({ cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchaseOrder.findMany).not.toHaveBeenCalled();
  });

  it('returns compact rows with the net total as a EUR string', async () => {
    const { service, prisma } = build();
    prisma.purchaseOrder.findMany.mockResolvedValueOnce([orderRow()]);

    const page = await service.listPurchaseOrders({});

    expect(page.data).toEqual([
      {
        id: ORDER_ID,
        number: 'PO-2026-0007',
        status: 'SENT',
        vendor: { id: VENDOR_ID, name: VENDOR_NAME },
        ordered_at: '2026-09-14T08:30:00.000Z',
        total_net: '30.00',
      },
    ]);
  });

  it('is bound to the session tenant, so another tenant orders are not listed', async () => {
    const { service, prisma } = build({ tenantId: TENANT_B });

    await service.listPurchaseOrders({});

    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: TENANT_B }),
      }),
    );
  });
});

describe('McpPurchasingReadService.getPurchaseOrder', () => {
  it('returns the order with lines, totals, vendor, and the receipt summary', async () => {
    const { service, prisma } = build({
      orders: [orderRow()],
      receipts: { count: 2, last: new Date('2026-10-02T09:15:00.000Z') },
    });

    const detail = await service.getPurchaseOrder({
      id: ORDER_ID,
    });

    expect(detail).toMatchObject({
      id: ORDER_ID,
      number: 'PO-2026-0007',
      status: 'SENT',
      currency: 'EUR',
      vendor: { id: VENDOR_ID, name: VENDOR_NAME },
      totals: { net: '30.00' },
      receipts: {
        movement_count: 2,
        last_received_at: '2026-10-02T09:15:00.000Z',
      },
    });
    expect(detail.lines).toEqual([
      {
        id: LINE_ID,
        part: { id: PART_ID, sku: 'FILTER-DEMO-01', name: 'Ölfilter' },
        quantity_ordered: '2.000',
        quantity_received: '1.000',
        unit_cost_net: '15.00',
        line_net: '30.00',
      },
    ]);
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ORDER_ID, tenant_id: TENANT_A, site_id: SITE_A },
      }),
    );
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          items: expect.objectContaining({
            where: { tenant_id: TENANT_A },
          }),
        }),
      }),
    );
  });

  it('reads receipts as PURCHASE_RECEIPT ledger rows of this order at this site', async () => {
    const { service, prisma } = build({ orders: [orderRow()] });

    await service.getPurchaseOrder({ id: ORDER_ID });

    expect(prisma.inventoryTransaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: TENANT_A,
          site_id: SITE_A,
          type: 'PURCHASE_RECEIPT',
          reference_id: 'PO-2026-0007',
        },
      }),
    );
  });

  it('reports no receipts when the order has none', async () => {
    const { service } = build({ orders: [orderRow()] });

    const detail = await service.getPurchaseOrder({
      id: ORDER_ID,
    });

    expect(detail.receipts).toEqual({
      movement_count: 0,
      last_received_at: null,
    });
  });

  it('does not find an order of another tenant', async () => {
    const { service } = build({ tenantId: TENANT_B, orders: [orderRow()] });

    await expect(
      service.getPurchaseOrder({ id: ORDER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not find an order at another site', async () => {
    const { service } = build({ siteId: SITE_B, orders: [orderRow()] });

    await expect(
      service.getPurchaseOrder({ id: ORDER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not find another tenant order even when the site ID matches', async () => {
    const { service } = build({
      tenantId: TENANT_B,
      siteId: SITE_B,
      orders: [orderRow({ tenant_id: TENANT_A, site_id: SITE_B })],
    });

    await expect(
      service.getPurchaseOrder({ id: ORDER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('McpPurchasingReadService.listVendors', () => {
  it('scopes the list to the session tenant and selects only id, name, and creation time', async () => {
    const { service, prisma, tenantContext } = build();

    await service.listVendors({});

    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(prisma.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: TENANT_A },
        select: { id: true, name: true, createdAt: true },
      }),
    );
  });

  it('pages newest first with one row more than the page size', async () => {
    const { service, prisma } = build();

    await service.listVendors({});
    await service.listVendors({ pageSize: 25 });

    expect(prisma.vendor.findMany.mock.calls[0][0]).toMatchObject({
      take: 11,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(prisma.vendor.findMany.mock.calls[1][0].take).toBe(26);
  });

  it('returns rows of id, name, and active, with a cursor when more vendors exist', async () => {
    const vendors = [
      {
        id: VENDOR_ID,
        name: VENDOR_NAME,
        createdAt: new Date('2026-09-02T00:00:00.000Z'),
      },
      {
        id: VENDOR_ID_2,
        name: 'Musterlieferant Nord GmbH',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ];
    const { service } = build({ vendors });

    const page = await service.listVendors({ pageSize: 1 });

    expect(page.data).toEqual([
      { id: VENDOR_ID, name: VENDOR_NAME, active: true },
    ]);
    expect(decodeMcpKeysetCursor(page.meta.next_cursor ?? '')).toEqual({
      at: '2026-09-02T00:00:00.000Z',
      id: VENDOR_ID,
    });
  });

  it('never returns bank or contact fields, even if the query returned them', async () => {
    const { service } = build({
      vendors: [
        {
          id: VENDOR_ID,
          name: VENDOR_NAME,
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
          account_number: 'AT00 0000 0000 0000 0000',
          email: 'orders@example.invalid',
        },
      ],
    });

    const page = await service.listVendors({});

    expect(JSON.stringify(page)).not.toMatch(/AT00|example\.invalid/);
  });

  it('is bound to the session tenant, so another tenant vendors are not listed', async () => {
    const { service, prisma } = build({ tenantId: TENANT_B });

    await service.listVendors({});

    expect(prisma.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenant_id: TENANT_B } }),
    );
  });

  it('rejects a malformed cursor before any query runs', async () => {
    const { service, prisma } = build();

    await expect(service.listVendors({ cursor: 'bad' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.vendor.findMany).not.toHaveBeenCalled();
  });
});
