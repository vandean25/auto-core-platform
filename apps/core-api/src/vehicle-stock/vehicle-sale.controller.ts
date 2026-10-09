import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { PdfWorker } from '../common/index.js';
import { VehicleSaleService } from './vehicle-sale.service.js';
import { VehicleSaleTradeInService } from './vehicle-sale-trade-in.service.js';
import { VehicleSaleKaufvertragPdfService } from './kaufvertrag/kaufvertrag-pdf.service.js';
import { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto.js';
import { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';
import { CorrectGewaehrleistungSnapshotDto } from './dto/correct-gewaehrleistung-snapshot.dto.js';
import { UpsertVehicleSaleTradeInDto } from './dto/upsert-vehicle-sale-trade-in.dto.js';

/** Client errors (4xx) will not succeed on retry, so the task is dropped. Server errors are retried. */
function handleKaufvertragWorkerError(
  saleId: string,
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
    `Dropping non-retryable Kaufvertrag PDF worker error (vehicleSaleId=${saleId}): ${message}`,
  );
  Sentry.captureException(error, {
    level: 'warning',
    tags: { vehicleSaleId: saleId, operation: 'pdf.worker' },
  });
}

@ApiTags('vehicle-sales')
@Controller('vehicle-sales')
export class VehicleSaleController {
  private readonly logger = new Logger(VehicleSaleController.name);

  constructor(
    private readonly sales: VehicleSaleService,
    private readonly tradeIn: VehicleSaleTradeInService,
    private readonly kaufvertragPdf: VehicleSaleKaufvertragPdfService,
  ) {}

  @Post()
  create(@Body() dto: CreateVehicleSaleDto) {
    return this.sales.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sales.findOne(id);
  }

  @Patch(':id')
  updateDraft(@Param('id') id: string, @Body() dto: PatchVehicleSaleDto) {
    return this.sales.updateDraft(id, dto);
  }

  @Post(':id/finalize')
  finalize(@Param('id') id: string) {
    return this.sales.finalize(id);
  }

  @Put(':id/trade-in')
  upsertTradeIn(
    @Param('id') id: string,
    @Body() dto: UpsertVehicleSaleTradeInDto,
  ) {
    return this.tradeIn.upsert(id, dto);
  }

  @Delete(':id/trade-in')
  removeTradeIn(@Param('id') id: string) {
    return this.tradeIn.remove(id);
  }

  @Post(':id/gewaehrleistung-correction')
  correctGewaehrleistungSnapshot(
    @Param('id') id: string,
    @Body() dto: CorrectGewaehrleistungSnapshotDto,
  ) {
    return this.sales.correctGewaehrleistungSnapshot(id, dto);
  }

  @Post(':id/kaufvertrag/pdf')
  generateKaufvertragPdf(@Param('id') id: string) {
    const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
    return this.kaufvertragPdf.requestGeneration(id, { targetBaseUrl });
  }

  @Post(':id/kaufvertrag/pdf/worker')
  @PdfWorker('vehicle-sale-kaufvertrag')
  async generateKaufvertragPdfWorker(@Param('id') id: string) {
    try {
      await this.kaufvertragPdf.generateNow(id);
    } catch (error) {
      handleKaufvertragWorkerError(id, error, this.logger);
    }
  }

  @Get(':id/kaufvertrag/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  async getKaufvertragPdf(@Param('id') id: string) {
    const pdf = await this.kaufvertragPdf.getPdf(id);
    const safeFilename = pdf.filename.replace(/["\r\n]+/g, '_');
    return new StreamableFile(pdf.stream, {
      type: pdf.contentType,
      disposition: `inline; filename="${safeFilename}"`,
      length: pdf.contentLength,
    });
  }
}
