import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  WorkshopEstimateListResponseDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import { WorkshopOrderCommunicationsResponseDto } from './dto/workshop-order-communications.dto.js';
import {
  RecordWorkshopOverrunNoticeDto,
  WorkshopOverrunNoticeDto,
} from './dto/record-workshop-overrun-notice.dto.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';
import { WorkshopOverrunNoticeService } from './workshop-overrun-notice.service.js';
import { WorkshopMechanicFindingService } from './workshop-mechanic-finding.service.js';
import { WorkshopMechanicFindingListResponseDto } from './dto/workshop-mechanic-finding.dto.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopEstimateOrderController {
  constructor(
    private readonly estimates: WorkshopEstimateService,
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

  @Post('orders/:id/overrun/notify')
  @ApiCreatedResponse({ type: WorkshopOverrunNoticeDto })
  recordOverrunNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordWorkshopOverrunNoticeDto,
  ) {
    return this.overrunNotices.recordNotice(id, body);
  }
}
