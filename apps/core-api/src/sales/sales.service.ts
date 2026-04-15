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

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  async createDraft(createInvoiceDto: CreateInvoiceDto) {
    const { items = [], ...invoiceData } = createInvoiceDto;

    if (!items || items.length === 0) {
      throw new BadRequestException('Invoice must have at least one item');
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
        where: { id: { in: uniqueCatalogItemIds } },
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

        if (catalogItem?.revenue_group) {
          revenueGroupName = catalogItem.revenue_group.name;
          taxRate = Number(catalogItem.revenue_group.tax_rate);
        }
      }

      const net = item.quantity * item.unitPrice;
      const tax = net * (taxRate / 100);
      totalNet += net;
      totalTax += tax;

      formattedItems.push({
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
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
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
      const invoiceNumber = await this.generateInvoiceNumber(tx);

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
          where: { catalog_item_id: { in: uniqueCatalogItemIds } },
          orderBy: [{ quantity_on_hand: 'desc' }, { location_id: 'asc' }],
        });
        stocks.forEach((stock) => {
          const list = stockMap.get(stock.catalog_item_id) || [];
          list.push(stock);
          stockMap.set(stock.catalog_item_id, list);
        });
      }

      // 2b. Iterate sequentially through invoice items to maintain 1:1 mapping in ledger
      for (const item of invoice.items) {
        if (item.catalog_item_id) {
          const stocks = stockMap.get(item.catalog_item_id) || [];
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

          // Find first location with sufficient stock, or fallback to first one available
          const stock =
            stocks.find((s) => s.quantity_on_hand >= quantityToDeduct) ||
            stocks[0];

          if (!stock) {
            throw new BadRequestException(
              `No stock record found for item ${item.description}`,
            );
          }

          const locationId = stock.location_id;

          // Atomic Update with Check (Optimistic Locking via WHERE clause)
          const updateResult = await tx.inventoryStock.updateMany({
            where: {
              catalog_item_id: item.catalog_item_id,
              location_id: locationId,
              quantity_on_hand: { gte: quantityToDeduct }, // Ensure sufficient stock
            },
            data: {
              quantity_on_hand: { decrement: quantityToDeduct },
            },
          });

          if (updateResult.count === 0) {
            // Refetch stock to give accurate error message if concurrency was high
            const latestStock = await tx.inventoryStock.findUnique({
              where: {
                catalog_item_id_location_id: {
                  catalog_item_id: item.catalog_item_id,
                  location_id: locationId,
                },
              },
            });
            throw new BadRequestException(
              `Insufficient stock for item ${item.description} at location ${locationId} (Req: ${quantityToDeduct}, Available: ${latestStock?.quantity_on_hand ?? 0})`,
            );
          }

          // Update local stock map for subsequent items of the same catalog ID
          stock.quantity_on_hand -= quantityToDeduct;

          // Create Sale Issue Transaction (Per-item for audit trail granularity)
          await tx.inventoryTransaction.create({
            data: {
              item_id: item.catalog_item_id,
              location_id: locationId,
              quantity: new Prisma.Decimal(item.quantity).negated(),
              type: TransactionType.SALE_ISSUE,
              reference_id: invoiceNumber,
            },
          });
        }
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
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RE-${year}-`;

    // Upsert the sequence for the current year
    const sequence = await tx.invoiceSequence.upsert({
      where: { year },
      update: { current: { increment: 1 } },
      create: { year, current: 1 },
    });

    return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
  }

  async findAll() {
    return this.prisma.invoice.findMany({
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { customer: true, items: true, vehicle: true },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
    return invoice;
  }
}
