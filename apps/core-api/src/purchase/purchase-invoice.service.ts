import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { PurchaseInvoiceStatus, Prisma } from '@prisma/client';

@Injectable()
export class PurchaseInvoiceService {
  constructor(private prisma: PrismaService) {}

  async getUnbilledReceipts(vendorId: string) {
    const poItems = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchase_order: {
          vendor_id: vendorId,
        },
        quantity_received: {
            gt: 0 
        }
      },
      include: {
        purchase_order: true,
        catalog_item: true,
      },
    });

    // Filter in memory or use raw query for complex decimal comparison if needed.
    // Prisma Decimal comparison in where clause works, but comparing two columns is tricky.
    // We'll filter in JS for simplicity as this list shouldn't be massive per vendor.
    
    return poItems
      .filter((item) => {
          const received = item.quantity_received;
          const invoiced = Number(item.quantity_invoiced);
          return received > invoiced;
      })
      .map((item) => ({
        purchaseOrderItemId: item.id,
        purchaseOrderId: item.purchase_order_id,
        purchaseOrderNumber: item.purchase_order.order_number,
        catalogItemId: item.catalog_item_id,
        catalogItemName: item.catalog_item.name,
        quantityReceived: item.quantity_received,
        quantityInvoiced: Number(item.quantity_invoiced),
        quantityPending: item.quantity_received - Number(item.quantity_invoiced),
        lastUnitCost: Number(item.unit_cost),
      }));
  }

  async create(createDto: CreatePurchaseInvoiceDto) {
    const { items, ...data } = createDto;

    // Validate quantities for PO items
    for (const line of items) {
      if (line.purchaseOrderItemId) {
        const poItem = await this.prisma.purchaseOrderItem.findUnique({
          where: { id: line.purchaseOrderItemId },
        });

        if (!poItem) {
          throw new NotFoundException(`PO Item ${line.purchaseOrderItemId} not found`);
        }

        const pending = poItem.quantity_received - Number(poItem.quantity_invoiced);
        if (line.quantity > pending) {
          throw new BadRequestException(
            `Cannot invoice ${line.quantity} for item ${line.description}. Only ${pending} pending.`,
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let totalAmount = 0;
      const linesData = items.map((line) => {
        const lineTotal = line.quantity * line.unitPrice;
        totalAmount += lineTotal;
        return {
          purchase_order_item_id: line.purchaseOrderItemId,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: lineTotal,
        };
      });

      const invoice = await tx.purchaseInvoice.create({
        data: {
          vendor_id: data.vendorId,
          vendor_invoice_number: data.vendorInvoiceNumber,
          invoice_date: new Date(data.invoiceDate),
          due_date: new Date(data.dueDate),
          status: PurchaseInvoiceStatus.DRAFT,
          total_amount: totalAmount,
          lines: {
            create: linesData,
          },
        },
        include: {
            lines: true
        }
      });

      // Update quantity_invoiced on PO items
      for (const line of items) {
        if (line.purchaseOrderItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: line.purchaseOrderItemId },
            data: {
              quantity_invoiced: {
                increment: line.quantity,
              },
            },
          });
        }
      }

      return invoice;
    });
  }

  async post(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be posted');
    }

    if (invoice.lines.length === 0) {
      throw new BadRequestException('Cannot post an invoice without lines');
    }

    // Here we would create Ledger Entries (GL)
    // For now, just update status
    
    return this.prisma.purchaseInvoice.update({
        where: { id },
        data: { status: PurchaseInvoiceStatus.POSTED }
    });
  }

  async findAll(vendorId?: string, status?: PurchaseInvoiceStatus) {
    return this.prisma.purchaseInvoice.findMany({
      where: {
        vendor_id: vendorId,
        status: status,
      },
      include: {
        vendor: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: { vendor: true, lines: true },
    });
     if (!invoice) throw new NotFoundException('Invoice not found');
     return invoice;
  }
}
