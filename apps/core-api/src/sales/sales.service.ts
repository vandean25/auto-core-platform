import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { Prisma, InvoiceStatus, TransactionType } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async createDraft(createInvoiceDto: CreateInvoiceDto) {
    const { items, ...invoiceData } = createInvoiceDto;

    // Calculate totals
    let totalNet = 0;
    let totalTax = 0;

    const formattedItems = items.map((item) => {
      const net = item.quantity * item.unitPrice;
      const tax = net * (item.taxRate / 100);
      totalNet += net;
      totalTax += tax;

      return {
        catalog_item_id: item.catalogItemId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        tax_rate: item.taxRate,
      };
    });

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

    // 1. Generate Invoice Number
    const invoiceNumber = await this.generateInvoiceNumber();

    // 2. Process Inventory Transactions
    await this.prisma.$transaction(async (tx) => {
      for (const item of invoice.items) {
        if (item.catalog_item_id) {
          // Check stock
          const stock = await tx.inventoryStock.findFirst({
            where: { catalog_item_id: item.catalog_item_id },
          });

          if (!stock || stock.quantity_on_hand < Number(item.quantity)) {
            throw new BadRequestException(
              `Insufficient stock for item ${item.description}`,
            );
          }

          const locationId = stock.location_id;

          if (locationId) {
             // Create Sale Issue Transaction
              await tx.inventoryTransaction.create({
                data: {
                  item_id: item.catalog_item_id,
                  location_id: locationId,
                  quantity: new Prisma.Decimal(item.quantity).negated(), // Negative for sale
                  type: TransactionType.SALE_ISSUE,
                  reference_id: invoiceNumber,
                  // Cost basis logic would be more complex (FIFO/LIFO), skipping for MVP
                },
              });

               // Update Stock Quantity
              await tx.inventoryStock.updateMany({
                where: {
                    catalog_item_id: item.catalog_item_id,
                    location_id: locationId
                },
                data: {
                    quantity_on_hand: {
                        decrement: Number(item.quantity)
                    }
                }
              })
           }
        }
      }

      // 3. Update Invoice Status
      await tx.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.FINALIZED,
          invoice_number: invoiceNumber,
        },
      });
    });

    return this.prisma.invoice.findUnique({ where: { id } });
  }

  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RE-${year}-`;

    const lastInvoice = await this.prisma.invoice.findFirst({
      where: {
        invoice_number: {
          startsWith: prefix,
        },
      },
      orderBy: {
        invoice_number: 'desc',
      },
    });

    let nextNumber = 1;
    if (lastInvoice && lastInvoice.invoice_number) {
      const parts = lastInvoice.invoice_number.split('-');
      const lastSeq = parseInt(parts[2], 10);
      if (!isNaN(lastSeq)) {
        nextNumber = lastSeq + 1;
      }
    }

    return `${prefix}${nextNumber.toString().padStart(4, '0')}`;
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
