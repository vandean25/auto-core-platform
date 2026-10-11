import { Prisma, type PurchaseOrderStatus } from '@prisma/client';
import { fitMcpRowsToCap } from './mcp-output.util.js';

/** Amounts are EUR decimal strings. Purchase orders carry no tax, so every amount is net. */
export type McpPurchaseOrderVendor = { id: string; name: string };

export type McpPurchaseOrderItemRecord = {
  id: string;
  quantity: Prisma.Decimal;
  quantity_received: Prisma.Decimal;
  unit_cost: Prisma.Decimal;
  catalog_item: { id: string; sku: string; name: string };
};

export type McpPurchaseOrderListRecord = {
  id: string;
  order_number: string;
  status: PurchaseOrderStatus;
  createdAt: Date;
  vendor: McpPurchaseOrderVendor;
  items: Array<Pick<McpPurchaseOrderItemRecord, 'quantity' | 'unit_cost'>>;
};

export type McpPurchaseOrderDetailRecord = {
  id: string;
  order_number: string;
  status: PurchaseOrderStatus;
  createdAt: Date;
  vendor: McpPurchaseOrderVendor;
  items: McpPurchaseOrderItemRecord[];
};

/** PURCHASE_RECEIPT ledger rows booked against the order, and the newest of them. */
export type McpPurchaseOrderReceipts = {
  movement_count: number;
  last_received_at: Date | null;
};

export type McpPurchaseOrderLine = {
  id: string;
  part: { id: string; sku: string; name: string };
  quantity_ordered: string;
  quantity_received: string;
  unit_cost_net: string;
  line_net: string;
};

/** Net amount of one line: quantity times net unit cost, rounded half-up to the cent. */
export function purchaseLineNet(
  item: Pick<McpPurchaseOrderItemRecord, 'quantity' | 'unit_cost'>,
): Prisma.Decimal {
  return item.quantity
    .mul(item.unit_cost)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Net total of an order: the sum of its line nets, each already rounded to the cent. */
export function purchaseOrderNetTotal(
  items: ReadonlyArray<
    Pick<McpPurchaseOrderItemRecord, 'quantity' | 'unit_cost'>
  >,
): Prisma.Decimal {
  return items.reduce(
    (total, item) => total.add(purchaseLineNet(item)),
    new Prisma.Decimal(0),
  );
}

/** Compact list row: no lines, and the net total as a EUR decimal string. */
export function toMcpPurchaseOrderListRow(record: McpPurchaseOrderListRecord) {
  return {
    id: record.id,
    number: record.order_number,
    status: record.status,
    vendor: { id: record.vendor.id, name: record.vendor.name },
    ordered_at: record.createdAt.toISOString(),
    total_net: purchaseOrderNetTotal(record.items).toFixed(2),
  };
}

function toMcpPurchaseOrderLine(
  item: McpPurchaseOrderItemRecord,
): McpPurchaseOrderLine {
  return {
    id: item.id,
    part: {
      id: item.catalog_item.id,
      sku: item.catalog_item.sku,
      name: item.catalog_item.name,
    },
    quantity_ordered: item.quantity.toFixed(3),
    quantity_received: item.quantity_received.toFixed(3),
    unit_cost_net: item.unit_cost.toFixed(2),
    line_net: purchaseLineNet(item).toFixed(2),
  };
}

/**
 * Detail for one order. Lines are capped to the result size like invoice lines:
 * `lines_truncated` says some did not fit, and `lines_total` is the full count.
 */
export function toMcpPurchaseOrderDetail(
  record: McpPurchaseOrderDetailRecord,
  receipts: McpPurchaseOrderReceipts,
) {
  const lines = record.items.map(toMcpPurchaseOrderLine);
  const detail = {
    id: record.id,
    number: record.order_number,
    status: record.status,
    currency: 'EUR',
    ordered_at: record.createdAt.toISOString(),
    vendor: { id: record.vendor.id, name: record.vendor.name },
    totals: { net: purchaseOrderNetTotal(record.items).toFixed(2) },
    receipts: {
      movement_count: receipts.movement_count,
      last_received_at: receipts.last_received_at?.toISOString() ?? null,
    },
  };
  const withLines = (kept: readonly McpPurchaseOrderLine[]) => ({
    ...detail,
    lines: kept,
    lines_total: lines.length,
    lines_truncated: kept.length < lines.length,
  });
  return withLines(fitMcpRowsToCap(lines, withLines).rows);
}

/**
 * Vendor row: id, name, and active. The vendor model has no deactivation flag and
 * removing a vendor deletes its row, so every listed vendor is active. Bank data
 * (the account number) and the contact email are never part of the row.
 */
export function toMcpVendorRow(record: { id: string; name: string }) {
  return { id: record.id, name: record.name, active: true };
}
