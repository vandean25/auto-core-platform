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
  WorkshopCheckInResponseDto,
} from './dto/workshop-check-in.dto.js';
import { WorkshopCheckInService } from './workshop-check-in.service.js';

@ApiTags('Workshop')
@Controller('workshop/orders/:orderId/check-in')
export class WorkshopCheckInController {
  constructor(private readonly checkIns: WorkshopCheckInService) {}

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

  @Post('complete')
  @ApiOkResponse({ type: WorkshopCheckInResponseDto })
  complete(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CompleteWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.complete(orderId, dto);
  }
}
