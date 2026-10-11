import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  WorkshopCapacityQueryDto,
  WorkshopCapacityWeekDto,
} from './dto/workshop-capacity.dto.js';
import { WorkshopCapacityService } from './workshop-capacity.service.js';

@ApiTags('Workshop')
@Controller('workshop/capacity')
export class WorkshopCapacityController {
  constructor(private readonly capacityService: WorkshopCapacityService) {}

  @Get()
  @ApiOperation({ operationId: 'WorkshopController_getCapacityWeek' })
  @ApiOkResponse({ type: WorkshopCapacityWeekDto })
  getCapacityWeek(@Query() query: WorkshopCapacityQueryDto) {
    return this.capacityService.getCapacityWeek(query);
  }
}
