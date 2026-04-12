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
  InventoryStock,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';

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

    for (const item of items) {
      let taxRate = item.taxRate;
      let revenueGroupName: string | null = null;

      if (item.catalogItemId) {
        const catalogItem = await this.prisma.catalogItem.findUnique({
          where: { id: item.catalogItemId },
          include: { revenue_group: true },
        });

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

    // Pre-fetch & Map: Extract unique catalogItemId and locationId pairs
    const catalogItemIdsWithQuantities = invoice.items
      .filter((item) => item.catalog_item_id !== null)
      .map((item) => ({
        id: item.catalog_item_id as string,
        quantity: Number(item.quantity),
      }));

    const uniqueCatalogItemIds = [
      ...new Set(catalogItemIdsWithQuantities.map((item) => item.id)),
    ];

    // Find all required stock records
    // Assuming primary location for now by finding ANY stock location for the item, just like original
    const stocks = await this.prisma.inventoryStock.findMany({
      where: {
        catalog_item_id: { in: uniqueCatalogItemIds },
      },
      // Order to pick first location deterministically if needed, original code used findFirst which is non-deterministic
      orderBy: { location_id: 'asc' },
    });

    // We only need the FIRST stock location for each item to match the original logic
    const stockMap = new Map<string, InventoryStock>();
    for (const stock of stocks) {
      if (!stockMap.has(stock.catalog_item_id)) {
        stockMap.set(stock.catalog_item_id, stock);
      }
    }

    // Execute everything in a single transaction
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate Invoice Number (Atomic)
      const invoiceNumber = await this.generateInvoiceNumber(tx);

      // Arrays to hold promise definitions for concurrent execution
      const operations: (() => Promise<any>)[] = [];

      // 2. Process Inventory Transactions and prepare chunked operations
      for (const item of invoice.items) {
        if (item.catalog_item_id) {
          const stock = stockMap.get(item.catalog_item_id);

          if (!stock) {
            throw new BadRequestException(
              `No stock record found for item ${item.description}`,
            );
          }

          const locationId = stock.location_id;
          const quantityToDeduct = Number(item.quantity);

          if (Number(stock.quantity_on_hand) < quantityToDeduct) {
            throw new BadRequestException(
              `Insufficient stock for item ${item.description} (Req: ${quantityToDeduct}, Available: ${stock.quantity_on_hand})`,
            );
          }

          operations.push(async () => {
            const updateResult = await tx.inventoryStock.updateMany({
              where: {
                catalog_item_id: item.catalog_item_id!,
                location_id: locationId,
                quantity_on_hand: { gte: quantityToDeduct }, // Ensure sufficient stock
              },
              data: {
                quantity_on_hand: { decrement: quantityToDeduct },
              },
            });

            if (updateResult.count === 0) {
              throw new BadRequestException(
                `Insufficient stock for item ${item.description} (Req: ${quantityToDeduct})`,
              );
            }
          });

          // Create Sale Issue Transaction
          operations.push(async () => {
            await tx.inventoryTransaction.create({
              data: {
                item_id: item.catalog_item_id!,
                location_id: locationId,
                quantity: new Prisma.Decimal(item.quantity).negated(),
                type: TransactionType.SALE_ISSUE,
                reference_id: invoiceNumber,
              },
            });
          });
        }
      }

      // Execute Concurrently in batches
      await chunkedPromiseAll(operations, (op) => op(), 50);

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
