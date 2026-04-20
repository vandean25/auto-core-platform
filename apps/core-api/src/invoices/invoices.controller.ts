import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { Public } from '../common/decorators/public.decorator';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard';
import { InvoicesService } from './invoices.service';
import { CreateDraftInvoiceDto } from './dto/create-draft-invoice.dto';
import { InvoicePdfService } from './invoice-pdf.service';
import { TenantContextService } from '../common/services/tenant-context.service';

@Controller('invoices')
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('drafts')
  createDraft(@Body() dto: CreateDraftInvoiceDto) {
    return this.invoicesService.createDraftInvoice(dto.workshopOrderId);
  }

  @Patch(':id/issue')
  issue(@Param('id') id: string) {
    return this.invoicesService.issueInvoice(id);
  }

  @Post(':id/pdf')
  generatePdf(@Param('id') id: string) {
    const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';

    if (!targetBaseUrl) {
      this.logger.warn(
        'CLOUD_TASKS_TARGET_BASE_URL is not configured; falling back to inline PDF generation',
      );
    }

    return this.invoicePdfService.requestGeneration(id, { targetBaseUrl });
  }

  @ApiExcludeEndpoint()
  @Public()
  @UseGuards(CloudTasksWorkerGuard)
  @Post(':id/pdf/worker')
  @HttpCode(204)
  async generatePdfWorker(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantHeader: string,
  ) {
    if (!tenantHeader) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    this.tenantContext.setTenantIdForWorker(tenantHeader);
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
