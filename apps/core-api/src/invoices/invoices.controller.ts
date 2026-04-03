import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
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
  generatePdf(@Param('id') id: string) {
    return this.invoicePdfService.generate(id);
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
