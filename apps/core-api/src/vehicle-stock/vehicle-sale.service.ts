import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  Prisma,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehicleSaleStatus,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  type VehiclePurchase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import { InvoiceSnapshotCommitService } from '../invoices/invoice-snapshot-commit.service.js';
import { omitInvoiceSnapshot } from '../invoices/invoice-response.mapper.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { costBasis, marginVatGross } from './vehicle-cost.js';
import { netAmountDue } from './vehicle-trade-in.js';
import { daysInStock } from './vehicle-stock-reports.math.js';
import { AuditService } from '../audit/audit.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { resolveGarantieFacts } from './kaufvertrag/kaufvertrag-garantie.js';
import { omitKaufvertragArchiveInternals } from './kaufvertrag/kaufvertrag-sale-response.js';
import type { CorrectGewaehrleistungSnapshotDto } from './dto/correct-gewaehrleistung-snapshot.dto.js';
import type { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto.js';
import type { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';
import {
  SALE_STATE_CHANGED_MESSAGE,
  SELLABLE_STATUSES,
  assertDraftTradeInCompatible,
  assertExpectedSaleSite,
  assertVehicleIsSellable,
  buildDraftUpdateData,
  buildDraftUpdateWhere,
} from './vehicle-sale.guards.js';
import {
  buildCorrectedWarrantyFacts,
  buildCorrectionAudit,
  buildCorrectionGuardWhere,
  buildCreateWarrantyFacts,
  buildDraftWarrantyFacts,
  computeSaleWarrantySnapshot,
  finalizeWarrantyInput,
  resolveDraftGarantie,
} from './vehicle-sale.warranty.js';
import {
  DEFAULT_VAT_RATE,
  assignInvoiceNumber,
  buildFinalizeFigures,
  buildFinalizeResponse,
  buildMarginInvoiceData,
  findFinalizeLedgerEntries,
  findLockedDraftForFinalize,
  findSaleForFinalize,
  loadFinalizableTradeIn,
  type FinalizeSale,
} from './vehicle-sale.finalize.js';

type DraftSaleForUpdate = Prisma.VehicleSaleGetPayload<{
  include: { vehicle: { include: { location: true } } };
}>;

@Injectable()
export class VehicleSaleService {
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly siteContext: SiteContextService;
  private readonly ledger: VehicleLedgerService;
  private readonly snapshotCommit: InvoiceSnapshotCommitService;
  private readonly auditService: AuditService;
  private readonly requestContext: RequestContextService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    siteContext: SiteContextService,
    ledger: VehicleLedgerService,
    snapshotCommit: InvoiceSnapshotCommitService,
    auditService: AuditService,
    requestContext: RequestContextService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.ledger = ledger;
    this.snapshotCommit = snapshotCommit;
    this.auditService = auditService;
    this.requestContext = requestContext;
  }

  async create(dto: CreateVehicleSaleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const buyer = await this.assertSellable(
      tenantId,
      dto.vehicle_id,
      dto.customer_id,
    );

    // Verify vehicle's lot belongs to the active site
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicle_id, tenant_id: tenantId },
      include: { location: true },
    });
    if (!vehicle?.location || vehicle.location.site_id !== siteId) {
      throw new UnprocessableEntityException(
        'Vehicle is parked at a lot that does not belong to the active site',
      );
    }

    const warrantyFacts = buildCreateWarrantyFacts(dto, buyer.type);
    const warrantySnapshot = computeSaleWarrantySnapshot(
      warrantyFacts,
      vehicle.first_registration_date,
    );
    const garantie = resolveGarantieFacts({
      months: dto.garantie_months ?? null,
      terms: dto.garantie_terms ?? null,
      termsProvided: dto.garantie_terms !== undefined,
    });
    const saleNumber = await this.nextSaleNumber(tenantId);
    return this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

      const created = await tx.vehicleSale.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          sale_number: saleNumber,
          vehicle_id: dto.vehicle_id,
          customer_id: dto.customer_id,
          sale_price: new Prisma.Decimal(dto.sale_price),
          ...garantie,
          ...warrantyFacts,
          ...warrantySnapshot,
        },
      });
      return omitKaufvertragArchiveInternals(created);
    });
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.prisma.vehicleSale.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        site_id: { in: authorizedSiteIds },
        vehicle: {
          is: { tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
        },
        customer: { is: { tenant_id: tenantId } },
      },
      include: { vehicle: true, customer: true, invoice: true },
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${id} not found`);
    }
    const tradeIn = await this.findTradeInPurchase(
      sale.trade_in_purchase_id,
      tenantId,
      authorizedSiteIds,
    );
    const entries = await this.ledger.listForVehicle(sale.vehicle_id);
    const basis = costBasis(entries);
    const vat = marginVatGross(sale.sale_price, basis, DEFAULT_VAT_RATE);
    return {
      ...omitKaufvertragArchiveInternals(sale),
      invoice: sale.invoice ? omitInvoiceSnapshot(sale.invoice) : sale.invoice,
      vehicle: stripVehicleIdentityResolutionState(sale.vehicle),
      trade_in_purchase: tradeIn,
      cost_basis_preview: basis,
      margin_vat_preview: vat,
      amount_due_preview: netAmountDue(
        sale.sale_price,
        tradeIn?.purchase_price ?? null,
      ),
    };
  }

  async updateDraft(id: string, dto: PatchVehicleSaleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sale = await this.findDraftSaleForUpdate(
      id,
      tenantId,
      authorizedSiteIds,
    );
    const tradeIn = await this.findTradeInPurchase(
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
      await this.assertSellable(tenantId, sale.vehicle_id, dto.customer_id);
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

    return this.findOne(id);
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
    return this.findOne(id);
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
        actorUserId: await this.findAuditActorId(tx, scope.tenantId),
        source: this.requestContext.getSource() ?? 'API',
        before,
        after,
        diff: { reason: after.reason },
      },
      tx,
    );
  }

  async finalize(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return this.prisma.$transaction(async (tx) => {
      const draft = await findSaleForFinalize(tx, id, tenantId, siteId);
      const persistedSiteId = assertPersistedSiteId(
        draft.site_id,
        'Vehicle sale site ownership is required',
      );
      const invoiceDate = new Date();
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 14);
      const commitmentContext = await this.snapshotCommit.lockCommitmentContext(
        tx,
        tenantId,
        {
          sales_order_id: null,
          workshop_order_id: null,
          vehicle_sale_id: draft.id,
          site_id: persistedSiteId,
        },
        invoiceDate,
      );

      const sale = await findLockedDraftForFinalize(
        tx,
        id,
        tenantId,
        commitmentContext.ownership.siteId,
      );
      await this.assertSellable(tenantId, sale.vehicle_id, sale.customer_id, tx);

      const warrantySnapshot = computeSaleWarrantySnapshot(
        finalizeWarrantyInput(sale),
        sale.vehicle.first_registration_date,
      );
      const entries = await findFinalizeLedgerEntries(
        tx,
        tenantId,
        sale,
        persistedSiteId,
      );
      const figures = buildFinalizeFigures(sale, entries);

      await guardedStatusUpdate(bindStatusUpdateMany(tx.vehicleSale), {
        id,
        tenantId,
        from: VehicleSaleStatus.DRAFT,
        to: VehicleSaleStatus.INVOICED,
        extraWhere: { site_id: persistedSiteId },
        extraData: warrantySnapshot,
        conflictMessage: SALE_STATE_CHANGED_MESSAGE,
      });

      // Read after the guarded status update. The site row lock from lockCommitmentContext is held here, and a
      // trade-in save takes the same lock first, so no save can change the link before the invoice is written.
      const tradeIn = await loadFinalizableTradeIn(
        tx,
        tenantId,
        sale,
        persistedSiteId,
      );
      const posted = await findSaleForFinalize(tx, id, tenantId, siteId);

      const amountDue = netAmountDue(
        sale.sale_price,
        tradeIn?.purchase_price ?? null,
      );
      const invoice = await tx.invoice.create({
        data: buildMarginInvoiceData({
          tenantId,
          posted,
          ownership: commitmentContext.ownership,
          invoiceDate,
          dueDate,
          figures,
          salePrice: sale.sale_price,
          amountDue,
          tradeIn,
        }),
        include: { items: true, customer: true, vehicle: true },
      });

      await this.snapshotCommit.lockInvoiceRow(tx, tenantId, invoice.id);
      const prepared = await this.snapshotCommit.prepareV2Snapshot({
        tx,
        tenantId,
        invoice,
        margin: figures.margin,
        commitmentContext,
        lockInvoiceRow: false,
        inKindCredit: tradeIn?.purchase_price,
      });
      const invoiceNumber = await assignInvoiceNumber(tx, tenantId, invoice.id);
      await this.snapshotCommit.persistV2Snapshot(
        tx,
        tenantId,
        invoice.id,
        prepared,
      );
      if (tradeIn) {
        await this.recordTradeInNettedAudit(tx, tenantId, posted.id, {
          invoiceId: invoice.id,
          invoiceNumber,
          tradeInPurchaseId: tradeIn.id,
          allowance: tradeIn.purchase_price,
          salePrice: sale.sale_price,
          amountDue,
        });
      }

      await tx.vehicleSale.update({
        where: { id: posted.id },
        data: {
          cost_basis_snapshot: figures.basis,
          margin_vat_snapshot: figures.vat,
          days_to_sell_snapshot: daysInStock(
            sale.vehicle.stock_received_at,
            invoiceDate,
          ),
        },
      });

      await this.releaseStockAndPostLedger(tx, tenantId, posted, {
        persistedSiteId,
        firstRegistrationDate: sale.vehicle.first_registration_date,
      });

      return buildFinalizeResponse(
        posted,
        { ...invoice, invoice_number: invoiceNumber },
        prepared.snapshot,
      );
    });
  }

  async hasOpenStockPrep(
    vehicleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const db = tx ?? this.prisma;
    const open = await db.workshopOrder.count({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: vehicleId,
        purpose: WorkshopOrderPurpose.STOCK_PREP,
        status: {
          notIn: [WorkshopOrderStatus.COMPLETED, WorkshopOrderStatus.INVOICED],
        },
      },
    });
    return open > 0;
  }

  /** Trade-in purchase of a sale, read through the authorized sites: never a tenant-only include. */
  private async findTradeInPurchase(
    tradeInPurchaseId: string | null,
    tenantId: string,
    authorizedSiteIds: string[],
  ): Promise<VehiclePurchase | null> {
    if (!tradeInPurchaseId) {
      return null;
    }
    return this.prisma.vehiclePurchase.findFirst({
      where: {
        id: tradeInPurchaseId,
        tenant_id: tenantId,
        site_id: { in: authorizedSiteIds },
      },
    });
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

  private async findAuditActorId(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string | undefined> {
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
    return actor?.id;
  }

  private async recordTradeInNettedAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    saleId: string,
    netted: {
      invoiceId: string;
      invoiceNumber: string;
      tradeInPurchaseId: string;
      allowance: Prisma.Decimal;
      salePrice: Prisma.Decimal;
      amountDue: Prisma.Decimal;
    },
  ) {
    await this.auditService.recordTenantMutation(
      {
        entityType: 'VehicleSale',
        entityId: saleId,
        action: AuditLogAction.UPDATE,
        actorUserId: await this.findAuditActorId(tx, tenantId),
        source: this.requestContext.getSource() ?? 'API',
        before: null,
        after: {
          invoice_id: netted.invoiceId,
          invoice_number: netted.invoiceNumber,
          trade_in_purchase_id: netted.tradeInPurchaseId,
          sale_price: netted.salePrice.toFixed(2),
          trade_in_allowance: netted.allowance.toFixed(2),
          amount_due: netted.amountDue.toFixed(2),
        },
        diff: { status: VehicleSaleStatus.INVOICED },
      },
      tx,
    );
  }

  /** Takes the vehicle out of stock for its buyer and posts the SALE ledger row, guarded by the stock state. */
  private async releaseStockAndPostLedger(
    tx: Prisma.TransactionClient,
    tenantId: string,
    posted: FinalizeSale,
    guard: { persistedSiteId: string; firstRegistrationDate: Date | null },
  ): Promise<void> {
    const stockGuard = await tx.vehicle.updateMany({
      where: {
        id: posted.vehicle_id,
        tenant_id: tenantId,
        site_id: guard.persistedSiteId,
        inventory_role: VehicleInventoryRole.USED,
        stock_status: { in: SELLABLE_STATUSES },
        first_registration_date: guard.firstRegistrationDate,
      },
      data: {
        stock_status: null,
        stock_received_at: null,
        stock_cost_basis: null,
        inventory_role: VehicleInventoryRole.CUSTOMER,
        customer_id: posted.customer_id,
        reserved_for_customer_id: null,
      },
    });
    if (stockGuard.count === 0) {
      throw new ConflictException('Vehicle is no longer sellable');
    }

    await this.ledger.append(
      {
        vehicleId: posted.vehicle_id,
        entryType: VehicleLedgerEntryType.SALE,
        amount: posted.sale_price.negated(),
        vehicleSaleId: posted.id,
      },
      tx,
    );
  }

  private async assertSellable(
    tenantId: string,
    vehicleId: string,
    buyerId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    assertVehicleIsSellable(vehicle, buyerId);
    if (await this.hasOpenStockPrep(vehicleId, tx)) {
      throw new ConflictException(
        'Vehicle has an open stock-prep workshop order',
      );
    }
    const buyer = await db.customer.findFirst({
      where: { id: buyerId, tenant_id: tenantId },
    });
    if (!buyer) {
      throw new NotFoundException(`Customer ${buyerId} not found`);
    }
    return buyer;
  }

  private async nextSaleNumber(tenantId: string) {
    const year = new Date().getFullYear();
    const prefix = `VS-${year}-`;
    const settings = await this.prisma.$transaction(async (tx) => {
      await tx.financeSettings.upsert({
        where: { tenant_id: tenantId },
        update: {},
        create: {
          tenant_id: tenantId,
          workshop_order_prefix: `WO-${year}-`,
          vehicle_sale_prefix: prefix,
        },
      });
      return tx.financeSettings.update({
        where: { tenant_id: tenantId },
        data: { next_vehicle_sale_number: { increment: 1 } },
        select: { next_vehicle_sale_number: true },
      });
    });
    return `${prefix}${String(settings.next_vehicle_sale_number - 1).padStart(4, '0')}`;
  }
}
