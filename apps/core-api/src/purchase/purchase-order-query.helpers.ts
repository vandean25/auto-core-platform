import { NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PaginatedPurchaseOrderResult } from './purchase.service.js';

export function buildLegacyPurchaseOrderWhere(
  tenantId: string,
  siteId: string,
  params?: string,
): Prisma.PurchaseOrderWhereInput {
  const status = typeof params === 'string' ? params : 'all';
  if (status === 'open') {
    return {
      tenant_id: tenantId,
      site_id: siteId,
      status: {
        in: [
          PurchaseOrderStatus.DRAFT,
          PurchaseOrderStatus.SENT,
          PurchaseOrderStatus.PARTIAL,
        ],
      },
    };
  }
  return {
    tenant_id: tenantId,
    site_id: siteId,
  };
}

export function isPurchaseOrderFindManyArgs(
  params?: Prisma.PurchaseOrderFindManyArgs | string,
): params is Prisma.PurchaseOrderFindManyArgs {
  return (
    typeof params === 'object' &&
    params !== null &&
    ('where' in params || 'orderBy' in params || 'skip' in params)
  );
}

export async function executeGetPurchaseOrderItems(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  orderId: string,
) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    include: {
      items: {
        include: { catalog_item: true },
      },
    },
  });

  if (!po) {
    throw new NotFoundException('Purchase Order not found');
  }

  return po.items;
}

export async function executeGetPurchaseOrderItem(
  prisma: PrismaService,
  tenantId: string,
  orderId: string,
  itemId: string,
) {
  const item = await prisma.purchaseOrderItem.findFirst({
    where: {
      id: itemId,
      purchase_order_id: orderId,
      tenant_id: tenantId,
    },
    include: { catalog_item: true },
  });

  if (!item) {
    throw new NotFoundException('Purchase order item not found');
  }

  return item;
}

export async function executeFindOnePurchaseOrder(
  prisma: PrismaService,
  tenantId: string,
  authorizedSiteIds: string[],
  id: string,
) {
  return prisma.purchaseOrder.findFirst({
    where: { id, tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
    include: {
      vendor: { include: { supportedBrands: true } },
      items: {
        include: { catalog_item: true },
      },
    },
  });
}

export async function executeFindAllPurchaseOrders(
  prisma: PrismaService,
  tenantId: string,
  siteId: string,
  params?: Prisma.PurchaseOrderFindManyArgs | string,
): Promise<PaginatedPurchaseOrderResult> {
  if (isPurchaseOrderFindManyArgs(params)) {
    const scopedWhere = {
      ...(params.where ?? {}),
      tenant_id: tenantId,
      site_id: siteId,
    };
    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        ...params,
        where: scopedWhere,
        include: { vendor: true, items: true },
      }),
      prisma.purchaseOrder.count({
        where: scopedWhere,
      }),
    ]);
    return { data, total };
  }

  const where = buildLegacyPurchaseOrderWhere(tenantId, siteId, params);
  const data = await prisma.purchaseOrder.findMany({
    where: { ...where, tenant_id: tenantId, site_id: siteId },
    include: { vendor: true, items: true },
    orderBy: { createdAt: 'desc' },
  });
  return { data, total: data.length };
}
