import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  Prisma,
  VehicleSaleStatus,
  type VehiclePurchase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  assertActiveTargetSiteMembership,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { AuditService } from '../audit/audit.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { resolveDraftGarantie } from './vehicle-sale.warranty.js';
import type { CorrectGewaehrleistungSnapshotDto } from './dto/correct-gewaehrleistung-snapshot.dto.js';
import type { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';
import {
  SALE_STATE_CHANGED_MESSAGE,
  assertDraftTradeInCompatible,
  assertExpectedSaleSite,
  buildDraftUpdateData,
  buildDraftUpdateWhere,
} from './vehicle-sale.guards.js';
import {
  buildCorrectedWarrantyFacts,
  buildCorrectionAudit,
  buildCorrectionGuardWhere,
  buildDraftWarrantyFacts,
  computeSaleWarrantySnapshot,
} from './vehicle-sale.warranty.js';
import { findAuditActorId } from './vehicle-sale.audit.js';
import { VehicleSaleService } from './vehicle-sale.service.js';

type DraftSaleForUpdate = Prisma.VehicleSaleGetPayload<{
  include: { vehicle: { include: { location: true } } };
}>;

/** Moves an existing sale: edits a draft (including moving it to another site) and corrects an invoiced one. */
@Injectable()
export class VehicleSaleTransitionService {
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly siteContext: SiteContextService;
  private readonly sales: VehicleSaleService;
  private readonly auditService: AuditService;
  private readonly requestContext: RequestContextService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    siteContext: SiteContextService,
    sales: VehicleSaleService,
    auditService: AuditService,
    requestContext: RequestContextService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.sales = sales;
    this.auditService = auditService;
    this.requestContext = requestContext;
  }

  async updateDraft(id: string, dto: PatchVehicleSaleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.findDraftSaleForUpdate(
      id,
      tenantId,
      authorizedSiteIds,
    );
    const tradeIn = await this.sales.findTradeInPurchase(
      sale.trade_in_purchase_id,
      tenantId,
      authorizedSiteIds,
    );
    assertDraftTradeInCompatible(sale, dto, tradeIn);
    assertExpectedSaleSite(sale, dto);

    const targetSiteId = dto.siteId ?? dto.site_id;
    const isRetargeting =
      targetSiteId !== undefined && targetSiteId !== sale.site_id;
    if (isRetargeting) {
      await this.assertRetargetAllowed(tenantId, sale, tradeIn, targetSiteId);
    }
    if (dto.customer_id) {
      await this.sales.assertSellable(
        tenantId,
        sale.vehicle_id,
        dto.customer_id,
      );
    }

    const warrantyFacts = buildDraftWarrantyFacts(sale, dto);
    const warrantySnapshot = computeSaleWarrantySnapshot(
      warrantyFacts,
      sale.vehicle?.first_registration_date ?? null,
    );
    const warrantyFields = {
      ...resolveDraftGarantie(sale, dto),
      ...warrantyFacts,
      ...warrantySnapshot,
    };
    // A retarget locks both sites: the trade-in-free sale must not move while another request writes it.
    const lockSiteIds = isRetargeting
      ? [sale.site_id, targetSiteId].filter((s): s is string => Boolean(s))
      : null;
    await this.persistDraftUpdate(
      tenantId,
      lockSiteIds,
      buildDraftUpdateWhere({ id, tenantId }, sale, dto, isRetargeting),
      buildDraftUpdateData(dto, warrantyFields, targetSiteId, isRetargeting),
    );

    return this.sales.findOne(id);
  }

  async correctGewaehrleistungSnapshot(
    id: string,
    dto: CorrectGewaehrleistungSnapshotDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    await this.prisma.$transaction((tx) =>
      this.applyGewaehrleistungCorrection(tx, id, dto, {
        tenantId,
        authorizedSiteIds,
      }),
    );
    return this.sales.findOne(id);
  }

  /** Only an invoiced sale in the caller's site scope can have its warranty snapshot corrected. */
  private async findInvoicedSaleForCorrection(
    tx: Prisma.TransactionClient,
    id: string,
    scope: { tenantId: string; authorizedSiteIds: string[] },
  ) {
    const sale = await tx.vehicleSale.findFirst({
      where: {
        id,
        tenant_id: scope.tenantId,
        site_id: { in: scope.authorizedSiteIds },
        status: VehicleSaleStatus.INVOICED,
        vehicle: {
          is: {
            tenant_id: scope.tenantId,
            site_id: { in: scope.authorizedSiteIds },
          },
        },
      },
      include: { vehicle: true },
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${id} not found`);
    }
    return sale;
  }

  private async applyGewaehrleistungCorrection(
    tx: Prisma.TransactionClient,
    id: string,
    dto: CorrectGewaehrleistungSnapshotDto,
    scope: { tenantId: string; authorizedSiteIds: string[] },
  ): Promise<void> {
    const sale = await this.findInvoicedSaleForCorrection(tx, id, scope);

    const warrantyFacts = buildCorrectedWarrantyFacts(sale, dto);
    const warrantySnapshot = computeSaleWarrantySnapshot(
      warrantyFacts,
      sale.vehicle.first_registration_date,
    );
    const { before, after } = buildCorrectionAudit(
      sale,
      warrantyFacts,
      warrantySnapshot,
      dto.reason,
    );
    if (!after.reason) {
      throw new UnprocessableEntityException(
        'Ein Korrekturgrund ist erforderlich.',
      );
    }

    const updated = await tx.vehicleSale.updateMany({
      where: buildCorrectionGuardWhere(
        id,
        scope.tenantId,
        scope.authorizedSiteIds,
        sale,
      ),
      data: { ...warrantyFacts, ...warrantySnapshot },
    });
    if (updated.count !== 1) {
      throw new ConflictException(SALE_STATE_CHANGED_MESSAGE);
    }

    await this.auditService.recordTenantMutation(
      {
        entityType: 'VehicleSale',
        entityId: sale.id,
        action: AuditLogAction.UPDATE,
        actorUserId: await findAuditActorId(
          tx,
          this.tenantContext,
          scope.tenantId,
        ),
        source: this.requestContext.getSource() ?? 'API',
        before,
        after,
        diff: { reason: after.reason },
      },
      tx,
    );
  }

  private async findDraftSaleForUpdate(
    id: string,
    tenantId: string,
    authorizedSiteIds: string[],
  ): Promise<DraftSaleForUpdate> {
    const sale = await this.prisma.vehicleSale.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        site_id: { in: authorizedSiteIds },
        vehicle: {
          is: { tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
        },
      },
      include: { vehicle: { include: { location: true } } },
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${id} not found`);
    }
    if (sale.status !== VehicleSaleStatus.DRAFT) {
      throw new UnprocessableEntityException('Only DRAFT sales can be updated');
    }
    return sale;
  }

  /** A sale with a trade-in cannot move sites, and the vehicle must already sit on a lot of the target site. */
  private async assertRetargetAllowed(
    tenantId: string,
    sale: DraftSaleForUpdate,
    tradeIn: VehiclePurchase | null,
    targetSiteId: string,
  ): Promise<void> {
    // The trade-in purchase is site-owned and stays at the sale's site; moving the sale would strand it.
    if (tradeIn) {
      throw new UnprocessableEntityException(
        'Remove the trade-in before moving this sale to another site',
      );
    }
    await assertActiveTargetSiteMembership(
      this.prisma,
      this.tenantContext,
      tenantId,
      targetSiteId,
    );

    // Ruling 18: Parked vehicle's lot must already belong to target site; 422 otherwise
    if (
      !sale.vehicle?.location ||
      sale.vehicle.location.site_id !== targetSiteId
    ) {
      throw new UnprocessableEntityException(
        'Vehicle is parked on another site; move the vehicle before retargeting sale',
      );
    }
  }

  private async persistDraftUpdate(
    tenantId: string,
    lockSiteIds: string[] | null,
    where: Prisma.VehicleSaleWhereInput,
    data: Prisma.VehicleSaleUncheckedUpdateManyInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (lockSiteIds) {
        await lockSitesAndAssertActive(tx, tenantId, lockSiteIds);
      }

      const updated = await tx.vehicleSale.updateMany({ where, data });
      if (updated.count === 0) {
        throw new ConflictException(SALE_STATE_CHANGED_MESSAGE);
      }
    });
  }
}
