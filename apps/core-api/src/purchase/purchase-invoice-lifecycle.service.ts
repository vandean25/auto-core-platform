import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseInvoiceStatus } from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util';

@Injectable()
export class PurchaseInvoiceLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async post(tenantId: string, id: string): Promise<{ success: boolean }> {
    return this.prisma.$transaction(async (tx) => {
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
  }

  async pay(tenantId: string, id: string): Promise<{ success: boolean }> {
    const result = await this.prisma.purchaseInvoice.updateMany({
      where: { id, tenant_id: tenantId, status: PurchaseInvoiceStatus.POSTED },
      data: { status: PurchaseInvoiceStatus.PAID },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Failed to pay: Invoice not found or not in POSTED status',
      );
    }

    return { success: true };
  }

  async remove(tenantId: string, id: string): Promise<{ success: boolean }> {
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

    return { success: true };
  }

  async removeLine(
    tenantId: string,
    invoiceId: string,
    lineId: string,
  ): Promise<{ success: boolean }> {
    return this.prisma.$transaction(async (tx) => {
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
  }
}
