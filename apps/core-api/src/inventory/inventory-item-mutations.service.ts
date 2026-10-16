import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogAction, TransactionType } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertCanMutateInventoryStock } from './inventory-access.guards.js';
import { LedgerService } from './ledger.service.js';
import { AdjustInventoryStockDto } from './dto/adjust-inventory-stock.dto.js';
import { ReceiveInventoryStockDto } from './dto/receive-inventory-stock.dto.js';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';

const MANUAL_RECEIPT_REFERENCE = 'manual-receipt';
const MANUAL_ADJUSTMENT_REFERENCE = 'manual-adjustment';

function normalizeAdjustmentReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new BadRequestException('Adjustment reason is required.');
  }
  return trimmed;
}

@Injectable()
export class InventoryItemMutationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async receiveStock(itemId: string, dto: ReceiveInventoryStockDto) {
    assertCanMutateInventoryStock(
      this.tenantContext.getAuthenticatedUser()?.role,
    );
    const tenantId = await this.tenantContext.getTenantId();
    const item = await this.requireCatalogItem(tenantId, itemId);
    const costBasis = item.cost_price ? Number(item.cost_price) : null;

    await this.prisma.$transaction(async (tx) => {
      await this.ledgerService.recordTransactions(
        [
          {
            itemId,
            locationId: dto.locationId,
            quantity: dto.quantity,
            type: TransactionType.PURCHASE_RECEIPT,
            referenceId: MANUAL_RECEIPT_REFERENCE,
            costBasis,
          },
        ],
        tx,
      );

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CATALOG_ITEM',
          entityId: itemId,
          action: AuditLogAction.UPDATE,
          source: 'inventory.manual_receive',
          after: {
            locationId: dto.locationId,
            quantity: dto.quantity,
            transactionType: TransactionType.PURCHASE_RECEIPT,
          },
        },
        tx,
      );
    });
  }

  async adjustStock(itemId: string, dto: AdjustInventoryStockDto) {
    assertCanMutateInventoryStock(
      this.tenantContext.getAuthenticatedUser()?.role,
    );
    if (dto.quantity === 0) {
      throw new BadRequestException('Adjustment quantity must not be zero.');
    }
    const reason = normalizeAdjustmentReason(dto.reason);

    const tenantId = await this.tenantContext.getTenantId();
    await this.requireCatalogItem(tenantId, itemId);

    await this.prisma.$transaction(async (tx) => {
      await this.ledgerService.recordTransactions(
        [
          {
            itemId,
            locationId: dto.locationId,
            quantity: dto.quantity,
            type: TransactionType.ADJUSTMENT,
            referenceId: MANUAL_ADJUSTMENT_REFERENCE,
          },
        ],
        tx,
      );

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CATALOG_ITEM',
          entityId: itemId,
          action: AuditLogAction.UPDATE,
          source: 'inventory.adjustment',
          after: {
            locationId: dto.locationId,
            quantity: dto.quantity,
            reason,
            transactionType: TransactionType.ADJUSTMENT,
          },
        },
        tx,
      );
    });
  }

  async updateItem(itemId: string, dto: UpdateInventoryItemDto) {
    assertCanMutateInventoryStock(
      this.tenantContext.getAuthenticatedUser()?.role,
    );
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.requireCatalogItem(tenantId, itemId);

    if (dto.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: dto.brandId, tenant_id: tenantId },
      });
      if (!brand) {
        throw new BadRequestException(
          `Brand with ID ${dto.brandId} does not exist`,
        );
      }
    }

    const skuTaken = await this.prisma.catalogItem.findFirst({
      where: {
        tenant_id: tenantId,
        sku: dto.sku,
        id: { not: itemId },
      },
      select: { id: true },
    });
    if (skuTaken) {
      throw new BadRequestException(
        `Catalog item with SKU ${dto.sku} already exists`,
      );
    }

    const before = {
      sku: existing.sku,
      name: existing.name,
      cost_price: existing.cost_price,
      retail_price: existing.retail_price,
      brand_id: existing.brand_id,
    };

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.catalogItem.update({
        where: { id: itemId, tenant_id: tenantId },
        data: {
          sku: dto.sku,
          name: dto.name,
          cost_price: dto.cost_price,
          retail_price: dto.retail_price,
          brand_id: dto.brandId ?? null,
        },
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CATALOG_ITEM',
          entityId: itemId,
          action: AuditLogAction.UPDATE,
          source: 'inventory.item_edit',
          before,
          after: {
            sku: updated.sku,
            name: updated.name,
            cost_price: updated.cost_price,
            retail_price: updated.retail_price,
            brand_id: updated.brand_id,
          },
        },
        tx,
      );

      return updated;
    });
  }

  private async requireCatalogItem(tenantId: string, itemId: string) {
    const item = await this.prisma.catalogItem.findFirst({
      where: { id: itemId, tenant_id: tenantId },
    });
    if (!item) {
      throw new NotFoundException(`Catalog item ${itemId} not found`);
    }
    return item;
  }
}
