import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  type Invoice,
  type InvoiceItem,
} from '@prisma/client';
import { withSpan } from '../common/observability/trace.js';
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

/** A 4xx business rejection (missing source, not found) is not a failure of the system. */
function finalizeOutcomeForError(error: unknown): 'rejected' | 'failed' {
  return error instanceof HttpException && error.getStatus() < 500
    ? 'rejected'
    : 'failed';
}

@Injectable()
export class InvoiceFinalizationService {
  constructor(
    private readonly atpService: AtpService,
    private readonly snapshotCommit: InvoiceSnapshotCommitService,
  ) {}

  /**
   * Runs inside the caller's transaction. The span records the invoice id, the step reached and the
   * outcome only. It does not change the transaction: every statement and its order are as before.
   */
  async finalizeInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoice: InvoiceWithItems,
  ) {
    return withSpan(
      'Finalize invoice',
      'invoice.finalize',
      { invoiceId: invoice.id },
      async (span) => {
        try {
          span.setAttribute('step', 'validate_source');
          assertInvoiceHasSourceDocument(invoice);
          if (!invoice.sales_order_id) {
            throw new BadRequestException({
              code: 'SOURCE_DOCUMENT_REQUIRED',
              message:
                'Sales invoice finalization requires a linked sales order. Workshop and vehicle-sale invoices must use their own commit paths.',
            });
          }

          span.setAttribute('step', 'load_invoice');
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

          span.setAttribute('step', 'prepare_snapshot');
          const prepared = await this.snapshotCommit.prepareV2Snapshot({
            tx,
            tenantId,
            invoice: fullInvoice,
            invoiceNumber: fullInvoice.invoice_number ?? '',
          });

          span.setAttribute('step', 'allocate_number');
          const invoiceNumber = await generateInvoiceNumber(tx, tenantId);

          span.setAttribute('step', 'deduct_inventory');
          await processSaleInventoryDeduction({
            tx,
            tenantId,
            siteId: prepared.ownership.siteId,
            invoiceItems: invoice.items,
            invoiceNumber,
            atpService: this.atpService,
          });

          span.setAttribute('step', 'transition_invoice');
          await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
            id: invoice.id,
            tenantId,
            from: InvoiceStatus.DRAFT,
            to: InvoiceStatus.FINALIZED,
            extraData: { invoice_number: invoiceNumber },
            conflictMessage:
              'Invoice was already transitioned by another request',
          });

          span.setAttribute('step', 'persist_snapshot');
          await this.snapshotCommit.persistV2Snapshot(
            tx,
            tenantId,
            invoice.id,
            prepared,
          );

          span.setAttribute('step', 'reload_invoice');
          const updatedInvoice = await tx.invoice.findFirst({
            where: { id: invoice.id, tenant_id: tenantId },
            include: { items: true, customer: true },
          });

          if (!updatedInvoice) {
            throw new NotFoundException('Invoice not found after update');
          }

          span.setAttribute('step', 'transition_sales_order');
          await transitionLinkedSalesOrderToInvoiced(
            tx,
            tenantId,
            prepared.ownership.siteId,
            invoice.sales_order_id,
          );

          span.setAttribute('outcome', 'finalized');
          return updatedInvoice;
        } catch (error) {
          span.setAttribute('outcome', finalizeOutcomeForError(error));
          throw error;
        }
      },
    );
  }
}
