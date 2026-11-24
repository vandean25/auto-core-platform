import {
  Controller,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PdfWorker } from '../common/pdf/pdf-worker.decorator.js';
import { CreditNotePdfService } from '../credit-notes/credit-note-pdf.service.js';
import { InvoicePdfService } from '../invoices/invoice-pdf.service.js';
import { VehicleSaleKaufvertragPdfService } from '../vehicle-stock/kaufvertrag/kaufvertrag-pdf.service.js';
import { WarrantyClaimPdfService } from '../warranty-claim/warranty-claim-pdf.service.js';
import { WorkshopEstimatePdfService } from '../workshop/workshop-estimate-pdf.service.js';
import { WorkshopPdfService } from '../workshop/workshop-pdf.service.js';

function handleNonRetryablePdfWorkerError(params: {
  label: string;
  tagKey: string;
  id: string;
  error: unknown;
  logger: Logger;
}): void {
  const { label, tagKey, id, error, logger } = params;
  const isNonRetryable =
    error instanceof HttpException && error.getStatus() < 500;
  if (!isNonRetryable) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.warn(
    `Dropping non-retryable ${label} PDF worker error (${tagKey}=${id}): ${message}`,
  );
  Sentry.captureException(error, {
    level: 'warning',
    tags: { [tagKey]: id, operation: 'pdf.worker' },
  });
}

@Controller()
export class PdfWorkerController {
  private readonly logger = new Logger(PdfWorkerController.name);

  constructor(
    private readonly invoicePdfService: InvoicePdfService,
    private readonly creditNotePdfService: CreditNotePdfService,
    private readonly workshopPdfService: WorkshopPdfService,
    private readonly workshopEstimatePdfService: WorkshopEstimatePdfService,
    private readonly warrantyClaimPdfService: WarrantyClaimPdfService,
    private readonly kaufvertragPdfService: VehicleSaleKaufvertragPdfService,
  ) {}

  @Post('invoices/:id/pdf/worker')
  @PdfWorker('invoice')
  async generateInvoicePdf(@Param('id', ParseUUIDPipe) id: string) {
    try {
      await this.invoicePdfService.generateNow(id);
    } catch (error) {
      handleNonRetryablePdfWorkerError({
        label: 'invoice',
        tagKey: 'invoiceId',
        id,
        error,
        logger: this.logger,
      });
    }
  }

  @Post('credit-notes/:id/pdf/worker')
  @PdfWorker('credit-note')
  async generateCreditNotePdf(@Param('id', ParseUUIDPipe) id: string) {
    try {
      await this.creditNotePdfService.generateNow(id);
    } catch (error) {
      handleNonRetryablePdfWorkerError({
        label: 'credit note',
        tagKey: 'creditNoteId',
        id,
        error,
        logger: this.logger,
      });
    }
  }

  @Post('workshop/orders/:id/pdf/worker')
  @PdfWorker('workshop-order')
  async generateWorkshopOrderPdf(@Param('id', ParseUUIDPipe) id: string) {
    await this.workshopPdfService.generateNow(id);
  }

  @Post('workshop/estimates/:id/pdf/worker')
  @PdfWorker('workshop-estimate')
  async generateWorkshopEstimatePdf(@Param('id', ParseUUIDPipe) id: string) {
    await this.workshopEstimatePdfService.generateNow(id);
  }

  @Post('workshop/orders/:orderId/warranty-claims/:id/pdf/worker')
  @PdfWorker('warranty-claim')
  async generateWarrantyClaimPdf(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) claimId: string,
  ) {
    try {
      await this.warrantyClaimPdfService.generateNow(orderId, claimId);
    } catch (error) {
      handleNonRetryablePdfWorkerError({
        label: 'warranty claim',
        tagKey: 'claimId',
        id: claimId,
        error,
        logger: this.logger,
      });
    }
  }

  @Post('vehicle-sales/:id/kaufvertrag/pdf/worker')
  @PdfWorker('vehicle-sale-kaufvertrag')
  async generateKaufvertragPdf(@Param('id') id: string) {
    try {
      await this.kaufvertragPdfService.generateNow(id);
    } catch (error) {
      handleNonRetryablePdfWorkerError({
        label: 'Kaufvertrag',
        tagKey: 'vehicleSaleId',
        id,
        error,
        logger: this.logger,
      });
    }
  }
}
