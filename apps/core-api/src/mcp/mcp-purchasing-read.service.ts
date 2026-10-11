import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionType, type Prisma } from '@prisma/client';
import type { z } from 'zod';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MCP_DEFAULT_PAGE_SIZE } from './mcp.constants.js';
import { buildMcpKeysetPage, keysetCursorOf } from './mcp-audit-read.mapper.js';
import {
  toMcpPurchaseOrderDetail,
  toMcpPurchaseOrderListRow,
  toMcpVendorRow,
  type McpPurchaseOrderReceipts,
} from './mcp-purchasing-read.mapper.js';
import {
  decodeMcpKeysetCursor,
  normalizeMcpRangeEnd,
  normalizeMcpRangeStart,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import type {
  getPurchaseOrderInputSchema,
  listPurchaseOrdersInputSchema,
  listVendorsInputSchema,
} from './mcp-tool-schemas.js';

type ListPurchaseOrdersInput = z.infer<typeof listPurchaseOrdersInputSchema>;
type GetPurchaseOrderInput = z.infer<typeof getPurchaseOrderInputSchema>;
type ListVendorsInput = z.infer<typeof listVendorsInputSchema>;

const PURCHASE_ORDERS_NEWEST_FIRST: Prisma.PurchaseOrderOrderByWithRelationInput[] =
  [{ createdAt: 'desc' }, { id: 'desc' }];

const VENDORS_NEWEST_FIRST: Prisma.VendorOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

const VENDOR_SELECT = { id: true, name: true } as const;

function decodeCursorOrThrow(cursor: string): McpKeysetCursor {
  const decoded = decodeMcpKeysetCursor(cursor);
  if (!decoded) {
    throw new BadRequestException('cursor is invalid');
  }
  return decoded;
}

/** Purchase orders strictly older than the cursor, for newest-first pages. */
function purchaseOrdersOlderThan(
  cursor: McpKeysetCursor,
): Prisma.PurchaseOrderWhereInput {
  const at = new Date(cursor.at);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

/** Vendors strictly older than the cursor, for newest-first pages. */
function vendorsOlderThan(cursor: McpKeysetCursor): Prisma.VendorWhereInput {
  const at = new Date(cursor.at);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

/** Line items are read for the list only to total them, so the select carries no part data. */
function purchaseOrderListSelect(tenantId: string) {
  return {
    id: true,
    order_number: true,
    status: true,
    createdAt: true,
    vendor: { select: VENDOR_SELECT },
    items: {
      where: { tenant_id: tenantId },
      select: { quantity: true, unit_cost: true },
    },
  } as const;
}

/**
 * Read-only purchasing tools. Purchase orders are scoped by the session tenant and
 * the active site (ADR-0022), as the purchase list is. Vendors are tenant-wide master
 * data, so the vendor list is scoped by tenant only. Amounts are net EUR strings.
 */
@Injectable()
export class McpPurchasingReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listPurchaseOrders(input: ListPurchaseOrdersInput) {
    const { tenantId, siteId } = await this.purchaseOrderScope();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;

    const where: Prisma.PurchaseOrderWhereInput = {
      tenant_id: tenantId,
      site_id: siteId,
    };
    if (input.status) {
      where.status = input.status;
    }
    if (input.vendor_id) {
      where.vendor_id = input.vendor_id;
    }
    if (input.part_id) {
      where.items = {
        some: { tenant_id: tenantId, catalog_item_id: input.part_id },
      };
    }
    if (input.from || input.to) {
      where.createdAt = {
        ...(input.from
          ? { gte: new Date(normalizeMcpRangeStart(input.from)) }
          : {}),
        ...(input.to ? { lte: new Date(normalizeMcpRangeEnd(input.to)) } : {}),
      };
    }
    if (input.cursor) {
      where.AND = [purchaseOrdersOlderThan(decodeCursorOrThrow(input.cursor))];
    }

    const records = await this.prisma.purchaseOrder.findMany({
      where,
      orderBy: PURCHASE_ORDERS_NEWEST_FIRST,
      take: pageSize + 1,
      select: purchaseOrderListSelect(tenantId),
    });
    return buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.createdAt, record.id),
      mapRow: toMcpPurchaseOrderListRow,
    });
  }

  async getPurchaseOrder(input: GetPurchaseOrderInput) {
    const { tenantId, siteId } = await this.purchaseOrderScope();
    const order = await this.prisma.purchaseOrder.findFirst({
      where: {
        id: input.id,
        tenant_id: tenantId,
        site_id: siteId,
      },
      select: {
        id: true,
        order_number: true,
        status: true,
        createdAt: true,
        vendor: { select: VENDOR_SELECT },
        items: {
          where: { tenant_id: tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            quantity: true,
            quantity_received: true,
            unit_cost: true,
            catalog_item: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(
        `Purchase order with ID ${input.id} not found`,
      );
    }

    const receipts = await this.receiptSummary(
      order.order_number,
      tenantId,
      siteId,
    );
    return toMcpPurchaseOrderDetail(order, receipts);
  }

  async listVendors(input: ListVendorsInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;

    const where: Prisma.VendorWhereInput = { tenant_id: tenantId };
    if (input.cursor) {
      where.AND = [vendorsOlderThan(decodeCursorOrThrow(input.cursor))];
    }

    // Only id, name, and createdAt are selected: bank and contact fields never leave the database here.
    const records = await this.prisma.vendor.findMany({
      where,
      orderBy: VENDORS_NEWEST_FIRST,
      take: pageSize + 1,
      select: { id: true, name: true, createdAt: true },
    });
    return buildMcpKeysetPage({
      records,
      pageSize,
      cursorOf: (record) => keysetCursorOf(record.createdAt, record.id),
      mapRow: toMcpVendorRow,
    });
  }

  /**
   * Receipt movements for the order: PURCHASE_RECEIPT ledger rows at the order's site
   * that carry the order number as their reference. Receipt lines are on each order line.
   */
  private async receiptSummary(
    orderNumber: string,
    tenantId: string,
    siteId: string,
  ): Promise<McpPurchaseOrderReceipts> {
    const summary = await this.prisma.inventoryTransaction.aggregate({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        type: TransactionType.PURCHASE_RECEIPT,
        reference_id: orderNumber,
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    return {
      movement_count: summary._count._all,
      last_received_at: summary._max.createdAt,
    };
  }

  private async purchaseOrderScope(): Promise<{
    tenantId: string;
    siteId: string;
  }> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }
}
