import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
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
  create(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateWorkshopCheckInDto,
  ): Promise<WorkshopCheckInResponseDto> {
    return this.checkIns.create(orderId, dto);
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
}
