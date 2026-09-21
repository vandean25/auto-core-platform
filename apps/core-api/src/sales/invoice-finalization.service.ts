import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  type Invoice,
  type InvoiceItem,
} from '@prisma/client';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import { AtpService } from '../inventory/atp.service.js';
import {
  assertInvoiceHasSourceDocument,
  InvoiceSnapshotCommitService,
} from '../invoices/invoice-snapshot-commit.service.js';
import { generateInvoiceNumber } from './helpers/invoice-number.helpers.js';
import { processSaleInventoryDeduction } from './helpers/invoice-inventory.helpers.js';
import { transitionLinkedSalesOrderToInvoiced } from './helpers/invoice-sales-order-transition.helpers.js';

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

@Injectable()
export class InvoiceFinalizationService {
  constructor(
    private readonly atpService: AtpService,
    private readonly snapshotCommit: InvoiceSnapshotCommitService,
  ) {}

  async finalizeInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoice: InvoiceWithItems,
  ) {
    assertInvoiceHasSourceDocument(invoice);
    if (!invoice.sales_order_id) {
      throw new BadRequestException({
        code: 'SOURCE_DOCUMENT_REQUIRED',
        message:
          'Sales invoice finalization requires a linked sales order. Workshop and vehicle-sale invoices must use their own commit paths.',
      });
    }

    const invoiceNumber = await generateInvoiceNumber(tx, tenantId);

    const fullInvoice = await tx.invoice.findFirst({
      where: { id: invoice.id, tenant_id: tenantId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        customer: true,
        vehicle: true,
      },
    });
    if (!fullInvoice) {
      throw new NotFoundException('Invoice not found');
    }

    const prepared = await this.snapshotCommit.prepareV2Snapshot({
      tx,
      tenantId,
      invoice: fullInvoice,
      invoiceNumber,
    });

    await processSaleInventoryDeduction({
      tx,
      tenantId,
      siteId: prepared.ownership.siteId,
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

    await this.snapshotCommit.persistV2Snapshot(
      tx,
      tenantId,
      invoice.id,
      prepared,
    );

    const updatedInvoice = await tx.invoice.findFirst({
      where: { id: invoice.id, tenant_id: tenantId },
      include: { items: true, customer: true },
    });

    if (!updatedInvoice) {
      throw new NotFoundException('Invoice not found after update');
    }

    await transitionLinkedSalesOrderToInvoiced(
      tx,
      tenantId,
      prepared.ownership.siteId,
      invoice.sales_order_id,
    );

    return updatedInvoice;
  }
}
