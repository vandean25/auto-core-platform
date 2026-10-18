import {
  Body,
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
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PdfWorker } from '../common/index.js';
import { WorkshopEstimateVersionDetailDto } from './dto/workshop-estimate-response.dto.js';
import { RecordWorkshopEstimateDecisionDto } from './dto/record-workshop-estimate-decision.dto.js';
import {
  SendWorkshopEstimateVersionDto,
  WorkshopPdfGenerationResponseDto,
} from './dto/index.js';
import { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import { WorkshopEstimateApprovalService } from './workshop-estimate-approval.service.js';
import { estimateSendOptionsFromDto } from './workshop-estimate-send.options.js';
import { serveWorkshopEstimatePdfDownload } from './workshop-estimate-pdf-http.js';
import { workshopPdfGenerationHttpBody } from './workshop-pdf-generation-http.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopEstimateVersionController {
  constructor(
    private readonly estimates: WorkshopEstimateService,
    private readonly pdfService: WorkshopEstimatePdfService,
    private readonly approvals: WorkshopEstimateApprovalService,
  ) {}

  @Get('estimates/:versionId')
  @ApiOkResponse({ type: WorkshopEstimateVersionDetailDto })
  getVersion(@Param('versionId') versionId: string) {
    return this.estimates.getVersion(versionId);
  }

  @Post('estimates/:versionId/send')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: SendWorkshopEstimateVersionDto, required: false })
  @ApiOkResponse({ type: WorkshopEstimateVersionDetailDto })
  send(
    @Param('versionId') versionId: string,
    @Body() body?: SendWorkshopEstimateVersionDto,
  ) {
    return this.estimates.sendVersion(
      versionId,
      estimateSendOptionsFromDto(body),
    );
  }

  @Post('estimates/:versionId/approve-advisor')
  @ApiCreatedResponse({ type: WorkshopEstimateVersionDetailDto })
  recordAdvisorDecision(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: RecordWorkshopEstimateDecisionDto,
  ) {
    return this.approvals.recordAdvisorDecision(versionId, body);
  }

  @Post('estimates/:versionId/pdf')
  @ApiCreatedResponse({ type: WorkshopPdfGenerationResponseDto })
  async requestPdf(@Param('versionId', ParseUUIDPipe) versionId: string) {
    const result = await this.estimates.requestVersionPdf(versionId);
    return workshopPdfGenerationHttpBody(result);
  }

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
    await serveWorkshopEstimatePdfDownload(
      (id) => this.estimates.getVersionPdf(id),
      versionId,
      res,
    );
  }
}
