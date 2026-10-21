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
import { pipeline } from 'node:stream/promises';
import { PdfWorker } from '../common/pdf/index.js';
import {
  WorkshopEstimateListResponseDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import { WorkshopOrderCommunicationsResponseDto } from './dto/workshop-order-communications.dto.js';
import { RecordWorkshopEstimateDecisionDto } from './dto/record-workshop-estimate-decision.dto.js';
import {
  RecordWorkshopOverrunNoticeDto,
  WorkshopOverrunNoticeDto,
} from './dto/record-workshop-overrun-notice.dto.js';
import {
  SendWorkshopEstimateVersionDto,
  WorkshopPdfGenerationResponseDto,
} from './dto/index.js';
import { WorkshopEstimatePdfService } from './workshop-estimate-pdf.service.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import { WorkshopEstimateApprovalService } from './workshop-estimate-approval.service.js';
import { WorkshopOverrunNoticeService } from './workshop-overrun-notice.service.js';
import { WorkshopMechanicFindingService } from './workshop-mechanic-finding.service.js';
import { WorkshopMechanicFindingListResponseDto } from './dto/workshop-mechanic-finding.dto.js';

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
    private readonly approvals: WorkshopEstimateApprovalService,
    private readonly overrunNotices: WorkshopOverrunNoticeService,
    private readonly mechanicFindings: WorkshopMechanicFindingService,
  ) {}

  @Get('orders/:id/mechanic-findings')
  @ApiOkResponse({ type: WorkshopMechanicFindingListResponseDto })
  listMechanicFindings(@Param('id') id: string) {
    return this.mechanicFindings.listForOrder(id);
  }

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

  @Get('orders/:id/communications')
  @ApiOkResponse({ type: WorkshopOrderCommunicationsResponseDto })
  communications(@Param('id') id: string) {
    return this.estimates.listCommunicationsForOrder(id);
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
  @ApiBody({ type: SendWorkshopEstimateVersionDto, required: false })
  @ApiOkResponse({ type: WorkshopEstimateVersionDetailDto })
  send(
    @Param('versionId') versionId: string,
    @Body() body?: SendWorkshopEstimateVersionDto,
  ) {
    return this.estimates.sendVersion(versionId, {
      notifyCustomerByEmail: body?.notifyCustomerByEmail === true,
    });
  }

  /** Advisor-recorded decision on a sent version (AUT-355). TECH and other roles are refused. */
  @Post('estimates/:versionId/approve-advisor')
  @ApiCreatedResponse({ type: WorkshopEstimateVersionDetailDto })
  recordAdvisorDecision(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() body: RecordWorkshopEstimateDecisionDto,
  ) {
    return this.approvals.recordAdvisorDecision(versionId, body);
  }

  /** The advisor informed the customer about the overrun of the approved baseline (AUT-355, ADR-0025 §1). */
  @Post('orders/:id/overrun/notify')
  @ApiCreatedResponse({ type: WorkshopOverrunNoticeDto })
  recordOverrunNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordWorkshopOverrunNoticeDto,
  ) {
    return this.overrunNotices.recordNotice(id, body);
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
