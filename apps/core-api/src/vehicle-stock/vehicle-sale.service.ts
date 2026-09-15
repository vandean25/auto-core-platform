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
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import {
  assertActiveTargetSiteMembership,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { buildInvoiceSnapshot } from '../invoices/invoice-snapshot.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { costBasis, marginVatGross } from './vehicle-cost.js';
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
  ) {}

  async create(dto: CreateVehicleSaleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.assertSellable(tenantId, dto.vehicle_id, dto.customer_id);

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
        },
      });
    });
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const sale = await this.prisma.vehicleSale.findFirst({
      where: { id, tenant_id: tenantId },
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
      vehicle: stripVehicleIdentityResolutionState(sale.vehicle),
      cost_basis_preview: basis,
      margin_vat_preview: vat,
    };
  }

  async updateDraft(id: string, dto: PatchVehicleSaleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const sale = await this.prisma.vehicleSale.findFirst({
      where: { id, tenant_id: tenantId },
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

  async finalize(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.vehicleSale.findFirst({
        where: { id, tenant_id: tenantId },
        include: { vehicle: true, customer: true },
      });
      if (!sale) {
        throw new NotFoundException(`Vehicle sale ${id} not found`);
      }

      await this.assertSellable(
        tenantId,
        sale.vehicle_id,
        sale.customer_id,
        tx,
      );

      const guarded = await tx.vehicleSale.updateMany({
        where: { id, tenant_id: tenantId, status: VehicleSaleStatus.DRAFT },
        data: { status: VehicleSaleStatus.INVOICED },
      });
      if (guarded.count === 0) {
        throw new ConflictException('Sale is not in DRAFT status');
      }

      const posted = await tx.vehicleSale.findFirst({
        where: { id, tenant_id: tenantId },
        include: { vehicle: true, customer: true },
      });
      if (!posted) {
        throw new NotFoundException(`Vehicle sale ${id} not found`);
      }

      const entries = await tx.vehicleLedgerEntry.findMany({
        where: { tenant_id: tenantId, vehicle_id: posted.vehicle_id },
      });
      const basis = costBasis(entries);
      const vat = marginVatGross(posted.sale_price, basis, DEFAULT_VAT_RATE);
      const net = posted.sale_price.sub(vat);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);

      const invoiceNumber = await this.generateInvoiceNumber(tx, tenantId);
      const description =
        `${posted.vehicle.year} ${posted.vehicle.make} ${posted.vehicle.model} VIN ${posted.vehicle.vin ?? ''}`.trim();

      const invoice = await tx.invoice.create({
        data: {
          tenant_id: tenantId,
          customer_id: posted.customer_id,
          vehicle_id: posted.vehicle_id,
          vehicle_sale_id: posted.id,
          tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
          status: InvoiceStatus.FINALIZED,
          invoice_number: invoiceNumber,
          date: new Date(),
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

      const snapshot = buildInvoiceSnapshot(invoice);
      await tx.invoice.updateMany({
        where: { id: invoice.id, tenant_id: tenantId },
        data: { snapshot },
      });

      await tx.vehicleSale.update({
        where: { id: posted.id },
        data: {
          cost_basis_snapshot: basis,
          margin_vat_snapshot: vat,
        },
      });

      const stockGuard = await tx.vehicle.updateMany({
        where: {
          id: posted.vehicle_id,
          tenant_id: tenantId,
          inventory_role: VehicleInventoryRole.USED,
          stock_status: { in: SELLABLE_STATUSES },
        },
        data: {
          stock_status: null,
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
        invoice: {
          ...invoice,
          vehicle: invoice.vehicle
            ? stripVehicleIdentityResolutionState(invoice.vehicle)
            : invoice.vehicle,
          snapshot,
        },
      };
    });
  }

  async hasOpenStockPrep(
    vehicleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const tenantId = await this.tenantContext.getTenantId();
    const db = tx ?? this.prisma;
    const open = await db.workshopOrder.count({
      where: {
        tenant_id: tenantId,
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
