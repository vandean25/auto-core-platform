import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AuditLogAction,
  Prisma,
  StockAdjustmentReason,
  StockAdjustmentValueSource,
  TransactionType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  PermissionResolver,
  legacyAccessOfRole,
  type EffectiveAccess,
} from '../permissions/permission-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { assertCanMutateInventoryStock } from './inventory-access.guards.js';
import {
  computeExtendedValue,
  roundUnitCost,
} from './inventory-valuation.math.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import {
  LedgerService,
  STOCK_ENABLED_LOCATION_TYPES,
} from './ledger.service.js';
import { AdjustInventoryStockDto } from './dto/adjust-inventory-stock.dto.js';
import { ReceiveInventoryStockDto } from './dto/receive-inventory-stock.dto.js';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';
import { toCatalogItemResponseDto } from './catalog-item-response.mapper.js';
import type {
  AdjustmentValuationResponseDto,
  InventoryTransactionResponseDto,
} from './dto/inventory-response.dto.js';

import Decimal = Prisma.Decimal;

const MANUAL_RECEIPT_REFERENCE = 'manual-receipt';
const MANUAL_ADJUSTMENT_REFERENCE = 'manual-adjustment';
const MANUAL_ADJUSTMENT_REVERSAL_REFERENCE = 'manual-adjustment-reversal';

@Injectable()
export class InventoryItemMutationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly valuationService: InventoryValuationService,
    @Optional()
    @Inject(PermissionResolver)
    private readonly permissionResolver?: PermissionResolver,
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

  async getAdjustmentValuation(
    itemId: string,
    locationId: string,
  ): Promise<AdjustmentValuationResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const access = await this.resolveMemberAccess(tenantId);
    if (!access.permissions.has('stock.adjust')) {
      throw new ForbiddenException(
        'Only OWNER or ADMIN can receive, adjust, or edit inventory items.',
      );
    }

    await this.requireCatalogItem(tenantId, itemId);
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const legalEntityId = await this.resolveLegalEntityForLocation(
      this.prisma,
      tenantId,
      locationId,
      authorizedSiteIds,
    );

    const resolved = await this.resolveAutomaticAdjustmentCost(
      this.prisma,
      tenantId,
      legalEntityId,
      itemId,
    );

    return {
      unitCost: resolved.unitCost ? resolved.unitCost.toString() : null,
      valueSource: resolved.valueSource ?? StockAdjustmentValueSource.MANUAL,
      canOverrideValue: access.permissions.has('stock.adjust.override_value'),
    };
  }

  async adjustStock(itemId: string, dto: AdjustInventoryStockDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const access = await this.resolveMemberAccess(tenantId);
    if (!access.permissions.has('stock.adjust')) {
      throw new ForbiddenException(
        'Only OWNER or ADMIN can receive, adjust, or edit inventory items.',
      );
    }
    if (dto.quantity === 0) {
      throw new BadRequestException('Adjustment quantity must not be zero.');
    }
    const trimmedNote = dto.note?.trim() || null;
    if (dto.reason === StockAdjustmentReason.OTHER && !trimmedNote) {
      throw new BadRequestException(
        'A note is required when adjustment reason is OTHER.',
      );
    }

    await this.requireCatalogItem(tenantId, itemId);
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const createdByUserId = await this.resolveInternalUserId();

    await this.prisma.$transaction(async (tx) => {
      const legalEntityId = await this.resolveLegalEntityForLocation(
        tx,
        tenantId,
        dto.locationId,
        authorizedSiteIds,
      );
      const auto = await this.resolveAutomaticAdjustmentCost(
        tx,
        tenantId,
        legalEntityId,
        itemId,
      );

      const { unitCost, valueSource, overrideReason } =
        this.resolveAdjustmentCostAndSource(dto, auto, access);

      await this.ledgerService.recordTransactions(
        [
          {
            itemId,
            locationId: dto.locationId,
            quantity: dto.quantity,
            type: TransactionType.ADJUSTMENT,
            referenceId: MANUAL_ADJUSTMENT_REFERENCE,
            costBasis: unitCost,
            reason: dto.reason,
            note: trimmedNote,
            valueSource,
            overrideReason,
            createdByUserId,
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
            reason: dto.reason,
            note: trimmedNote,
            unitCost: unitCost.toString(),
            valueSource,
            overrideReason,
            transactionType: TransactionType.ADJUSTMENT,
          },
        },
        tx,
      );
    });
  }

  async reverseTransaction(
    transactionId: string,
  ): Promise<InventoryTransactionResponseDto> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const access = await this.resolveMemberAccess(tenantId);
    if (!access.permissions.has('stock.adjust')) {
      throw new ForbiddenException(
        'Only OWNER or ADMIN can receive, adjust, or edit inventory items.',
      );
    }

    const createdByUserId = await this.resolveInternalUserId();

    return await this.prisma.$transaction(async (tx) => {
      const original = await tx.inventoryTransaction.findFirst({
        where: { id: transactionId, tenant_id: tenantId, site_id: siteId },
        include: {
          reversed_by: { select: { id: true } },
        },
      });
      if (!original) {
        throw new NotFoundException(
          `Inventory transaction ${transactionId} not found`,
        );
      }
      if (original.type !== TransactionType.ADJUSTMENT) {
        throw new BadRequestException(
          'Only stock adjustments can be reversed.',
        );
      }
      if (original.reversal_of_transaction_id !== null) {
        throw new BadRequestException(
          'A reversal transaction cannot be reversed.',
        );
      }
      if (original.reversed_by.length > 0) {
        throw new ConflictException(
          'This stock adjustment has already been reversed.',
        );
      }

      const oppositeQty = new Decimal(original.quantity).neg();

      await this.ledgerService.recordTransactions(
        [
          {
            itemId: original.item_id,
            locationId: original.location_id,
            quantity: oppositeQty,
            type: TransactionType.ADJUSTMENT,
            referenceId: MANUAL_ADJUSTMENT_REVERSAL_REFERENCE,
            costBasis: original.cost_basis,
            reason: original.reason,
            note: original.note,
            valueSource: original.value_source,
            overrideReason: original.override_reason,
            createdByUserId,
            reversalOfTransactionId: original.id,
          },
        ],
        tx,
      );

      const reversal = await tx.inventoryTransaction.findFirstOrThrow({
        where: {
          tenant_id: tenantId,
          reversal_of_transaction_id: original.id,
        },
        include: {
          item: { select: { sku: true, name: true } },
          location: { select: { name: true } },
        },
      });

      await this.auditService.recordTenantMutation(
        {
          entityType: 'CATALOG_ITEM',
          entityId: original.item_id,
          action: AuditLogAction.UPDATE,
          source: 'inventory.adjustment_reversal',
          after: {
            originalTransactionId: original.id,
            reversalTransactionId: reversal.id,
            locationId: original.location_id,
            quantity: reversal.quantity.toString(),
            costBasis: reversal.cost_basis?.toString() ?? null,
          },
        },
        tx,
      );

      return {
        id: reversal.id,
        quantity: reversal.quantity.toString(),
        type: reversal.type,
        reference_id: reversal.reference_id,
        cost_basis: reversal.cost_basis?.toString() ?? null,
        extended_value:
          reversal.cost_basis !== null
            ? computeExtendedValue(
                reversal.quantity,
                reversal.cost_basis,
              ).toString()
            : null,
        reason: reversal.reason,
        note: reversal.note,
        value_source: reversal.value_source,
        override_reason: reversal.override_reason,
        created_by_user_id: reversal.created_by_user_id,
        reversal_of_transaction_id: reversal.reversal_of_transaction_id,
        reversed_by_transaction_id: null,
        createdAt: reversal.createdAt,
        item: reversal.item,
        location: reversal.location,
      };
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

      return toCatalogItemResponseDto(updated);
    });
  }

  private resolveAdjustmentCostAndSource(
    dto: AdjustInventoryStockDto,
    auto: {
      unitCost: Decimal | null;
      valueSource: StockAdjustmentValueSource | null;
    },
    access: EffectiveAccess,
  ): {
    unitCost: Decimal;
    valueSource: StockAdjustmentValueSource;
    overrideReason: string | null;
  } {
    if (dto.unitCost !== undefined) {
      const submittedCost = roundUnitCost(new Decimal(dto.unitCost));
      const trimmedOverride = dto.overrideReason?.trim() || null;
      if (
        auto.unitCost === null ||
        !submittedCost.equals(auto.unitCost) ||
        Boolean(trimmedOverride)
      ) {
        if (!access.permissions.has('stock.adjust.override_value')) {
          throw new ForbiddenException(
            'Missing permission stock.adjust.override_value to set a manual adjustment value.',
          );
        }
        if (!trimmedOverride) {
          throw new BadRequestException(
            'overrideReason is required when overriding the adjustment value.',
          );
        }
        return {
          unitCost: submittedCost,
          valueSource: StockAdjustmentValueSource.MANUAL,
          overrideReason: trimmedOverride,
        };
      }

      return {
        unitCost: auto.unitCost,
        valueSource: auto.valueSource!,
        overrideReason: null,
      };
    }

    if (auto.unitCost === null || auto.valueSource === null) {
      throw new BadRequestException(
        'Unit cost is required when no valuation or last purchase cost exists.',
      );
    }

    return {
      unitCost: auto.unitCost,
      valueSource: auto.valueSource,
      overrideReason: null,
    };
  }

  private async resolveAutomaticAdjustmentCost(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    legalEntityId: string,
    itemId: string,
  ): Promise<{
    unitCost: Decimal | null;
    valueSource: StockAdjustmentValueSource | null;
  }> {
    const valuation = await tx.inventoryValuation.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        catalog_item_id: itemId,
      },
      select: { average_unit_cost: true },
    });

    if (valuation?.average_unit_cost != null) {
      return {
        unitCost: roundUnitCost(new Decimal(valuation.average_unit_cost)),
        valueSource: StockAdjustmentValueSource.AVG,
      };
    }

    const lastEk = await this.valuationService.resolveLastEk(
      tx,
      tenantId,
      legalEntityId,
      itemId,
    );
    if (lastEk !== null) {
      return {
        unitCost: roundUnitCost(lastEk),
        valueSource: StockAdjustmentValueSource.LAST_EK,
      };
    }

    return { unitCost: null, valueSource: null };
  }

  private async resolveLegalEntityForLocation(
    tx: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    locationId: string,
    authorizedSiteIds: readonly string[],
  ): Promise<string> {
    const location = await tx.storageLocation.findFirst({
      where: {
        tenant_id: tenantId,
        id: locationId,
        site_id: { in: [...authorizedSiteIds] },
      },
      select: { id: true, site_id: true, type: true, name: true },
    });
    if (!location) {
      throw new BadRequestException(`Location ${locationId} not found`);
    }
    if (!STOCK_ENABLED_LOCATION_TYPES.has(location.type)) {
      throw new BadRequestException(
        `Stock can only be stored in ${[...STOCK_ENABLED_LOCATION_TYPES]
          .map((type) => type.toUpperCase())
          .join(' or ')} locations. Current type: ${location.type} (${
          location.name
        })`,
      );
    }
    const site = await tx.site.findFirst({
      where: { tenant_id: tenantId, id: location.site_id },
      select: { legal_entity_id: true },
    });
    if (!site?.legal_entity_id) {
      throw new BadRequestException(
        `Site ${location.site_id} is missing a legal entity`,
      );
    }
    return site.legal_entity_id;
  }

  private async resolveMemberAccess(
    tenantId: string,
  ): Promise<EffectiveAccess> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (this.permissionResolver && authUser?.userId) {
      const resolved = await this.permissionResolver.resolve(authUser, {
        userId: authUser.userId,
        tenantId,
      });
      if (resolved) {
        return resolved;
      }
    }
    return legacyAccessOfRole(authUser?.role);
  }

  private async resolveInternalUserId(): Promise<string | null> {
    const firebaseUid = this.tenantContext.getAuthenticatedUser()?.userId;
    if (!firebaseUid) return null;
    const user = await this.prisma.user.findFirst({
      where: { firebaseUid },
      select: { id: true },
    });
    return user?.id ?? null;
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
