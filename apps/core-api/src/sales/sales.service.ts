import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  Prisma,
  InvoiceStatus,
  SalesOrderStatus,
  TransactionType,
} from '@prisma/client';
import type { CatalogItem, RevenueGroup, InventoryStock } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createDraft(createInvoiceDto: CreateInvoiceDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const { items = [], ...invoiceData } = createInvoiceDto;

    if (!items || items.length === 0) {
      throw new BadRequestException('Invoice must have at least one item');
    }

    // Tenant isolation checks
    if (invoiceData.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: invoiceData.customerId, tenant_id: tenantId },
      });
      if (!customer) {
        throw new BadRequestException(
          'Customer not found or belongs to another tenant',
        );
      }
    }

    if (invoiceData.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: invoiceData.vehicleId, tenant_id: tenantId },
      });
      if (!vehicle) {
        throw new BadRequestException(
          'Vehicle not found or belongs to another tenant',
        );
      }
    }

    // Calculate totals and snapshot revenue groups
    let totalNet = 0;
    let totalTax = 0;

    const formattedItems: Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput[] =
      [];

    // 1. Extract unique IDs and pre-fetch catalog items
    const uniqueCatalogItemIds = [
      ...new Set(
        items
          .map((i) => i.catalogItemId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    const catalogItemMap = new Map<
      string,
      CatalogItem & { revenue_group: RevenueGroup | null }
    >();
    if (uniqueCatalogItemIds.length > 0) {
      const catalogItems = await this.prisma.catalogItem.findMany({
        where: { tenant_id: tenantId, id: { in: uniqueCatalogItemIds } },
        include: { revenue_group: true },
        orderBy: { id: 'asc' },
      });
      catalogItems.forEach((item) => catalogItemMap.set(item.id, item));
    }

    // 2. Iterate over original items to preserve order
    for (const item of items) {
      let taxRate = item.taxRate;
      let revenueGroupName: string | null = null;

      if (item.catalogItemId) {
        const catalogItem = catalogItemMap.get(item.catalogItemId);

        if (!catalogItem) {
          throw new BadRequestException(
            `Catalog item ${item.catalogItemId} not found or belongs to another tenant`,
          );
        }

        if (catalogItem.revenue_group) {
          revenueGroupName = catalogItem.revenue_group.name;
          taxRate = Number(catalogItem.revenue_group.tax_rate);
        }
      }

      const net = item.quantity * item.unitPrice;
      const tax = net * (taxRate / 100);
      totalNet += net;
      totalTax += tax;

      formattedItems.push({
        tenant_id: tenantId,
        catalog_item_id: item.catalogItemId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        tax_rate: taxRate,
        revenue_group_name: revenueGroupName,
      });
    }

    const totalGross = totalNet + totalTax;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14); // Default 14 days due date

    return this.prisma.invoice.create({
      data: {
        tenant_id: tenantId,
        customer_id: invoiceData.customerId,
        vehicle_id: invoiceData.vehicleId,
        notes: invoiceData.notes,
        internal_notes: invoiceData.internalNotes,
        status: InvoiceStatus.DRAFT,
        date: new Date(),
        due_date: dueDate,
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

    // Validate fiscal period before any changes
    await this.financeService.validateTransactionDate(invoice.date);

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
          quantityToDeduct: number;
        }
      >();
      const transactionCreations: Prisma.InventoryTransactionCreateManyInput[] =
        [];

      for (const item of invoice.items) {
        if (!item.catalog_item_id) continue;

        const quantityToDeduct = Number(item.quantity);
        if (
          !Number.isFinite(quantityToDeduct) ||
          !Number.isInteger(quantityToDeduct) ||
          quantityToDeduct <= 0
        ) {
          throw new BadRequestException(
            `Invalid inventory quantity for item ${item.description}. Stock-tracked items require a positive whole-number quantity.`,
          );
        }

        const stocks = stockMap.get(item.catalog_item_id) || [];

        // Find first location with sufficient stock, or fallback to first one available
        const stock =
          stocks.find((s) => s.quantity_on_hand >= quantityToDeduct) ||
          stocks[0];

        if (!stock) {
          throw new BadRequestException(
            `No stock record found for item ${item.description}`,
          );
        }

        // Dry run validation
        if (stock.quantity_on_hand < quantityToDeduct) {
          throw new BadRequestException(
            `Insufficient stock for item ${item.description} at location ${stock.location_id} (Req: ${quantityToDeduct}, Available: ${stock.quantity_on_hand})`,
          );
        }

        const locationId = stock.location_id;
        const compositeKey = `${item.catalog_item_id}_${locationId}`;

        const existingUpdate = stockUpdatesMap.get(compositeKey) || {
          catalog_item_id: item.catalog_item_id,
          locationId,
          quantityToDeduct: 0,
        };

        existingUpdate.quantityToDeduct += quantityToDeduct;
        stockUpdatesMap.set(compositeKey, existingUpdate);

        // Update local stock map for subsequent items of the same catalog ID sequentially
        stock.quantity_on_hand -= quantityToDeduct;

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
          const latestStock = await tx.inventoryStock.findUnique({
            where: {
              tenant_id_catalog_item_id_location_id: {
                tenant_id: tenantId,
                catalog_item_id: update.catalog_item_id,
                location_id: update.locationId,
              },
            },
          });
          throw new BadRequestException(
            `Insufficient stock for item at location ${update.locationId} (Req: ${update.quantityToDeduct}, Available: ${latestStock?.quantity_on_hand ?? 0})`,
          );
        }
      });

      if (transactionCreations.length > 0) {
        await tx.inventoryTransaction.createMany({
          data: transactionCreations,
        });
      }

      // 3. Update Invoice Status and return updated invoice (Concurrency Safe)
      const updateResult = await tx.invoice.updateMany({
        where: { id, status: InvoiceStatus.DRAFT },
        data: {
          status: InvoiceStatus.FINALIZED,
          invoice_number: invoiceNumber,
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException(
          'Invoice is no longer in DRAFT status or has been deleted.',
        );
      }

      const updatedInvoice = await tx.invoice.findUnique({
        where: { id },
        include: { items: true, customer: true },
      });

      if (!updatedInvoice) {
        throw new NotFoundException('Invoice not found after update');
      }

      if (invoice.sales_order_id) {
        const salesOrder = await tx.salesOrder.findUnique({
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

        await tx.salesOrder.update({
          where: { id: invoice.sales_order_id },
          data: { status: SalesOrderStatus.INVOICED },
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
    return invoice;
  }
}
