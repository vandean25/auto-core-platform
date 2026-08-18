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
import { PdfWorker } from '../common';
import { InvoicesService } from './invoices.service';
import { CreateDraftInvoiceDto } from './dto/create-draft-invoice.dto';
import { InvoiceResponseDto } from '../sales/dto/invoice-response.dto';
import { InvoicePdfService } from './invoice-pdf.service';

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

    if (!targetBaseUrl) {
      this.logger.warn(
        'CLOUD_TASKS_TARGET_BASE_URL is not configured; falling back to inline PDF generation',
      );
    }

    return this.invoicePdfService.requestGeneration(id, { targetBaseUrl });
  }

  @Post(':id/pdf/worker')
  @PdfWorker('invoice')
  async generatePdfWorker(@Param('id') id: string) {
    try {
      await this.invoicePdfService.generateNow(id);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Dropping non-retryable invoice PDF worker error (invoiceId=${id}): ${message}`,
        );
        Sentry.captureException(error, {
          level: 'warning',
          tags: { invoiceId: id, operation: 'pdf.worker' },
        });
        return;
      }

      throw error;
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
    const safeFilename = pdf.filename.replace(/["\r\n]+/g, '_');

    return new StreamableFile(pdf.stream, {
      type: pdf.contentType || 'application/pdf',
      disposition: `inline; filename="${safeFilename}"`,
      length: pdf.contentLength ?? undefined,
    });
  }
}
