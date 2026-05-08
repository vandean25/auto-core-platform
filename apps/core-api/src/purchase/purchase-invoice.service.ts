import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { PurchaseInvoiceStatus, Prisma } from '@prisma/client';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    private prisma: PrismaService,
    private readonly realtimeService: DashboardRealtimeService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getUnbilledReceipts(vendorId: string, invoiceId?: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const poItems = await this.prisma.purchaseOrderItem.findMany({
      where: {
        tenant_id: tenantId,
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
        ...(invoiceId && {
          purchase_invoice_lines: {
            where: {
              purchase_invoice_id: invoiceId,
            },
          },
        }),
      },
    });

    // Filter in memory or use raw query for complex decimal comparison if needed.
    // Prisma Decimal comparison in where clause works, but comparing two columns is tricky.
    // We'll filter in JS for simplicity as this list shouldn't be massive per vendor.

    return poItems
      .filter((item) => {
        const received = item.quantity_received;
        const invoiced = Number(item.quantity_invoiced);
        const onCurrentInvoice = invoiceId
          ? item.purchase_invoice_lines?.length > 0
          : false;
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
    const tenantId = await this.tenantContext.getTenantId();
    const { items, ...data } = createDto;

    const vendorExists = await this.prisma.vendor.findFirst({
      where: { id: data.vendorId, tenant_id: tenantId },
    });
    if (!vendorExists) {
      throw new BadRequestException(
        'Vendor not found or belongs to another tenant',
      );
    }

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
          where: { tenant_id: tenantId, id: { in: poItemIds } },
          include: {
            purchase_order: {
              select: {
                vendor_id: true,
              },
            },
          },
        });

        const poItemsById = new Map(
          poItems.map((poItem) => [poItem.id, poItem]),
        );

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
        const lineNet = line.quantity * line.unitPrice;
        const taxRate = line.taxRate ?? 20;
        const lineTax = lineNet * (taxRate / 100);
        const lineTotal = lineNet + lineTax;
        totalAmount += lineTotal;
        return {
          tenant_id: tenantId,
          purchase_order_item_id: line.purchaseOrderItemId,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          tax_rate: taxRate,
          line_total: lineTotal,
        };
      });

      const invoice = await tx.purchaseInvoice.create({
        data: {
          tenant_id: tenantId,
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

      // Update quantity_invoiced on PO items (Optimized)
      const poItemsToUpdate = Array.from(poItemTotals.entries());
      await chunkedPromiseAll(poItemsToUpdate, async ([poItemId, quantity]) => {
        return tx.purchaseOrderItem.updateMany({
          where: { id: poItemId, tenant_id: tenantId },
          data: {
            quantity_invoiced: {
              increment: quantity,
            },
          },
        });
      });

      return invoice;
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'CREATED',
      entityId: invoice.id,
    });

    return invoice;
  }

  async update(id: string, updateDto: CreatePurchaseInvoiceDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const { items, ...data } = updateDto;

    const vendorExists = await this.prisma.vendor.findFirst({
      where: { id: data.vendorId, tenant_id: tenantId },
    });
    if (!vendorExists) {
      throw new BadRequestException(
        'Vendor not found or belongs to another tenant',
      );
    }

    const poItemTotals = new Map<string, number>();

    for (const line of items) {
      if (!line.purchaseOrderItemId) continue;
      const currentTotal = poItemTotals.get(line.purchaseOrderItemId) ?? 0;
      poItemTotals.set(line.purchaseOrderItemId, currentTotal + line.quantity);
    }

    const updatedInvoice = await this.prisma.$transaction(async (tx) => {
      // Atomic check and lock attempt via updateMany (which returns count)
      const updateCount = await tx.purchaseInvoice.updateMany({
        where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.DRAFT },
        data: { updatedAt: new Date() }, // Just to "touch" the row and ensure it's DRAFT
      });

      if (updateCount.count === 0) {
        throw new BadRequestException(
          'Invoice not found or no longer in DRAFT status',
        );
      }

      const existingInvoice = await tx.purchaseInvoice.findFirst({
        where: { id, tenant_id: tenantId },
        include: { lines: true },
      });

      if (!existingInvoice) throw new NotFoundException('Invoice not found');

      // 1. Rollback old quantity_invoiced (Optimized)
      const linesToRollback = existingInvoice.lines.filter(
        (l) => l.purchase_order_item_id,
      );
      await chunkedPromiseAll(linesToRollback, async (line) => {
        return tx.purchaseOrderItem.updateMany({
          where: {
            id: line.purchase_order_item_id as string,
            tenant_id: tenantId,
          },
          data: {
            quantity_invoiced: {
              decrement: line.quantity,
            },
          },
        });
      });

      // 2. Validate new quantities AFTER rollback to prevent race conditions
      if (poItemTotals.size > 0) {
        const poItemIds = Array.from(poItemTotals.keys());
        const poItems = await tx.purchaseOrderItem.findMany({
          where: { tenant_id: tenantId, id: { in: poItemIds } },
          include: {
            purchase_order: {
              select: {
                vendor_id: true,
              },
            },
          },
        });

        const poItemsById = new Map(
          poItems.map((poItem) => [poItem.id, poItem]),
        );

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
        const lineNet = line.quantity * line.unitPrice;
        const taxRate = line.taxRate ?? 20;
        const lineTax = lineNet * (taxRate / 100);
        const lineTotal = lineNet + lineTax;
        totalAmount += lineTotal;
        return {
          tenant_id: tenantId,
          purchase_order_item_id: line.purchaseOrderItemId,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          tax_rate: taxRate,
          line_total: lineTotal,
        };
      });

      await tx.purchaseInvoice.updateMany({
        where: { id, tenant_id: tenantId },
        data: {
          vendor_id: data.vendorId,
          vendor_invoice_number: data.vendorInvoiceNumber,
          invoice_date: new Date(data.invoiceDate),
          due_date: new Date(data.dueDate),
          total_amount: totalAmount,
        },
      });

      if (linesData.length > 0) {
        await tx.purchaseInvoiceLine.createMany({
          data: linesData.map((line) => ({
            ...line,
            purchase_invoice_id: id,
          })),
        });
      }

      const updated = await tx.purchaseInvoice.findFirst({
        where: { id, tenant_id: tenantId },
        include: {
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

      if (!updated) {
        throw new NotFoundException('Invoice not found');
      }

      // 5. Apply new quantity_invoiced (Optimized)
      const newPoItemsToUpdate = Array.from(poItemTotals.entries());
      await chunkedPromiseAll(
        newPoItemsToUpdate,
        async ([poItemId, quantity]) => {
          return tx.purchaseOrderItem.updateMany({
            where: { id: poItemId, tenant_id: tenantId },
            data: {
              quantity_invoiced: {
                increment: quantity,
              },
            },
          });
        },
      );

      return updated;
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return updatedInvoice;
  }

  async post(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.$transaction(async (tx) => {
      // 1. Check if invoice exists and is DRAFT
      const invoice = await tx.purchaseInvoice.findFirst({
        where: { id, tenant_id: tenantId },
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
        throw new BadRequestException('Only DRAFT invoices can be posted');
      }

      // 2. Count lines atomically
      const lineCount = await tx.purchaseInvoiceLine.count({
        where: { purchase_invoice_id: id },
      });

      if (lineCount === 0) {
        throw new BadRequestException('Cannot post an invoice without lines');
      }

      // 3. Atomic update with status check
      const updateResult = await tx.purchaseInvoice.updateMany({
        where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.DRAFT },
        data: { status: PurchaseInvoiceStatus.POSTED },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException(
          'Failed to post: Invoice is no longer in DRAFT status',
        );
      }

      return { success: true };
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return this.findOne(id);
  }

  async pay(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const result = await this.prisma.purchaseInvoice.updateMany({
      where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.POSTED },
      data: { status: PurchaseInvoiceStatus.PAID },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Failed to pay: Invoice not found or not in POSTED status',
      );
    }

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    // When deleting an invoice, we MUST decrement quantity_invoiced on PO items
    // to avoid ghost allocations.
    await this.prisma.$transaction(async (tx) => {
      // Atomic status enforcement: "touch" the invoice to ensure it's DRAFT and lock it
      const lockResult = await tx.purchaseInvoice.updateMany({
        where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.DRAFT },
        data: { updatedAt: new Date() },
      });

      if (lockResult.count === 0) {
        throw new BadRequestException(
          'Invoice not found or no longer in DRAFT status',
        );
      }

      const invoice = await tx.purchaseInvoice.findFirst({
        where: { id, tenant_id: tenantId },
        include: { lines: true },
      });

      if (!invoice) throw new NotFoundException('Invoice not found');
      const linesToDecrement = invoice.lines.filter(
        (l) => l.purchase_order_item_id,
      );
      await chunkedPromiseAll(linesToDecrement, async (line) => {
        return tx.purchaseOrderItem.updateMany({
          where: {
            id: line.purchase_order_item_id as string,
            tenant_id: tenantId,
          },
          data: {
            quantity_invoiced: {
              decrement: line.quantity,
            },
          },
        });
      });

      // Atomic delete check
      const result = await tx.purchaseInvoice.deleteMany({
        where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.DRAFT },
      });

      if (result.count === 0) {
        throw new BadRequestException(
          'Failed to delete: Invoice is no longer in DRAFT status',
        );
      }
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'DELETED',
      entityId: id,
    });

    return { success: true };
  }

  async removeLine(invoiceId: string, lineId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Enforce DRAFT status on the invoice by touching it
      const lockResult = await tx.purchaseInvoice.updateMany({
        where: {
          id: invoiceId,
          tenant_id: tenantId,
          status: PurchaseInvoiceStatus.DRAFT,
        },
        data: { updatedAt: new Date() },
      });

      if (lockResult.count === 0) {
        throw new BadRequestException(
          'Invoice not found or no longer in DRAFT status',
        );
      }

      const line = await tx.purchaseInvoiceLine.findFirst({
        where: { id: lineId },
      });

      if (!line || line.purchase_invoice_id !== invoiceId) {
        throw new NotFoundException('Line not found');
      }

      // 2. Unlink PO Item if applicable
      if (line.purchase_order_item_id) {
        const updateResult = await tx.purchaseOrderItem.updateMany({
          where: {
            id: line.purchase_order_item_id,
            tenant_id: tenantId,
          },
          data: {
            quantity_invoiced: {
              decrement: line.quantity,
            },
          },
        });

        if (updateResult.count === 0) {
          throw new NotFoundException('PO Item not found');
        }
      }

      // 3. Delete the line with invoice relation check
      const deleteLineResult = await tx.purchaseInvoiceLine.deleteMany({
        where: { id: lineId, purchase_invoice_id: invoiceId },
      });

      if (deleteLineResult.count === 0) {
        throw new NotFoundException('Line not found on this invoice');
      }

      // 4. Recalculate invoice total
      const remainingLines = await tx.purchaseInvoiceLine.findMany({
        where: { purchase_invoice_id: invoiceId },
      });

      const newTotal = remainingLines.reduce(
        (sum, l) => sum + Number(l.line_total),
        0,
      );

      const updateTotalResult = await tx.purchaseInvoice.updateMany({
        where: {
          id: invoiceId,
          tenant_id: tenantId,
          status: PurchaseInvoiceStatus.DRAFT,
        },
        data: { total_amount: newTotal },
      });

      if (updateTotalResult.count === 0) {
        throw new BadRequestException(
          'Failed to update total: Invoice is no longer in DRAFT status',
        );
      }

      return { success: true };
    });

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: invoiceId,
    });

    return result;
  }

  async findAll(
    vendorId?: string,
    status?: PurchaseInvoiceStatus,
    page: number = 1,
    pageSize: number = 25,
    sortBy: string = 'due_date',
    order: 'asc' | 'desc' = 'asc',
  ) {
    const tenantId = await this.tenantContext.getTenantId();
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
      throw new BadRequestException(
        `Invalid sortBy field: ${sortBy}. Allowed: ${ALLOWED_SORT_BY.join(', ')}`,
      );
    }

    // Normalize order to valid values
    const normalizedOrder = order === 'desc' ? 'desc' : 'asc';

    const skip = (page - 1) * pageSize;

    const where: Prisma.PurchaseInvoiceWhereInput = {
      tenant_id: tenantId,
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
    const tenantId = await this.tenantContext.getTenantId();
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, tenant_id: tenantId },
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
