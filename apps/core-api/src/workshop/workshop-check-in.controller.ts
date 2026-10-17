import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CompleteWorkshopCheckInDto,
  CreateWorkshopCheckInDto,
  UpdateWorkshopCheckInDto,
  UpdateWorkshopCheckInInspectionDto,
  WorkshopCheckInResponseDto,
} from './dto/workshop-check-in.dto.js';
import { WorkshopInspectionResponseDto } from './dto/workshop-inspection-response.dto.js';
import { WorkshopCheckInService } from './workshop-check-in.service.js';
import { WorkshopInspectionService } from './workshop-inspection.service.js';

@ApiTags('Workshop')
@Controller('workshop/orders/:orderId/check-in')
export class WorkshopCheckInController {
  constructor(
    private readonly checkIns: WorkshopCheckInService,
    private readonly inspections: WorkshopInspectionService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: WorkshopCheckInResponseDto })
  @ApiOkResponse({
    type: WorkshopCheckInResponseDto,
    description: 'Idempotent retry when the same check-in id already exists.',
  })
  async create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateWorkshopCheckInDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkshopCheckInResponseDto> {
    const result = await this.checkIns.create(orderId, dto);
    res.status(result.created ? 201 : 200);
    return result.body;
  }

  @Get()
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  get(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.get(orderId);
  }

  @Patch()
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  updateDraft(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.updateDraft(orderId, dto);
  }

  @Get('inspection')
  @ApiOkResponse({ type: WorkshopInspectionResponseDto })
  getInspection(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<WorkshopInspectionResponseDto> {
    return this.inspections.getOrderCheckInChecklist(orderId);
  }

  @Patch('inspection')
  @ApiOkResponse({ type: WorkshopInspectionResponseDto })
  updateInspection(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateWorkshopCheckInInspectionDto,
  ): Promise<WorkshopInspectionResponseDto> {
    const { expected_revision, items } = dto;
    return this.inspections.updateOrderCheckInChecklist(orderId, expected_revision, {
      items,
    });
  }

  @Post('complete')
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  complete(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CompleteWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.complete(orderId, dto);
  }
}
