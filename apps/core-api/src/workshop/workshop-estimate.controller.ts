import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { PdfWorker } from '../common/index.js';
import {
  WorkshopEstimateListResponseDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import { WorkshopPdfGenerationResponseDto } from './dto/index.js';
import { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';

async function servePdfDownload(
  estimates: WorkshopEstimateService,
  versionId: string,
  res: Response,
) {
  const { stream, filename, contentType, contentLength } =
    await estimates.getVersionPdf(versionId);
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${safeFilename}"`,
  });
  if (contentLength != null) {
    res.set('Content-Length', contentLength.toString());
  }
  await pipeline(stream, res);
}

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopEstimateController {
  constructor(
    private readonly estimates: WorkshopEstimateService,
    private readonly pdfService: WorkshopEstimatePdfService,
  ) {}

  @Post('orders/:id/estimates')
  @ApiCreatedResponse({ type: WorkshopEstimateResponseDto })
  create(@Param('id') id: string) {
    return this.estimates.createForOrder(id);
  }

  @Get('orders/:id/estimates')
  @ApiOkResponse({ type: WorkshopEstimateListResponseDto })
  list(@Param('id') id: string) {
    return this.estimates.listForOrder(id);
  }

  @Post('orders/:id/estimates/revisions')
  @ApiCreatedResponse({ type: WorkshopEstimateVersionDetailDto })
  revise(@Param('id') id: string) {
    return this.estimates.createRevision(id);
  }

  @Get('estimates/:versionId')
  @ApiOkResponse({ type: WorkshopEstimateVersionDetailDto })
  getVersion(@Param('versionId') versionId: string) {
    return this.estimates.getVersion(versionId);
  }

  @Post('estimates/:versionId/send')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkshopEstimateVersionDetailDto })
  send(@Param('versionId') versionId: string) {
    return this.estimates.sendVersion(versionId);
  }

  @Post('estimates/:versionId/pdf')
  @ApiCreatedResponse({ type: WorkshopPdfGenerationResponseDto })
  async requestPdf(@Param('versionId', ParseUUIDPipe) versionId: string) {
    const result = await this.estimates.requestVersionPdf(versionId);
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

  /**
   * Cloud Tasks entry point. The route param must be `id`: the worker guard
   * compares it with the resource id signed into the task payload.
   */
  @Post('estimates/:id/pdf/worker')
  @PdfWorker('workshop-estimate')
  async generatePdfWorker(@Param('id', ParseUUIDPipe) id: string) {
    await this.pdfService.generateNow(id);
  }

  @Get('estimates/:versionId/pdf')
  @ApiProduces('application/pdf')
  async getPdf(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Res() res: Response,
  ) {
    await servePdfDownload(this.estimates, versionId, res);
  }
}
