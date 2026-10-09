import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehicleSaleStatus,
  VehicleStockStatus,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  AuditLogAction,
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
import { daysInStock } from './vehicle-stock-reports.math.js';
import { AuditService } from '../audit/audit.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { computeGewaehrleistung } from './gewaehrleistung/compute-gewaehrleistung.js';
import { resolveGewaehrleistungRuleSet } from './gewaehrleistung/gewaehrleistung-rule-sets.js';
import type { CorrectGewaehrleistungSnapshotDto } from './dto/correct-gewaehrleistung-snapshot.dto.js';
import type { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto.js';
import type { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';

const DEFAULT_VAT_RATE = new Prisma.Decimal(20);
const MARGIN_REVENUE_GROUP = 'Vehicle used (margin)';
const SELLABLE_STATUSES: VehicleStockStatus[] = [
  VehicleStockStatus.IN_STOCK,
  VehicleStockStatus.RESERVED,
];

@Injectable()
export class VehicleSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly ledger: VehicleLedgerService,
    private readonly snapshotCommit: InvoiceSnapshotCommitService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
  ) {}

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

    const warrantyFacts = {
      contract_concluded_at: dto.contract_concluded_at ?? null,
      handed_over_at: dto.handed_over_at ?? null,
      buyer_is_consumer: dto.buyer_is_consumer ?? buyer.type === 'PRIVATE',
      gewaehrleistung_shortened_negotiated:
        dto.gewaehrleistung_shortened_negotiated ?? false,
      gewaehrleistung_note: dto.gewaehrleistung_note ?? null,
    };
    const warrantySnapshot = this.computeGewaehrleistungSnapshot(
      warrantyFacts,
      vehicle.first_registration_date,
    );
    const saleNumber = await this.nextSaleNumber(tenantId);
    return this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

      return tx.vehicleSale.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          sale_number: saleNumber,
          vehicle_id: dto.vehicle_id,
          customer_id: dto.customer_id,
          sale_price: new Prisma.Decimal(dto.sale_price),
          ...warrantyFacts,
          ...warrantySnapshot,
        },
      });
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
    const entries = await this.ledger.listForVehicle(sale.vehicle_id);
    const basis = costBasis(entries);
    const vat = marginVatGross(sale.sale_price, basis, DEFAULT_VAT_RATE);
    return {
      ...sale,
      invoice: sale.invoice ? omitInvoiceSnapshot(sale.invoice) : sale.invoice,
      vehicle: stripVehicleIdentityResolutionState(sale.vehicle),
      cost_basis_preview: basis,
      margin_vat_preview: vat,
    };
  }

  async updateDraft(id: string, dto: PatchVehicleSaleDto) {
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
      },
      include: { vehicle: { include: { location: true } } },
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${id} not found`);
    }
    if (sale.status !== VehicleSaleStatus.DRAFT) {
      throw new UnprocessableEntityException('Only DRAFT sales can be updated');
    }

    const targetSiteId = dto.siteId ?? dto.site_id;
    if (
      dto.expectedSiteId !== undefined &&
      sale.site_id &&
      dto.expectedSiteId !== sale.site_id
    ) {
      throw new ConflictException(
        'Vehicle sale site changed concurrently. Please refresh.',
      );
    }

    const isRetargeting =
      targetSiteId !== undefined && targetSiteId !== sale.site_id;

    if (isRetargeting) {
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

    if (dto.customer_id) {
      await this.assertSellable(tenantId, sale.vehicle_id, dto.customer_id);
    }

    const warrantyFacts = {
      contract_concluded_at:
        dto.contract_concluded_at !== undefined
          ? dto.contract_concluded_at
          : sale.contract_concluded_at,
      handed_over_at:
        dto.handed_over_at !== undefined
          ? dto.handed_over_at
          : sale.handed_over_at,
      buyer_is_consumer:
        dto.buyer_is_consumer ?? sale.buyer_is_consumer ?? false,
      gewaehrleistung_shortened_negotiated:
        dto.gewaehrleistung_shortened_negotiated ??
        sale.gewaehrleistung_shortened_negotiated ??
        false,
      gewaehrleistung_note:
        dto.gewaehrleistung_note !== undefined
          ? dto.gewaehrleistung_note
          : sale.gewaehrleistung_note,
    };
    const warrantySnapshot = this.computeGewaehrleistungSnapshot(
      warrantyFacts,
      sale.vehicle?.first_registration_date ?? null,
    );

    await this.prisma.$transaction(async (tx) => {
      if (isRetargeting) {
        await lockSitesAndAssertActive(
          tx,
          tenantId,
          [sale.site_id, targetSiteId].filter((s): s is string => Boolean(s)),
        );
      }

      const updateData: Prisma.VehicleSaleUncheckedUpdateManyInput = {
        customer_id: dto.customer_id,
        sale_price:
          dto.sale_price !== undefined
            ? new Prisma.Decimal(dto.sale_price)
            : undefined,
        ...warrantyFacts,
        ...warrantySnapshot,
      };
      if (isRetargeting) {
        updateData.site_id = targetSiteId;
      }

      const updated = await tx.vehicleSale.updateMany({
        where: {
          id,
          tenant_id: tenantId,
          status: VehicleSaleStatus.DRAFT,
          ...(isRetargeting && sale.site_id ? { site_id: sale.site_id } : {}),
          ...(dto.expectedSiteId ? { site_id: dto.expectedSiteId } : {}),
        },
        data: updateData,
      });

      if (updated.count === 0) {
        throw new ConflictException(
          'Vehicle sale state or site changed concurrently. Please refresh.',
        );
      }
    });

    return this.findOne(id);
  }

  async correctGewaehrleistungSnapshot(
    id: string,
    dto: CorrectGewaehrleistungSnapshotDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    await this.prisma.$transaction(async (tx) => {
      const sale = await tx.vehicleSale.findFirst({
        where: {
          id,
          tenant_id: tenantId,
          site_id: { in: authorizedSiteIds },
          status: VehicleSaleStatus.INVOICED,
          vehicle: {
            is: { tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
          },
        },
        include: { vehicle: true },
      });
      if (!sale) {
        throw new NotFoundException(`Vehicle sale ${id} not found`);
      }

      const warrantyFacts = {
        contract_concluded_at:
          dto.contract_concluded_at !== undefined
            ? dto.contract_concluded_at
            : sale.contract_concluded_at,
        handed_over_at:
          dto.handed_over_at !== undefined
            ? dto.handed_over_at
            : sale.handed_over_at,
        buyer_is_consumer: dto.buyer_is_consumer,
        gewaehrleistung_shortened_negotiated:
          dto.gewaehrleistung_shortened_negotiated,
        gewaehrleistung_note:
          dto.gewaehrleistung_note !== undefined
            ? dto.gewaehrleistung_note
            : sale.gewaehrleistung_note,
      };
      const warrantySnapshot = this.computeGewaehrleistungSnapshot(
        warrantyFacts,
        sale.vehicle.first_registration_date,
      );
      const before = {
        input: this.toGewaehrleistungInput(sale),
        snapshot: this.toGewaehrleistungSnapshot(sale),
        reason: null,
      };
      const after = {
        input: warrantyFacts,
        snapshot: warrantySnapshot,
        reason: dto.reason.trim(),
      };
      if (!after.reason) {
        throw new UnprocessableEntityException(
          'Ein Korrekturgrund ist erforderlich.',
        );
      }

      const updated = await tx.vehicleSale.updateMany({
        where: {
          id,
          tenant_id: tenantId,
          site_id: { in: authorizedSiteIds },
          status: VehicleSaleStatus.INVOICED,
          contract_concluded_at: sale.contract_concluded_at,
          handed_over_at: sale.handed_over_at,
          buyer_is_consumer: sale.buyer_is_consumer,
          gewaehrleistung_shortened_negotiated:
            sale.gewaehrleistung_shortened_negotiated,
          gewaehrleistung_note: sale.gewaehrleistung_note,
          gewaehrleistung_ends_on: sale.gewaehrleistung_ends_on,
          presumption_ends_on: sale.presumption_ends_on,
          gewaehrleistung_rule_version: sale.gewaehrleistung_rule_version,
        },
        data: { ...warrantyFacts, ...warrantySnapshot },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Vehicle sale state or site changed concurrently. Please refresh.',
        );
      }

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
          entityId: sale.id,
          action: AuditLogAction.UPDATE,
          actorUserId: actor?.id,
          source: this.requestContext.getSource() ?? 'API',
          before,
          after,
          diff: { reason: after.reason },
        },
        tx,
      );
    });
    return this.findOne(id);
  }

  async finalize(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    return this.prisma.$transaction(async (tx) => {
      let sale = await tx.vehicleSale.findFirst({
        where: {
          id,
          tenant_id: tenantId,
          site_id: siteId,
          vehicle: { is: { tenant_id: tenantId, site_id: siteId } },
          customer: { is: { tenant_id: tenantId } },
        },
        include: { vehicle: true, customer: true },
      });
      if (!sale) {
        throw new NotFoundException(`Vehicle sale ${id} not found`);
      }

      const persistedSiteId = assertPersistedSiteId(
        sale.site_id,
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
          vehicle_sale_id: sale.id,
          site_id: persistedSiteId,
        },
        invoiceDate,
      );

      const lockedSale = await tx.vehicleSale.findFirst({
        where: {
          id,
          tenant_id: tenantId,
          site_id: commitmentContext.ownership.siteId,
          status: VehicleSaleStatus.DRAFT,
          vehicle: {
            is: {
              tenant_id: tenantId,
              site_id: commitmentContext.ownership.siteId,
            },
          },
          customer: { is: { tenant_id: tenantId } },
        },
        include: { vehicle: true, customer: true },
      });
      if (!lockedSale) {
        throw new ConflictException(
          'Vehicle sale state or site changed concurrently. Please refresh.',
        );
      }
      sale = lockedSale;
      await this.assertSellable(
        tenantId,
        sale.vehicle_id,
        sale.customer_id,
        tx,
      );

      const warrantySnapshot = this.computeGewaehrleistungSnapshot(
        {
          contract_concluded_at: sale.contract_concluded_at,
          handed_over_at: sale.handed_over_at,
          buyer_is_consumer: sale.buyer_is_consumer ?? false,
          gewaehrleistung_shortened_negotiated:
            sale.gewaehrleistung_shortened_negotiated ?? false,
        },
        sale.vehicle.first_registration_date,
      );

      const entries = await tx.vehicleLedgerEntry.findMany({
        where: {
          tenant_id: tenantId,
          vehicle_id: sale.vehicle_id,
          vehicle: { is: { tenant_id: tenantId, site_id: persistedSiteId } },
          ...(sale.vehicle.stock_received_at
            ? { posting_date: { gte: sale.vehicle.stock_received_at } }
            : {}),
        },
      });
      const basis = costBasis(entries);
      const vat = marginVatGross(sale.sale_price, basis, DEFAULT_VAT_RATE);
      const net = sale.sale_price.sub(vat);
      const description =
        `${sale.vehicle.year} ${sale.vehicle.make} ${sale.vehicle.model} VIN ${sale.vehicle.vin ?? ''}`.trim();
      const margin = {
        cost_basis: basis.toFixed(2),
        margin_tax: vat.toFixed(2),
        tax_rate: DEFAULT_VAT_RATE.toFixed(2),
        calculation_profile: 'vehicle-margin-v1',
      };

      await guardedStatusUpdate(bindStatusUpdateMany(tx.vehicleSale), {
        id,
        tenantId,
        from: VehicleSaleStatus.DRAFT,
        to: VehicleSaleStatus.INVOICED,
        extraWhere: { site_id: persistedSiteId },
        extraData: warrantySnapshot,
        conflictMessage:
          'Vehicle sale state or site changed concurrently. Please refresh.',
      });

      const posted = await tx.vehicleSale.findFirst({
        where: {
          id,
          tenant_id: tenantId,
          site_id: siteId,
          vehicle: { is: { tenant_id: tenantId, site_id: siteId } },
          customer: { is: { tenant_id: tenantId } },
        },
        include: { vehicle: true, customer: true },
      });
      if (!posted) {
        throw new NotFoundException(`Vehicle sale ${id} not found`);
      }

      const invoice = await tx.invoice.create({
        data: {
          tenant_id: tenantId,
          customer_id: posted.customer_id,
          vehicle_id: posted.vehicle_id,
          vehicle_sale_id: posted.id,
          site_id: commitmentContext.ownership.siteId,
          legal_entity_id: commitmentContext.ownership.legalEntityId,
          currency: 'EUR',
          tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
          status: InvoiceStatus.FINALIZED,
          invoice_number: null,
          date: invoiceDate,
          due_date: dueDate,
          total_net: net,
          total_tax: vat,
          total_gross: posted.sale_price,
          items: {
            create: {
              tenant_id: tenantId,
              description,
              quantity: new Prisma.Decimal(1),
              unit_price: posted.sale_price,
              tax_rate: DEFAULT_VAT_RATE,
              line_total: posted.sale_price,
              revenue_group_name: MARGIN_REVENUE_GROUP,
            },
          },
        },
        include: { items: true, customer: true, vehicle: true },
      });

      await this.snapshotCommit.lockInvoiceRow(tx, tenantId, invoice.id);
      const prepared = await this.snapshotCommit.prepareV2Snapshot({
        tx,
        tenantId,
        invoice,
        margin,
        commitmentContext,
        lockInvoiceRow: false,
      });
      const invoiceNumber = await this.generateInvoiceNumber(tx, tenantId);
      const invoiceNumberUpdate = await tx.invoice.updateMany({
        where: {
          id: invoice.id,
          tenant_id: tenantId,
          status: InvoiceStatus.FINALIZED,
          invoice_number: null,
        },
        data: { invoice_number: invoiceNumber },
      });
      if (invoiceNumberUpdate.count !== 1) {
        throw new ConflictException(
          'Invoice was already transitioned by another request',
        );
      }
      const invoiceWithNumber = { ...invoice, invoice_number: invoiceNumber };
      await this.snapshotCommit.persistV2Snapshot(
        tx,
        tenantId,
        invoice.id,
        prepared,
      );
      const snapshot = prepared.snapshot;

      await tx.vehicleSale.update({
        where: { id: posted.id },
        data: {
          cost_basis_snapshot: basis,
          margin_vat_snapshot: vat,
          days_to_sell_snapshot: daysInStock(
            sale.vehicle.stock_received_at,
            invoiceDate,
          ),
        },
      });

      const stockGuard = await tx.vehicle.updateMany({
        where: {
          id: posted.vehicle_id,
          tenant_id: tenantId,
          site_id: persistedSiteId,
          inventory_role: VehicleInventoryRole.USED,
          stock_status: { in: SELLABLE_STATUSES },
          first_registration_date: sale.vehicle.first_registration_date,
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

      return {
        ...posted,
        status: VehicleSaleStatus.INVOICED,
        vehicle: stripVehicleIdentityResolutionState(posted.vehicle),
        invoice: omitInvoiceSnapshot({
          ...invoiceWithNumber,
          vehicle: invoiceWithNumber.vehicle
            ? stripVehicleIdentityResolutionState(invoiceWithNumber.vehicle)
            : invoiceWithNumber.vehicle,
          snapshot,
        }),
      };
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
    if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
      throw new ConflictException('Vehicle is not dealer stock');
    }
    if (
      !vehicle.stock_status ||
      !SELLABLE_STATUSES.includes(vehicle.stock_status)
    ) {
      throw new ConflictException('Vehicle is not available for sale');
    }
    if (
      vehicle.stock_status === VehicleStockStatus.RESERVED &&
      vehicle.reserved_for_customer_id &&
      vehicle.reserved_for_customer_id !== buyerId
    ) {
      throw new ConflictException(
        'Vehicle is reserved for a different customer',
      );
    }
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

  private computeGewaehrleistungSnapshot(
    input: {
      contract_concluded_at: Date | null;
      handed_over_at: Date | null;
      buyer_is_consumer: boolean;
      gewaehrleistung_shortened_negotiated: boolean;
    },
    firstRegistrationDate: Date | null,
  ) {
    const ruleSet =
      input.contract_concluded_at && input.handed_over_at
        ? resolveGewaehrleistungRuleSet(input.contract_concluded_at)
        : null;
    const result = computeGewaehrleistung({
      contractConcludedAt: input.contract_concluded_at,
      handedOverAt: input.handed_over_at,
      buyerIsConsumer: input.buyer_is_consumer,
      shortenedNegotiated: input.gewaehrleistung_shortened_negotiated,
      firstRegistrationDate,
    });
    if (result.error) {
      throw new UnprocessableEntityException(result.error);
    }
    return {
      gewaehrleistung_ends_on: result.baseEndsOn,
      presumption_ends_on: result.presumptionEndsOn,
      gewaehrleistung_rule_version: ruleSet?.id ?? result.ruleVersion,
    };
  }

  private toGewaehrleistungInput(sale: {
    contract_concluded_at: Date | null;
    handed_over_at: Date | null;
    buyer_is_consumer: boolean | null;
    gewaehrleistung_shortened_negotiated: boolean | null;
    gewaehrleistung_note: string | null;
  }) {
    return {
      contract_concluded_at: sale.contract_concluded_at,
      handed_over_at: sale.handed_over_at,
      buyer_is_consumer: sale.buyer_is_consumer,
      gewaehrleistung_shortened_negotiated:
        sale.gewaehrleistung_shortened_negotiated,
      gewaehrleistung_note: sale.gewaehrleistung_note,
    };
  }

  private toGewaehrleistungSnapshot(sale: {
    gewaehrleistung_ends_on: Date | null;
    presumption_ends_on: Date | null;
    gewaehrleistung_rule_version: string | null;
  }) {
    return {
      gewaehrleistung_ends_on: sale.gewaehrleistung_ends_on,
      presumption_ends_on: sale.presumption_ends_on,
      gewaehrleistung_rule_version: sale.gewaehrleistung_rule_version,
    };
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

  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ) {
    const year = new Date().getFullYear();
    const prefix = `RE-${year}-`;
    const sequence = await tx.invoiceSequence.upsert({
      where: { tenant_id_year: { tenant_id: tenantId, year } },
      update: { current: { increment: 1 } },
      create: { tenant_id: tenantId, year, current: 1 },
    });
    return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
  }
}
