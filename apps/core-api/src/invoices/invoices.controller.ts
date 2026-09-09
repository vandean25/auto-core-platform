import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import type { Readable } from 'node:stream';
import { PdfWorker } from '../common';
import { InvoicesService } from './invoices.service';
import { CreateDraftInvoiceDto } from './dto/create-draft-invoice.dto';
import { InvoiceResponseDto } from '../sales/dto/invoice-response.dto';
import { InvoicePdfService } from './invoice-pdf.service';

interface InvoicePdfPayload {
  filename: string;
  contentType?: string | null;
  contentLength?: number | null;
  stream: Readable;
}

function handlePdfWorkerError(
  id: string,
  error: unknown,
  logger: Logger,
): void {
  const isNonRetryable =
    error instanceof HttpException && error.getStatus() < 500;
  if (!isNonRetryable) {
    throw error;
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.warn(
    `Dropping non-retryable invoice PDF worker error (invoiceId=${id}): ${message}`,
  );
  Sentry.captureException(error, {
    level: 'warning',
    tags: { invoiceId: id, operation: 'pdf.worker' },
  });
}

function toPdfStreamableFile(pdf: InvoicePdfPayload): StreamableFile {
  const safeFilename = pdf.filename.replace(/["\r\n]+/g, '_');
  return new StreamableFile(pdf.stream, {
    type: pdf.contentType || 'application/pdf',
    disposition: `inline; filename="${safeFilename}"`,
    length: pdf.contentLength ?? undefined,
  });
}

@Controller('invoices')
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Post('drafts')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createDraft(@Body() dto: CreateDraftInvoiceDto) {
    return this.invoicesService.createDraftInvoice(dto.workshopOrderId);
  }

  @Patch(':id/issue')
  @ApiOkResponse({ type: InvoiceResponseDto })
  issue(@Param('id') id: string) {
    return this.invoicesService.issueInvoice(id);
  }

  @Post(':id/pdf')
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  generatePdf(@Param('id') id: string) {
    const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
    return this.invoicePdfService.requestGeneration(id, { targetBaseUrl });
  }

  @Post(':id/pdf/worker')
  @PdfWorker('invoice')
  async generatePdfWorker(@Param('id') id: string) {
    try {
      await this.invoicePdfService.generateNow(id);
    } catch (error) {
      handlePdfWorkerError(id, error, this.logger);
    }
  }

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  async getPdf(@Param('id') id: string) {
    const pdf = await this.invoicePdfService.getPdf(id);
    return toPdfStreamableFile(pdf);
  }
}
