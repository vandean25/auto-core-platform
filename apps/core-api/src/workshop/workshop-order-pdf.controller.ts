import {
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PdfWorker } from '../common/index.js';
import { WorkshopPdfGenerationResponseDto } from './dto/index.js';
import * as pdf from './workshop-pdf.service.js';
import {
  enqueueWorkshopPdfGeneration,
  serveWorkshopPdfDownload,
} from './workshop-controller.http-helpers.js';
import { ApiWorkshopOrderPdfDownload } from './workshop-orders.openapi-decorators.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrderPdfController {
  private readonly logger = new Logger(WorkshopOrderPdfController.name);

  constructor(private readonly pdfService: pdf.WorkshopPdfService) {}

  private logAction(action: string) {
    this.logger.debug(action);
  }

  @Post('orders/:id/pdf')
  @ApiCreatedResponse({
    description: 'Workshop PDF generation status.',
    type: WorkshopPdfGenerationResponseDto,
  })
  async generatePdf(@Param('id', ParseUUIDPipe) id: string) {
    this.logAction('generatePdf');
    return enqueueWorkshopPdfGeneration(this.pdfService, id);
  }

  @Post('orders/:id/pdf/worker')
  @PdfWorker('workshop-order')
  async generatePdfWorker(@Param('id', ParseUUIDPipe) id: string) {
    this.logAction('generatePdfWorker');
    await this.pdfService.generateNow(id);
  }

  @Get('orders/:id/pdf')
  @ApiWorkshopOrderPdfDownload()
  async getPdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    this.logAction('getPdf');
    await serveWorkshopPdfDownload(this.pdfService, id, res);
  }
}
