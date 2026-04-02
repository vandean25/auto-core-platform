import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Res,
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
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.invoicePdfService.getPdf(id);

    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`);
    if (pdf.contentLength !== null) {
      res.setHeader('Content-Length', pdf.contentLength.toString());
    }

    const stream = pdf.stream;
    const req = res.req;

    let didCleanup = false;
    const cleanup = () => {
      if (didCleanup) return;
      didCleanup = true;

      stream.removeListener('error', onStreamError);
      req?.removeListener('aborted', onReqAborted);
      res.removeListener('finish', onResFinish);
      res.removeListener('close', onResClose);
    };

    const onStreamError = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Invoice PDF stream failed (invoiceId=${id}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (!res.headersSent) {
        res.status(500);
      }
      res.end();
      cleanup();
    };

    const onReqAborted = () => {
      stream.destroy();
      cleanup();
    };

    const onResFinish = () => {
      cleanup();
    };

    const onResClose = () => {
      if (res.writableEnded) {
        cleanup();
        return;
      }

      stream.destroy();
      cleanup();
    };

    stream.on('error', onStreamError);
    req?.on('aborted', onReqAborted);
    res.on('finish', onResFinish);
    res.on('close', onResClose);

    stream.pipe(res);
  }
}
