import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  type Invoice,
  type InvoiceItem,
} from '@prisma/client';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition';
import { SiteContextService } from '../common/services/site-context.service';
import { AtpService } from '../inventory/atp.service';
import { generateInvoiceNumber } from './helpers/invoice-number.helpers';
import { processSaleInventoryDeduction } from './helpers/invoice-inventory.helpers';
import { transitionLinkedSalesOrderToInvoiced } from './helpers/invoice-sales-order-transition.helpers';

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

@Injectable()
export class InvoiceFinalizationService {
  constructor(
    private readonly atpService: AtpService,
    private readonly siteContext: SiteContextService,
  ) {}

  async finalizeInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoice: InvoiceWithItems,
  ) {
    const siteId = await this.siteContext.getSiteId();
    const invoiceNumber = await generateInvoiceNumber(tx, tenantId);

    await processSaleInventoryDeduction({
      tx,
      tenantId,
      siteId,
      invoiceItems: invoice.items,
      invoiceNumber,
      atpService: this.atpService,
    });

    await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
      id: invoice.id,
      tenantId,
      from: InvoiceStatus.DRAFT,
      to: InvoiceStatus.FINALIZED,
      extraData: { invoice_number: invoiceNumber },
      conflictMessage: 'Invoice was already transitioned by another request',
    });

    const updatedInvoice = await tx.invoice.findFirst({
      where: { id: invoice.id, tenant_id: tenantId },
      include: { items: true, customer: true },
    });

    if (!updatedInvoice) {
      throw new NotFoundException('Invoice not found after update');
    }

    if (invoice.sales_order_id) {
      await transitionLinkedSalesOrderToInvoiced(
        tx,
        tenantId,
        invoice.sales_order_id,
      );
    }

    return updatedInvoice;
  }
}
