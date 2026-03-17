import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { PurchaseInvoiceStatus, Prisma } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    private prisma: PrismaService,
    private readonly realtimeService: DashboardRealtimeService,
  ) {}

  async getUnbilledReceipts(vendorId: string, invoiceId?: string) {
    const poItems = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchase_order: {
          vendor_id: vendorId,
        },
        quantity_received: {
          gt: 0,
        },
      },
      include: {
        purchase_order: true,
        catalog_item: true,
        purchase_invoice_lines: {
          where: {
            purchase_invoice_id: invoiceId,
          },
        },
      },
    });

    // Filter in memory or use raw query for complex decimal comparison if needed.
    // Prisma Decimal comparison in where clause works, but comparing two columns is tricky.
    // We'll filter in JS for simplicity as this list shouldn't be massive per vendor.

    return poItems
      .filter((item) => {
        const received = item.quantity_received;
        const invoiced = Number(item.quantity_invoiced);
        const onCurrentInvoice = item.purchase_invoice_lines.length > 0;
        return received > invoiced || onCurrentInvoice;
      })
      .map((item) => ({
        purchaseOrderItemId: item.id,
        purchaseOrderId: item.purchase_order_id,
        purchaseOrderNumber: item.purchase_order.order_number,
        catalogItemId: item.catalog_item_id,
        catalogItemName: item.catalog_item.name,
        quantityReceived: item.quantity_received,
        quantityInvoiced: Number(item.quantity_invoiced),
        quantityPending:
          item.quantity_received - Number(item.quantity_invoiced),
        lastUnitCost: Number(item.unit_cost),
      }));
  }

  async create(createDto: CreatePurchaseInvoiceDto) {
    const { items, ...data } = createDto;
    const poItemTotals = new Map<string, number>();

    for (const line of items) {
      if (!line.purchaseOrderItemId) continue;
      const currentTotal = poItemTotals.get(line.purchaseOrderItemId) ?? 0;
      poItemTotals.set(line.purchaseOrderItemId, currentTotal + line.quantity);
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      if (poItemTotals.size > 0) {
        const poItemIds = Array.from(poItemTotals.keys());
        const poItems = await tx.purchaseOrderItem.findMany({
          where: { id: { in: poItemIds } },
          include: {
            purchase_order: {
              select: {
                vendor_id: true,
              },
            },
          },
        });

        const poItemsById = new Map(poItems.map((poItem) => [poItem.id, poItem]));

        for (const [poItemId, requestedQuantity] of poItemTotals) {
          const poItem = poItemsById.get(poItemId);
          if (!poItem) {
            throw new NotFoundException(`PO Item ${poItemId} not found`);
          }

          if (poItem.purchase_order.vendor_id !== data.vendorId) {
            throw new BadRequestException(
              `PO Item ${poItemId} does not belong to vendor ${data.vendorId}`,
            );
          }

          const pending =
            poItem.quantity_received - Number(poItem.quantity_invoiced);
          if (requestedQuantity > pending) {
            throw new BadRequestException(
              `Cannot invoice ${requestedQuantity} for PO Item ${poItemId}. Only ${pending} pending.`,
            );
          }
        }
      }

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
          lines: true,
        },
      });

      // Update quantity_invoiced on PO items
      for (const [poItemId, quantity] of poItemTotals) {
        await tx.purchaseOrderItem.update({
          where: { id: poItemId },
          data: {
            quantity_invoiced: {
              increment: quantity,
            },
          },
        });
      }

      return invoice;
    });

    this.realtimeService.emitEntityUpdated({
      type: 'PURCHASE_INVOICE',
      action: 'CREATED',
      entityId: invoice.id,
    });

    return invoice;
  }

  async update(id: string, updateDto: CreatePurchaseInvoiceDto) {
    const { items, ...data } = updateDto;
    const poItemTotals = new Map<string, number>();

    for (const line of items) {
      if (!line.purchaseOrderItemId) continue;
      const currentTotal = poItemTotals.get(line.purchaseOrderItemId) ?? 0;
      poItemTotals.set(line.purchaseOrderItemId, currentTotal + line.quantity);
    }

    const updatedInvoice = await this.prisma.$transaction(async (tx) => {
      const existingInvoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        include: { lines: true },
      });

      if (!existingInvoice) throw new NotFoundException('Invoice not found');
      if (existingInvoice.status !== PurchaseInvoiceStatus.DRAFT) {
        throw new BadRequestException('Only DRAFT invoices can be updated');
      }

      // 1. Rollback old quantity_invoiced
      for (const line of existingInvoice.lines) {
        if (line.purchase_order_item_id) {
          await tx.purchaseOrderItem.update({
            where: { id: line.purchase_order_item_id },
            data: {
              quantity_invoiced: {
                decrement: line.quantity,
              },
            },
          });
        }
      }

      // 2. Validate new quantities (similar to create)
      if (poItemTotals.size > 0) {
        const poItemIds = Array.from(poItemTotals.keys());
        const poItems = await tx.purchaseOrderItem.findMany({
          where: { id: { in: poItemIds } },
          include: {
            purchase_order: {
              select: {
                vendor_id: true,
              },
            },
          },
        });

        const poItemsById = new Map(poItems.map((poItem) => [poItem.id, poItem]));

        for (const [poItemId, requestedQuantity] of poItemTotals) {
          const poItem = poItemsById.get(poItemId);
          if (!poItem) {
            throw new NotFoundException(`PO Item ${poItemId} not found`);
          }

          if (poItem.purchase_order.vendor_id !== data.vendorId) {
            throw new BadRequestException(
              `PO Item ${poItemId} does not belong to vendor ${data.vendorId}`,
            );
          }

          const pending =
            poItem.quantity_received - Number(poItem.quantity_invoiced);
          if (requestedQuantity > pending) {
            throw new BadRequestException(
              `Cannot invoice ${requestedQuantity} for PO Item ${poItemId}. Only ${pending} pending.`,
            );
          }
        }
      }

      // 3. Clear existing lines
      await tx.purchaseInvoiceLine.deleteMany({
        where: { purchase_invoice_id: id },
      });

      // 4. Update invoice header and create new lines
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

      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: {
          vendor_id: data.vendorId,
          vendor_invoice_number: data.vendorInvoiceNumber,
          invoice_date: new Date(data.invoiceDate),
          due_date: new Date(data.dueDate),
          total_amount: totalAmount,
          lines: {
            create: linesData,
          },
        },
        include: {
          lines: true,
        },
      });

      // 5. Apply new quantity_invoiced
      for (const [poItemId, quantity] of poItemTotals) {
        await tx.purchaseOrderItem.update({
          where: { id: poItemId },
          data: {
            quantity_invoiced: {
              increment: quantity,
            },
          },
        });
      }

      return updated;
    });

    this.realtimeService.emitEntityUpdated({
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return updatedInvoice;
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

    const postedInvoice = await this.prisma.purchaseInvoice.update({
      where: { id },
      data: { status: PurchaseInvoiceStatus.POSTED },
    });

    this.realtimeService.emitEntityUpdated({
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return postedInvoice;
  }

  async pay(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== PurchaseInvoiceStatus.POSTED) {
      throw new BadRequestException('Only POSTED invoices can be marked as PAID');
    }

    const paidInvoice = await this.prisma.purchaseInvoice.update({
      where: { id },
      data: { status: PurchaseInvoiceStatus.PAID },
    });

    this.realtimeService.emitEntityUpdated({
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return paidInvoice;
  }

  async remove(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT invoices can be deleted');
    }

    // When deleting an invoice, we MUST decrement quantity_invoiced on PO items
    // to avoid ghost allocations.
    await this.prisma.$transaction(async (tx) => {
      const lines = await tx.purchaseInvoiceLine.findMany({
        where: { purchase_invoice_id: id },
      });

      for (const line of lines) {
        if (line.purchase_order_item_id) {
          await tx.purchaseOrderItem.update({
            where: { id: line.purchase_order_item_id },
            data: {
              quantity_invoiced: {
                decrement: line.quantity,
              },
            },
          });
        }
      }

      await tx.purchaseInvoice.delete({
        where: { id },
      });
    });

    this.realtimeService.emitEntityUpdated({
      type: 'PURCHASE_INVOICE',
      action: 'DELETED',
      entityId: id,
    });

    return { success: true };
  }

  async removeLine(invoiceId: string, lineId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const line = await tx.purchaseInvoiceLine.findUnique({
        where: { id: lineId },
      });

      if (!line || line.purchase_invoice_id !== invoiceId) {
        throw new NotFoundException('Line not found');
      }

      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
        throw new BadRequestException('Can only delete lines from DRAFT invoices');
      }

      // 1. Unlink PO Item if applicable
      if (line.purchase_order_item_id) {
        await tx.purchaseOrderItem.update({
          where: { id: line.purchase_order_item_id },
          data: {
            quantity_invoiced: {
              decrement: line.quantity,
            },
          },
        });
      }

      // 2. Delete the line
      await tx.purchaseInvoiceLine.delete({
        where: { id: lineId },
      });

      // 3. Recalculate invoice total
      const remainingLines = await tx.purchaseInvoiceLine.findMany({
        where: { purchase_invoice_id: invoiceId },
      });

      const newTotal = remainingLines.reduce(
        (sum, l) => sum + Number(l.line_total),
        0,
      );

      await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { total_amount: newTotal },
      });

      this.realtimeService.emitEntityUpdated({
        type: 'PURCHASE_INVOICE',
        action: 'UPDATED',
        entityId: invoiceId,
      });

      return { success: true };
    });
  }

  async findAll(
    vendorId?: string,
    status?: PurchaseInvoiceStatus,
    page: number = 1,
    pageSize: number = 25,
    sortBy: string = 'due_date',
    order: 'asc' | 'desc' = 'asc',
  ) {
    // Whitelist allowed sortBy fields to prevent SQL injection
    const ALLOWED_SORT_BY = [
      'vendor_invoice_number',
      'status',
      'invoice_date',
      'due_date',
      'total_amount',
      'createdAt',
    ];

    if (!ALLOWED_SORT_BY.includes(sortBy)) {
      throw new BadRequestException(`Invalid sortBy field: ${sortBy}. Allowed: ${ALLOWED_SORT_BY.join(', ')}`);
    }

    // Normalize order to valid values
    const normalizedOrder = order === 'desc' ? 'desc' : 'asc';

    const skip = (page - 1) * pageSize;

    const where: Prisma.PurchaseInvoiceWhereInput = {
      ...(vendorId && { vendor_id: vendorId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where,
        include: {
          vendor: true,
        },
        orderBy: { [sortBy]: normalizedOrder },
        skip,
        take: pageSize,
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);

    const pageCount = Math.ceil(total / pageSize);

    return {
      data,
      meta: {
        total,
        page,
        pageSize,
        pageCount,
      },
    };
  }

  async findOne(id: string) {
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { id },
      include: {
        vendor: true,
        lines: {
          include: {
            purchase_order_item: {
              include: {
                purchase_order: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
