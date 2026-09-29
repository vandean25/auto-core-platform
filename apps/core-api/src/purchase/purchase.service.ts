import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type PurchaseOrderWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { vendor: true; items: true };
}>;

export interface PaginatedPurchaseOrderResult {
  data: PurchaseOrderWithRelations[];
  total: number;
}

export type PurchaseOrderItemInput = {
  catalogItemId: string;
  quantity: number;
  unitCost: number;
};

import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';

export type ReceivedItemInput = {
  itemId: string;
  quantity: number;
  locationId?: string;
};

import { SiteContextService } from '../site/site-context.service.js';
import { PurchaseReceiptService } from './purchase-receipt.service.js';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto.js';
import * as helpers from './purchase-order.helpers.js';

@Injectable()
export class PurchaseService {
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly siteContext: SiteContextService;
  private readonly receiptService: PurchaseReceiptService;

  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    siteContext: SiteContextService,
    receiptService: PurchaseReceiptService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.receiptService = receiptService;
  }

  async createPurchaseOrder(vendorId: string, items: PurchaseOrderItemInput[]) {
    const scope = await this.getScope();
    return helpers.executeCreatePurchaseOrder(
      this.prisma,
      scope[0],
      scope[1],
      vendorId,
      items,
    );
  }

  async receiveItems(orderId: string, receivedItems: ReceivedItemInput[]) {
    const [tenantId, siteId] = await this.getScope();
    await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
    });
    return this.receiptService.receiveItems(orderId, receivedItems);
  }

  async addItemsToPurchaseOrder(
    orderId: string,
    items: { catalogItemId: string; quantity: number; unitCost: number }[],
  ) {
    const [tenantId, siteId] = await this.getScope();
    return helpers.executeAddItemsToPurchaseOrder(
      this.prisma,
      tenantId,
      siteId,
      orderId,
      items,
    );
  }

  async updatePurchaseOrderItem(
    orderId: string,
    itemId: string,
    updates: { quantity?: number; unitCost?: number },
  ) {
    const [tenantId, siteId] = await this.getScope();
    return this.prisma.$transaction((tx) =>
      helpers.executeUpdatePurchaseOrderItem(
        tx,
        orderId,
        itemId,
        tenantId,
        siteId,
        updates,
      ),
    );
  }

  async deleteItemFromPurchaseOrder(orderId: string, itemId: string) {
    const [tenantId, siteId] = await this.getScope();
    return this.prisma.$transaction((tx) =>
      helpers.executeDeleteItemFromPurchaseOrder(
        tx,
        orderId,
        itemId,
        tenantId,
        siteId,
      ),
    );
  }

  async getPurchaseOrderItems(orderId: string) {
    const [tenantId, siteId] = await this.getScope();
    return helpers.executeGetPurchaseOrderItems(
      this.prisma,
      tenantId,
      siteId,
      orderId,
    );
  }

  async getPurchaseOrderItem(orderId: string, itemId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return helpers.executeGetPurchaseOrderItem(
      this.prisma,
      tenantId,
      orderId,
      itemId,
    );
  }

  async findAll(
    params?: Prisma.PurchaseOrderFindManyArgs | string,
  ): Promise<PaginatedPurchaseOrderResult> {
    const [tenantId, siteId] = await this.getScope();
    return helpers.executeFindAllPurchaseOrders(
      this.prisma,
      tenantId,
      siteId,
      params,
    );
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    return helpers.executeFindOnePurchaseOrder(
      this.prisma,
      tenantId,
      authorizedSiteIds,
      id,
    );
  }

  async updatePurchaseOrder(id: string, dto: UpdatePurchaseOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    return helpers.executeUpdatePurchaseOrder(
      this.prisma,
      this.tenantContext,
      tenantId,
      authorizedSiteIds,
      id,
      dto,
    );
  }

  async markAsSent(id: string) {
    const [tenantId, siteId] = await this.getScope();
    const orderAtRequestStart = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });

    return this.prisma.$transaction((tx) =>
      helpers.executeMarkAsSent(
        tx,
        id,
        tenantId,
        siteId,
        Boolean(orderAtRequestStart),
      ),
    );
  }

  async remove(id: string) {
    const [tenantId, siteId] = await this.getScope();
    return this.prisma.$transaction((tx) =>
      helpers.executeRemovePurchaseOrder(tx, id, tenantId, siteId),
    );
  }

  private async getScope(): Promise<[string, string]> {
    return Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
  }
}
