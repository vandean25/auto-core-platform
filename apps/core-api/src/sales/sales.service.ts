import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  Prisma,
  InvoiceStatus,
  SalesOrderStatus,
  TransactionType,
} from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  async createDraft(createInvoiceDto: CreateInvoiceDto) {
    const { items, ...invoiceData } = createInvoiceDto;

    // Calculate totals and snapshot revenue groups
    let totalNet = 0;
    let totalTax = 0;

    const formattedItems: Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput[] =
      [];

    // 1. Extract unique IDs and pre-fetch
    const uniqueCatalogItemIds = [...new Set(items.map(i => i.catalogItemId).filter(id => id !== undefined && id !== null))];

    // 2. Fetch all required catalog items in one query
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { id: { in: uniqueCatalogItemIds as string[] } },
      include: { revenue_group: true },
    });

    // 3. Build a Map for O(1) lookups
    const catalogItemMap = new Map(catalogItems.map(item => [item.id, item]));

    // 4. Iterate over original items to preserve order
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

      // 2a. Aggregate quantities by catalog_item_id to handle duplicates properly
      const itemQuantities = new Map<string, { quantity: number, description: string }>();
      for (const item of invoice.items) {
        if (item.catalog_item_id) {
          const existing = itemQuantities.get(item.catalog_item_id);
          if (existing) {
            existing.quantity += Number(item.quantity);
          } else {
            itemQuantities.set(item.catalog_item_id, {
              quantity: Number(item.quantity),
              description: item.description || 'Unknown Item'
            });
          }
        }
      }

      // 2b. Extract unique IDs and pre-fetch inventory stock
      const uniqueCatalogItemIdsForStock = Array.from(itemQuantities.keys());

      if (uniqueCatalogItemIdsForStock.length > 0) {
        const stocks = await tx.inventoryStock.findMany({
          where: { catalog_item_id: { in: uniqueCatalogItemIdsForStock } },
        });

        // 2c. Build a Map for O(1) lookups. Assuming one primary location per item for now as per original logic.
        const stockMap = new Map(stocks.map(stock => [stock.catalog_item_id, stock]));

        // 2d. Prepare write payloads and execute concurrently
        const aggregatedItems = Array.from(itemQuantities.entries());

        await chunkedPromiseAll(aggregatedItems, async ([catalogItemId, data]) => {
          const stock = stockMap.get(catalogItemId);

          if (!stock) {
            throw new BadRequestException(
              `No stock record found for item ${data.description}`,
            );
          }

          const locationId = stock.location_id;
          const quantityToDeduct = data.quantity;

          // Atomic Update with Check (Optimistic Locking via WHERE clause)
          const updateResult = await tx.inventoryStock.updateMany({
            where: {
              catalog_item_id: catalogItemId,
              location_id: locationId,
              quantity_on_hand: { gte: quantityToDeduct }, // Ensure sufficient stock
            },
            data: {
              quantity_on_hand: { decrement: quantityToDeduct },
            },
          });

          if (updateResult.count === 0) {
            throw new BadRequestException(
              `Insufficient stock for item ${data.description} (Req: ${quantityToDeduct}, Available: ${stock.quantity_on_hand})`,
            );
          }

          // Create Sale Issue Transaction
          await tx.inventoryTransaction.create({
            data: {
              item_id: catalogItemId,
              location_id: locationId,
              quantity: new Prisma.Decimal(quantityToDeduct).negated(),
              type: TransactionType.SALE_ISSUE,
              reference_id: invoiceNumber,
            },
          });
        });
      }

      // 3. Update Invoice Status and return updated invoice
      const updatedInvoice = await tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.FINALIZED,
          invoice_number: invoiceNumber,
        },
        include: { items: true, customer: true },
      });

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
