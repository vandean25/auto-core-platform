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
import { PurchaseInvoiceLifecycleService } from './purchase-invoice-lifecycle.service';
import {
  aggregatePoItemTotals,
  calculateLineAmounts,
  validatePoItemsAvailability,
  PoItemWithOrderVendor,
} from './purchase-invoice.helpers';

import Decimal = Prisma.Decimal;

@Injectable()
export class PurchaseInvoiceService {
  constructor(
    private prisma: PrismaService,
    private readonly realtimeService: DashboardRealtimeService,
    private readonly tenantContext: TenantContextService,
    private readonly lifecycleService: PurchaseInvoiceLifecycleService = new PurchaseInvoiceLifecycleService(
      prisma,
    ),
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

    return poItems
      .filter((item) => {
        const received = new Decimal(item.quantity_received);
        const invoiced = new Decimal(item.quantity_invoiced);
        const onCurrentInvoice = invoiceId
          ? item.purchase_invoice_lines?.length > 0
          : false;
        return received.gt(invoiced) || onCurrentInvoice;
      })
      .map((item) => ({
        purchaseOrderItemId: item.id,
        purchaseOrderId: item.purchase_order_id,
        purchaseOrderNumber: item.purchase_order.order_number,
        catalogItemId: item.catalog_item_id,
        catalogItemName: item.catalog_item.name,
        quantityReceived: Number(item.quantity_received),
        quantityInvoiced: Number(item.quantity_invoiced),
        quantityPending:
          Number(item.quantity_received) - Number(item.quantity_invoiced),
        lastUnitCost: Number(item.unit_cost),
      }));
  }

  private async assertVendorExists(tenantId: string, vendorId: string) {
    const vendorExists = await this.prisma.vendor.findFirst({
      where: { id: vendorId, tenant_id: tenantId },
    });
    if (!vendorExists) {
      throw new BadRequestException(
        'Vendor not found or belongs to another tenant',
      );
    }
  }

  private async validateAndGetPoItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vendorId: string,
    poItemTotals: Map<string, number>,
  ) {
    if (poItemTotals.size === 0) return;

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

    const poItemsById = new Map<string, PoItemWithOrderVendor>(
      poItems.map((poItem) => [poItem.id, poItem]),
    );

    validatePoItemsAvailability(poItemsById, poItemTotals, vendorId);
  }

  private async adjustPoItemInvoicedQuantities(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemsToAdjust: Array<[string, number]>,
    operation: 'increment' | 'decrement',
  ) {
    await chunkedPromiseAll(itemsToAdjust, async ([poItemId, quantity]) => {
      return tx.purchaseOrderItem.updateMany({
        where: { id: poItemId, tenant_id: tenantId },
        data: {
          quantity_invoiced: {
            [operation]: quantity,
          },
        },
      });
    });
  }

  async create(createDto: CreatePurchaseInvoiceDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const { items, ...data } = createDto;

    await this.assertVendorExists(tenantId, data.vendorId);
    const poItemTotals = aggregatePoItemTotals(items);

    const invoice = await this.prisma.$transaction(async (tx) => {
      await this.validateAndGetPoItems(
        tx,
        tenantId,
        data.vendorId,
        poItemTotals,
      );

      const { linesData, totalAmount } = calculateLineAmounts(items, tenantId);

      const created = await tx.purchaseInvoice.create({
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

      const poItemsToUpdate = Array.from(poItemTotals.entries());
      await this.adjustPoItemInvoicedQuantities(
        tx,
        tenantId,
        poItemsToUpdate,
        'increment',
      );

      return created;
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

    await this.assertVendorExists(tenantId, data.vendorId);
    const poItemTotals = aggregatePoItemTotals(items);

    const updatedInvoice = await this.prisma.$transaction(async (tx) => {
      // Atomic lock check to ensure it's DRAFT
      const updateCount = await tx.purchaseInvoice.updateMany({
        where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.DRAFT },
        data: { updatedAt: new Date() },
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

      // 1. Rollback old quantity_invoiced
      const rollbackItems: Array<[string, number]> = existingInvoice.lines
        .filter((l) => l.purchase_order_item_id)
        .map((l) => [l.purchase_order_item_id as string, Number(l.quantity)]);
      await this.adjustPoItemInvoicedQuantities(
        tx,
        tenantId,
        rollbackItems,
        'decrement',
      );

      // 2. Validate new quantities AFTER rollback
      await this.validateAndGetPoItems(
        tx,
        tenantId,
        data.vendorId,
        poItemTotals,
      );

      // 3. Clear existing lines
      await tx.purchaseInvoiceLine.deleteMany({
        where: { purchase_invoice_id: id },
      });

      // 4. Update invoice header and create new lines
      const { linesData, totalAmount } = calculateLineAmounts(items, tenantId);

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

      // 5. Apply new quantity_invoiced
      const newPoItemsToUpdate = Array.from(poItemTotals.entries());
      await this.adjustPoItemInvoicedQuantities(
        tx,
        tenantId,
        newPoItemsToUpdate,
        'increment',
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
    await this.lifecycleService.post(tenantId, id);

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return this.findOne(id);
  }

  async pay(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.lifecycleService.pay(tenantId, id);

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'UPDATED',
      entityId: id,
    });

    return this.findOne(id);
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const result = await this.lifecycleService.remove(tenantId, id);

    this.realtimeService.emitEntityUpdated(tenantId, {
      type: 'PURCHASE_INVOICE',
      action: 'DELETED',
      entityId: id,
    });

    return result;
  }

  async removeLine(invoiceId: string, lineId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const result = await this.lifecycleService.removeLine(
      tenantId,
      invoiceId,
      lineId,
    );

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
