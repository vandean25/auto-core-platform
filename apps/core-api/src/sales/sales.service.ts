import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util';
import {
  assertCustomerBelongsToTenant,
  assertVehicleBelongsToTenant,
} from './helpers/sales-tenant-validation.helpers';
import {
  buildFormattedInvoiceItems,
  buildInvoiceDueDate,
} from './helpers/invoice-line-items.helpers';
import { reconcileDraftInvoiceItems } from './helpers/invoice-draft-reconciliation.helpers';
import { InvoiceFinalizationService } from './invoice-finalization.service';

import Decimal = Prisma.Decimal;

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private readonly tenantContext: TenantContextService,
    private readonly invoiceFinalization: InvoiceFinalizationService,
  ) {}

  async createDraft(createInvoiceDto: CreateInvoiceDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const { items = [], ...invoiceData } = createInvoiceDto;

    if (invoiceData.customerId) {
      await assertCustomerBelongsToTenant(
        this.prisma,
        invoiceData.customerId,
        tenantId,
      );
    }

    if (invoiceData.vehicleId) {
      await assertVehicleBelongsToTenant(
        this.prisma,
        invoiceData.vehicleId,
        tenantId,
      );
    }

    const { formattedItems, totalNet, totalTax, totalGross } =
      await buildFormattedInvoiceItems(this.prisma, tenantId, items);

    return this.prisma.invoice.create({
      data: {
        tenant_id: tenantId,
        customer_id: invoiceData.customerId,
        vehicle_id: invoiceData.vehicleId,
        notes: invoiceData.notes,
        internal_notes: invoiceData.internalNotes,
        status: InvoiceStatus.DRAFT,
        date: new Date(),
        due_date: buildInvoiceDueDate(),
        total_net: totalNet,
        total_tax: totalTax,
        total_gross: totalGross,
        items: {
          create: formattedItems,
        },
      },
      include: {
        items: true,
      },
    });
  }

  async updateDraft(id: string, updateInvoiceDto: CreateInvoiceDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.invoice.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Invoice not found');
    }
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be updated');
    }

    const { items = [], ...invoiceData } = updateInvoiceDto;

    if (invoiceData.customerId) {
      await assertCustomerBelongsToTenant(
        this.prisma,
        invoiceData.customerId,
        tenantId,
      );
    }

    if (invoiceData.vehicleId) {
      await assertVehicleBelongsToTenant(
        this.prisma,
        invoiceData.vehicleId,
        tenantId,
      );
    }

    const { formattedItems, totalNet, totalTax, totalGross } =
      await buildFormattedInvoiceItems(this.prisma, tenantId, items);

    return this.prisma.$transaction(async (tx) =>
      reconcileDraftInvoiceItems(tx, {
        invoiceId: id,
        tenantId,
        headerData: {
          customer_id: invoiceData.customerId,
          vehicle_id: invoiceData.vehicleId,
          notes: invoiceData.notes,
          internal_notes: invoiceData.internalNotes,
          total_net: totalNet,
          total_tax: totalTax,
          total_gross: totalGross,
        },
        formattedItems,
      }),
    );
  }

  async finalize(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenant_id: tenantId },
      include: { items: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be finalized');
    }

    await this.financeService.validateTransactionDate(invoice.date);

<<<<<<< HEAD
    // Execute everything in a single transaction
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate Invoice Number (Atomic)
      const invoiceNumber = await this.generateInvoiceNumber(tx, tenantId);

      // 2. Process Inventory Transactions

      // 2a. Pre-fetch required inventory stock inside transaction to avoid stale reads
      const uniqueCatalogItemIds = [
        ...new Set(
          invoice.items
            .map((item) => item.catalog_item_id)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];

      const stockMap = new Map<string, InventoryStock[]>();
      if (uniqueCatalogItemIds.length > 0) {
        const stocks = await tx.inventoryStock.findMany({
          where: {
            tenant_id: tenantId,
            catalog_item_id: { in: uniqueCatalogItemIds },
          },
          orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
        });
        stocks.forEach((stock) => {
          const list = stockMap.get(stock.catalog_item_id) || [];
          list.push(stock);
          stockMap.set(stock.catalog_item_id, list);
        });
      }

      // 2b. Iterate sequentially in memory to assign locations, then aggregate updates by (catalog_item_id + location_id)
      const stockUpdatesMap = new Map<
        string,
        {
          catalog_item_id: string;
          locationId: string;
          quantityToDeduct: Decimal;
        }
      >();
      const transactionCreations: Prisma.InventoryTransactionCreateManyInput[] =
        [];

      for (const item of invoice.items) {
        if (!item.catalog_item_id) continue;

        const quantityToDeduct = new Decimal(item.quantity);
        if (!quantityToDeduct.isFinite() || quantityToDeduct.lte(0)) {
          throw new BadRequestException(
            `Invalid inventory quantity for item ${item.description}. Stock-tracked items require a positive quantity.`,
          );
        }

        const stocks = stockMap.get(item.catalog_item_id) || [];

        // Find first location with sufficient stock, or fallback to first one available
        const stock =
          stocks.find((s) =>
            new Decimal(s.quantity_on_hand).gte(quantityToDeduct),
          ) || stocks[0];

        if (!stock) {
          throw new BadRequestException(
            `No stock record found for item ${item.description}`,
          );
        }

        // Dry run validation
        if (new Decimal(stock.quantity_on_hand).lt(quantityToDeduct)) {
          throw new BadRequestException(
            `Insufficient stock for item ${item.description} at location ${stock.location_id} (Req: ${quantityToDeduct.toString()}, Available: ${stock.quantity_on_hand.toString()})`,
          );
        }

        const locationId = stock.location_id;
        const compositeKey = `${item.catalog_item_id}_${locationId}`;

        const existingUpdate = stockUpdatesMap.get(compositeKey) || {
          catalog_item_id: item.catalog_item_id,
          locationId,
          quantityToDeduct: new Decimal(0),
        };

        existingUpdate.quantityToDeduct =
          existingUpdate.quantityToDeduct.add(quantityToDeduct);
        stockUpdatesMap.set(compositeKey, existingUpdate);

        // Update local stock map for subsequent items of the same catalog ID sequentially
        stock.quantity_on_hand = new Decimal(stock.quantity_on_hand).sub(
          quantityToDeduct,
        );

        // Preserve 1:1 audit trail granularity for transactions
        transactionCreations.push({
          tenant_id: tenantId,
          item_id: item.catalog_item_id,
          location_id: locationId,
          quantity: new Prisma.Decimal(item.quantity).negated(),
          type: TransactionType.SALE_ISSUE,
          reference_id: invoiceNumber,
        });
      }

      // 2c. Execute updates concurrently and create transactions in bulk
      const stockUpdates = Array.from(stockUpdatesMap.values());
      await chunkedPromiseAll(stockUpdates, async (update) => {
        const updateResult = await tx.inventoryStock.updateMany({
          where: {
            catalog_item_id: update.catalog_item_id,
            location_id: update.locationId,
            quantity_on_hand: { gte: update.quantityToDeduct }, // Ensure sufficient stock
          },
          data: {
            quantity_on_hand: { decrement: update.quantityToDeduct },
          },
        });

        if (updateResult.count === 0) {
          // Refetch stock to give accurate error message if concurrency was high
          const latestStock = await tx.inventoryStock.findFirst({
            where: {
              tenant_id: tenantId,
              catalog_item_id: update.catalog_item_id,
              location_id: update.locationId,
            },
          });
          throw new BadRequestException(
            `Insufficient stock for item at location ${update.locationId} (Req: ${update.quantityToDeduct.toString()}, Available: ${latestStock?.quantity_on_hand.toString() ?? '0'})`,
          );
        }
      });

      if (transactionCreations.length > 0) {
        await tx.inventoryTransaction.createMany({
          data: transactionCreations,
        });
      }

      // 3. Update Invoice Status and return updated invoice (Concurrency Safe)
      await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
        id,
        tenantId,
        from: InvoiceStatus.DRAFT,
        to: InvoiceStatus.FINALIZED,
        extraData: { invoice_number: invoiceNumber },
        conflictMessage: 'Invoice was already transitioned by another request',
      });

      const updatedInvoice = await tx.invoice.findFirst({
        where: { id },
        include: { items: true, customer: true },
      });

      if (!updatedInvoice) {
        throw new NotFoundException('Invoice not found after update');
      }

      if (invoice.sales_order_id) {
        const salesOrder = await tx.salesOrder.findFirst({
          where: { id: invoice.sales_order_id },
          select: { status: true },
        });

        if (!salesOrder) {
          throw new NotFoundException('Sales order not found');
        }

        const allowedStatuses = new Set<SalesOrderStatus>([
          SalesOrderStatus.CONFIRMED,
          SalesOrderStatus.IN_PROGRESS,
          SalesOrderStatus.COMPLETED,
        ]);

        if (!allowedStatuses.has(salesOrder.status)) {
          throw new BadRequestException(
            'Sales order must be CONFIRMED, IN_PROGRESS, or COMPLETED to be invoiced',
          );
        }

        await guardedStatusUpdate(bindStatusUpdateMany(tx.salesOrder), {
          id: invoice.sales_order_id,
          tenantId,
          from: salesOrder.status,
          to: SalesOrderStatus.INVOICED,
          conflictMessage:
            'Sales order status changed concurrently. Please refresh and try again.',
        });
      }

      return updatedInvoice;
    });
  }

  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RE-${year}-`;

    // Upsert the sequence for the current year
    const sequence = await tx.invoiceSequence.upsert({
      where: { tenant_id_year: { tenant_id: tenantId, year } },
      update: { current: { increment: 1 } },
      create: { tenant_id: tenantId, year, current: 1 },
    });

    return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
=======
    return this.prisma.$transaction(async (tx) =>
      this.invoiceFinalization.finalizeInTransaction(tx, tenantId, invoice),
    );
>>>>>>> 18ee2c6 (refactor(sales): decompose SalesService brain methods and deduplicate logic)
  }

  async findAll() {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.invoice.findMany({
      where: { tenant_id: tenantId },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, tenant_id: tenantId },
      include: { customer: true, items: true, vehicle: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return {
      ...invoice,
      vehicle: invoice.vehicle
        ? stripVehicleIdentityResolutionState(invoice.vehicle)
        : invoice.vehicle,
    };
  }
}
