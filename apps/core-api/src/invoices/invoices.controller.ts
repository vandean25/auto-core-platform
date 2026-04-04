import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CreateDraftInvoiceDto } from './dto/create-draft-invoice.dto';
import { InvoicePdfService } from './invoice-pdf.service';

@Controller('invoices')
export class InvoicesController {
  private readonly logger = new Logger(InvoicesController.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePdfService: InvoicePdfService,
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
  generatePdf(@Param('id') id: string, @Req() req: Request) {
    const forwardedProtoHeader = req.headers['x-forwarded-proto'];
    const forwardedProto = Array.isArray(forwardedProtoHeader)
      ? forwardedProtoHeader[0]
      : forwardedProtoHeader;
    const protocol = forwardedProto || req.protocol;
    const host = req.get('host');

    if (!host) {
      this.logger.warn('Missing host header while enqueuing PDF generation');
    }

    const targetBaseUrl = host ? `${protocol}://${host}` : '';
    return this.invoicePdfService.requestGeneration(id, { targetBaseUrl });
  }

  @ApiExcludeEndpoint()
  @Post(':id/pdf/worker')
  @HttpCode(204)
  async generatePdfWorker(@Param('id') id: string) {
    await this.invoicePdfService.generateNow(id);
  }

  @Get(':id/pdf')
  async getPdf(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const pdf = await this.invoicePdfService.getPdf(id);

    return new StreamableFile(pdf.stream, {
      type: pdf.contentType || 'application/pdf',
      disposition: `inline; filename="${pdf.filename}"`,
      length: pdf.contentLength ?? undefined,
    });
  }
}
