import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  Prisma,
  VehicleAcquisitionKind,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleSaleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { AuditService } from '../audit/audit.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { VehicleSaleService } from './vehicle-sale.service.js';
import { generateNextVehiclePurchaseNumber } from './vehicle-purchase.helpers.js';
import {
  assertTradeInFirstRegistrationNotFuture,
  assertTradeInIsNotSoldVehicle,
  assertValidTradeInAllowance,
} from './vehicle-trade-in.js';
import type { UpsertVehicleSaleTradeInDto } from './dto/upsert-vehicle-sale-trade-in.dto.js';

const TRADE_IN_CHANGED_MESSAGE =
  'Trade-in vehicle changed concurrently. Please refresh.';
const SALE_CHANGED_MESSAGE =
  'Vehicle sale state or site changed concurrently. Please refresh.';

/**
 * Trade-in on a DRAFT vehicle sale (AUT-443). The trade-in vehicle is a VehiclePurchase with
 * acquisition_kind TRADE_IN and seller_type CUSTOMER (the buyer); its purchase_price is the
 * allowance. The purchase is owned by the sale: it is created, edited and removed only here.
 */
@Injectable()
export class VehicleSaleTradeInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly sales: VehicleSaleService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
  ) {}

  async upsert(saleId: string, dto: UpsertVehicleSaleTradeInDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const { sale, tradeIn: existing } = await this.loadDraftSale(
      tenantId,
      saleId,
    );
    const siteId = assertPersistedSiteId(
      sale.site_id,
      'Vehicle sale site ownership is required',
    );

    const allowance = new Prisma.Decimal(dto.allowance);
    assertValidTradeInAllowance(allowance, sale.sale_price);
    assertTradeInIsNotSoldVehicle(dto.vin, sale.vehicle.vin);
    assertTradeInFirstRegistrationNotFuture(
      dto.first_registration_date,
      new Date(),
    );

    if (existing && existing.status !== VehiclePurchaseStatus.DRAFT) {
      throw new ConflictException(
        'The trade-in vehicle is already received and can no longer be changed on this sale.',
      );
    }
    const purchaseNumber = existing
      ? null
      : await generateNextVehiclePurchaseNumber(this.prisma, tenantId);
    const identity = buildTradeInIdentity(dto, allowance);

    await this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

      let purchaseId: string;
      if (existing) {
        const guarded = await tx.vehiclePurchase.updateMany({
          where: {
            id: existing.id,
            tenant_id: tenantId,
            site_id: siteId,
            acquisition_kind: VehicleAcquisitionKind.TRADE_IN,
            status: VehiclePurchaseStatus.DRAFT,
          },
          data: identity,
        });
        if (guarded.count !== 1) {
          throw new ConflictException(TRADE_IN_CHANGED_MESSAGE);
        }
        purchaseId = existing.id;
      } else {
        const created = await tx.vehiclePurchase.create({
          data: {
            tenant_id: tenantId,
            site_id: siteId,
            purchase_number: purchaseNumber as string,
            seller_type: VehiclePurchaseSellerType.CUSTOMER,
            customer_id: sale.customer_id,
            acquisition_kind: VehicleAcquisitionKind.TRADE_IN,
            ...identity,
          },
        });
        const linked = await tx.vehicleSale.updateMany({
          where: {
            id: sale.id,
            tenant_id: tenantId,
            site_id: siteId,
            status: VehicleSaleStatus.DRAFT,
            trade_in_purchase_id: null,
          },
          data: { trade_in_purchase_id: created.id },
        });
        if (linked.count !== 1) {
          throw new ConflictException(SALE_CHANGED_MESSAGE);
        }
        purchaseId = created.id;
      }

      const saved = await tx.vehiclePurchase.findFirstOrThrow({
        where: { id: purchaseId, tenant_id: tenantId, site_id: siteId },
      });
      await this.recordAudit(tx, tenantId, saleId, {
        before: existing ? tradeInAuditSnapshot(existing) : null,
        after: tradeInAuditSnapshot(saved),
      });
    });

    return this.sales.findOne(saleId);
  }

  async remove(saleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const { sale, tradeIn: existing } = await this.loadDraftSale(
      tenantId,
      saleId,
    );
    if (!existing) {
      return this.sales.findOne(saleId);
    }
    if (existing.status !== VehiclePurchaseStatus.DRAFT) {
      throw new ConflictException(
        'The trade-in vehicle is already received and can no longer be removed from this sale.',
      );
    }
    const siteId = assertPersistedSiteId(
      sale.site_id,
      'Vehicle sale site ownership is required',
    );

    await this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

      // Unlink before deleting: sale -> purchase is a RESTRICT foreign key.
      const unlinked = await tx.vehicleSale.updateMany({
        where: {
          id: sale.id,
          tenant_id: tenantId,
          site_id: siteId,
          status: VehicleSaleStatus.DRAFT,
          trade_in_purchase_id: existing.id,
        },
        data: { trade_in_purchase_id: null },
      });
      if (unlinked.count !== 1) {
        throw new ConflictException(SALE_CHANGED_MESSAGE);
      }

      const deleted = await tx.vehiclePurchase.deleteMany({
        where: {
          id: existing.id,
          tenant_id: tenantId,
          site_id: siteId,
          acquisition_kind: VehicleAcquisitionKind.TRADE_IN,
          status: VehiclePurchaseStatus.DRAFT,
        },
      });
      if (deleted.count !== 1) {
        throw new ConflictException(TRADE_IN_CHANGED_MESSAGE);
      }

      await this.recordAudit(tx, tenantId, saleId, {
        before: tradeInAuditSnapshot(existing),
        after: null,
      });
    });

    return this.sales.findOne(saleId);
  }

  private async loadDraftSale(tenantId: string, saleId: string) {
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.prisma.vehicleSale.findFirst({
      where: {
        id: saleId,
        tenant_id: tenantId,
        site_id: { in: authorizedSiteIds },
        vehicle: {
          is: { tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
        },
      },
      include: { vehicle: true },
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
    if (sale.status !== VehicleSaleStatus.DRAFT) {
      throw new UnprocessableEntityException('Only DRAFT sales can be updated');
    }
    const tradeIn = sale.trade_in_purchase_id
      ? await this.prisma.vehiclePurchase.findFirst({
          where: {
            id: sale.trade_in_purchase_id,
            tenant_id: tenantId,
            site_id: { in: authorizedSiteIds },
          },
        })
      : null;
    return { sale, tradeIn };
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    saleId: string,
    snapshots: {
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    },
  ) {
    const authUser = this.tenantContext.getAuthenticatedUser();
    const actor = authUser?.userId
      ? await tx.user.findFirst({
          where: {
            firebaseUid: authUser.userId,
            active_tenant_id: tenantId,
          },
          select: { id: true },
        })
      : null;

    await this.auditService.recordTenantMutation(
      {
        entityType: 'VehicleSale',
        entityId: saleId,
        action: AuditLogAction.UPDATE,
        actorUserId: actor?.id,
        source: this.requestContext.getSource() ?? 'API',
        before: snapshots.before,
        after: snapshots.after,
        diff: { trade_in: snapshots.after ?? snapshots.before },
      },
      tx,
    );
  }
}

function buildTradeInIdentity(
  dto: UpsertVehicleSaleTradeInDto,
  allowance: Prisma.Decimal,
) {
  return {
    vin: dto.vin,
    make: dto.make,
    model: dto.model,
    year: dto.year,
    mileage: dto.mileage ?? null,
    first_registration_date: dto.first_registration_date ?? null,
    plate: dto.plate ?? null,
    color: dto.color ?? null,
    purchase_price: allowance,
  };
}

function tradeInAuditSnapshot(purchase: {
  id: string;
  purchase_number: string;
  status: VehiclePurchaseStatus;
  vin: string | null;
  make: string;
  model: string;
  year: number;
  mileage: number | null;
  first_registration_date: Date | null;
  purchase_price: Prisma.Decimal;
}): Record<string, unknown> {
  return {
    trade_in_purchase_id: purchase.id,
    purchase_number: purchase.purchase_number,
    status: purchase.status,
    vin: purchase.vin,
    make: purchase.make,
    model: purchase.model,
    year: purchase.year,
    mileage: purchase.mileage,
    first_registration_date:
      purchase.first_registration_date?.toISOString().slice(0, 10) ?? null,
    allowance: purchase.purchase_price.toFixed(2),
  };
}
