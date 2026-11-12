import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import type { Readable } from 'node:stream';
import { PdfWorker } from '../common/pdf/index.js';
import { WorkshopPdfGenerationResponseDto } from '../workshop/dto/workshop-pdf-generation-response.dto.js';
import {
  CreateWarrantyClaimDto,
  ListWarrantyClaimsQueryDto,
  UpdateWarrantyClaimDto,
  WarrantyClaimListResponseDto,
  WarrantyClaimResponseDto,
} from './dto/warranty-claim.dto.js';
import { WarrantyClaimPdfService } from './warranty-claim-pdf.service.js';
import { WarrantyClaimService } from './warranty-claim.service.js';

interface WarrantyClaimPdfPayload {
  filename: string;
  contentType?: string | null;
  contentLength?: number | null;
  stream: Readable;
}

function handleWarrantyClaimPdfWorkerError(
  claimId: string,
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
    `Dropping non-retryable warranty claim PDF worker error (claimId=${claimId}): ${message}`,
  );
  Sentry.captureException(error, {
    level: 'warning',
    tags: { claimId, operation: 'pdf.worker' },
  });
}

function toPdfStreamableFile(pdf: WarrantyClaimPdfPayload): StreamableFile {
  const safeFilename = pdf.filename.replace(/["\r\n]+/g, '_');
  return new StreamableFile(pdf.stream, {
    type: pdf.contentType || 'application/pdf',
    disposition: `attachment; filename="${safeFilename}"`,
    length: pdf.contentLength ?? undefined,
  });
}

function formatPdfRequestResponse(
  result: Awaited<ReturnType<WarrantyClaimPdfService['requestGeneration']>>,
) {
  if (result.mode === 'enqueued') {
    return {
      message: 'PDF generation enqueued',
      enqueued: true,
      taskId: result.taskId,
    };
  }
  return {
    message: 'PDF is ready',
    enqueued: false,
  };
}

@ApiTags('Workshop')
@Controller('workshop/orders/:orderId/warranty-claims')
export class WarrantyClaimController {
  private readonly logger = new Logger(WarrantyClaimController.name);

  constructor(
    private readonly claims: WarrantyClaimService,
    private readonly pdf: WarrantyClaimPdfService,
  ) {}

  @Get()
  @ApiOkResponse({ type: WarrantyClaimListResponseDto })
  list(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: ListWarrantyClaimsQueryDto,
  ) {
    return this.claims.list(orderId, query);
  }

  @Post()
  @ApiCreatedResponse({ type: WarrantyClaimResponseDto })
  create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateWarrantyClaimDto,
  ) {
    return this.claims.create(orderId, dto);
  }

  @Get(':claimId')
  @ApiOkResponse({ type: WarrantyClaimResponseDto })
  get(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
  ) {
    return this.claims.get(orderId, claimId);
  }

  @Patch(':claimId')
  @ApiOkResponse({ type: WarrantyClaimResponseDto })
  update(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: UpdateWarrantyClaimDto,
  ) {
    return this.claims.update(orderId, claimId, dto);
  }

  @Post(':claimId/pdf')
  @ApiCreatedResponse({ type: WorkshopPdfGenerationResponseDto })
  async requestPdf(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
  ) {
    const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
    const result = await this.pdf.requestGeneration(orderId, claimId, {
      targetBaseUrl,
    });
    return formatPdfRequestResponse(result);
  }

  @Post(':id/pdf/worker')
  @PdfWorker('warranty-claim')
  async generatePdfWorker(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('id', ParseUUIDPipe) claimId: string,
  ) {
    try {
      await this.pdf.generateNow(orderId, claimId);
    } catch (error) {
      handleWarrantyClaimPdfWorkerError(claimId, error, this.logger);
    }
  }

  @Get(':claimId/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'Printable Garantie/Kulanz claim summary',
    schema: { type: 'string', format: 'binary' },
  })
  async downloadPdf(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
  ) {
    const pdf = await this.pdf.getPdf(orderId, claimId);
    return toPdfStreamableFile(pdf);
  }
}
