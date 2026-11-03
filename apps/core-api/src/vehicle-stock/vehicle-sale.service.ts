import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  type VehiclePurchase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import { omitInvoiceSnapshot } from '../invoices/invoice-response.mapper.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { costBasis, marginVatGross } from './vehicle-cost.js';
import { netAmountDue } from './vehicle-trade-in.js';
import { resolveGarantieFacts } from './kaufvertrag/kaufvertrag-garantie.js';
import { omitKaufvertragArchiveInternals } from './kaufvertrag/kaufvertrag-sale-response.js';
import type { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto.js';
import { assertVehicleIsSellable } from './vehicle-sale.guards.js';
import {
  buildCreateWarrantyFacts,
  computeSaleWarrantySnapshot,
  toGewaehrleistungReadFields,
} from './vehicle-sale.warranty.js';
import { viennaIsoDay } from './gewaehrleistung/gewaehrleistung-status.js';
import { DEFAULT_VAT_RATE } from './vehicle-sale.finalize.js';

/**
 * Creates and reads vehicle sales and decides whether a vehicle can be sold at all.
 * Draft updates and corrections live in VehicleSaleTransitionService, finalizing in
 * VehicleSaleFinalizeService; both call back here for the sellability check.
 */
@Injectable()
export class VehicleSaleService {
  private readonly prisma: PrismaService;
  private readonly tenantContext: TenantContextService;
  private readonly siteContext: SiteContextService;
  private readonly ledger: VehicleLedgerService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    prisma: PrismaService,
    tenantContext: TenantContextService,
    siteContext: SiteContextService,
    ledger: VehicleLedgerService,
  ) {
    this.prisma = prisma;
    this.tenantContext = tenantContext;
    this.siteContext = siteContext;
    this.ledger = ledger;
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
      return {
        ...omitKaufvertragArchiveInternals(created),
        ...toGewaehrleistungReadFields(created, viennaIsoDay(new Date())),
      };
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
      ...toGewaehrleistungReadFields(sale, viennaIsoDay(new Date())),
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
  async findTradeInPurchase(
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

  async assertSellable(
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
