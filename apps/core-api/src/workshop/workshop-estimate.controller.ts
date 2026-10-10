import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  WorkshopEstimateListResponseDto,
  WorkshopEstimateResponseDto,
  WorkshopEstimateVersionDetailDto,
} from './dto/workshop-estimate-response.dto.js';
import { WorkshopEstimateService } from './workshop-estimate.service.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopEstimateController {
  constructor(private readonly estimates: WorkshopEstimateService) {}

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
}
