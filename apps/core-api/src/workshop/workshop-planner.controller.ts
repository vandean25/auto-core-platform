import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PlannerGridResponseDto,
  PlannerQueryDto,
} from './dto/workshop-planner.dto.js';
import { WorkshopPlannerService } from './workshop-planner.service.js';

@ApiTags('Workshop')
@Controller('workshop/planner')
export class WorkshopPlannerController {
  constructor(private readonly plannerService: WorkshopPlannerService) {}

  @Get()
  @ApiOperation({ operationId: 'WorkshopController_getPlanner' })
  @ApiOkResponse({ type: PlannerGridResponseDto })
  getPlanner(@Query() query: PlannerQueryDto) {
    return this.plannerService.getPlanner(query);
  }
}
