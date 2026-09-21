import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import type { Readable } from 'node:stream';
import * as Sentry from '@sentry/node';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { PdfWorker } from '../common/index.js';
import { CreditNotePdfService } from './credit-note-pdf.service.js';
import { CreditNotesService } from './credit-notes.service.js';
import {
  CreateCreditNoteDto,
  CreditNoteListQueryDto,
  CreditNoteResponseDto,
  FinalizeCreditNoteDto,
  InvoiceCreditContextResponseDto,
  UpdateCreditNoteDto,
  VoidCreditNoteDto,
} from './dto/credit-note.dto.js';

interface CreditNotePdfPayload {
  filename: string;
  contentType?: string | null;
  contentLength?: number | null;
  stream: Readable;
}

function handleCreditNotePdfWorkerError(
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
    `Dropping non-retryable credit note PDF worker error (creditNoteId=${id}): ${message}`,
  );
  Sentry.captureException(error, {
    level: 'warning',
    tags: { creditNoteId: id, operation: 'pdf.worker' },
  });
}

function toPdfStreamableFile(pdf: CreditNotePdfPayload): StreamableFile {
  const safeFilename = pdf.filename.replace(/["\r\n]+/g, '_');
  return new StreamableFile(pdf.stream, {
    type: pdf.contentType || 'application/pdf',
    disposition: `inline; filename="${safeFilename}"`,
    length: pdf.contentLength ?? undefined,
  });
}

@Controller('credit-notes')
export class CreditNotesController {
  private readonly logger = new Logger(CreditNotesController.name);

  constructor(
    private readonly creditNotesService: CreditNotesService,
    private readonly creditNotePdfService: CreditNotePdfService,
  ) {}

  @Get()
  @ApiPaginatedResponse(CreditNoteResponseDto)
  list(@Query() query: CreditNoteListQueryDto) {
    return this.creditNotesService.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  findOne(@Param('id') id: string) {
    return this.creditNotesService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  updateDraft(@Param('id') id: string, @Body() dto: UpdateCreditNoteDto) {
    return this.creditNotesService.updateDraft(id, dto);
  }

  @Post(':id/finalize')
  @ApiCreatedResponse({ type: CreditNoteResponseDto })
  finalize(@Param('id') id: string, @Body() dto: FinalizeCreditNoteDto) {
    return this.creditNotesService.finalize(id, dto);
  }

  @Post(':id/void')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  void(@Param('id') id: string, @Body() dto: VoidCreditNoteDto) {
    return this.creditNotesService.void(id, dto);
  }

  @Post(':id/pdf')
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  generatePdf(@Param('id') id: string) {
    const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
    return this.creditNotePdfService.requestGeneration(id, { targetBaseUrl });
  }

  @Post(':id/pdf/worker')
  @PdfWorker('credit-note')
  async generatePdfWorker(@Param('id') id: string) {
    try {
      await this.creditNotePdfService.generateNow(id);
    } catch (error) {
      handleCreditNotePdfWorkerError(id, error, this.logger);
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
    const pdf = await this.creditNotePdfService.getPdf(id);
    return toPdfStreamableFile(pdf);
  }
}

@Controller('invoices')
export class InvoiceCreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Get(':id/credit-notes')
  @ApiOkResponse({ type: InvoiceCreditContextResponseDto })
  listForInvoice(@Param('id') invoiceId: string) {
    return this.creditNotesService.listForInvoice(invoiceId);
  }

  @Post(':id/credit-notes')
  @ApiCreatedResponse({ type: CreditNoteResponseDto })
  createFromInvoice(
    @Param('id') invoiceId: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.creditNotesService.createFromInvoice(invoiceId, dto);
  }
}
