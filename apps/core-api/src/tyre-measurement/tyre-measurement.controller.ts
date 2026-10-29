import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import {
  CreateTyreMeasurementDto,
  TyreMeasurementListResponseDto,
  TyreMeasurementQueryDto,
  TyreMeasurementResponseDto,
} from './tyre-measurement.dto.js';
import { TyreMeasurementService } from './tyre-measurement.service.js';

@ApiTags('tyre-measurements')
@MechanicAccessible()
@Controller()
export class TyreMeasurementController {
  constructor(private readonly measurements: TyreMeasurementService) {}

  @Post('workshop-orders/:id/tyre-measurements')
  @ApiCreatedResponse({ type: TyreMeasurementResponseDto })
  createForOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTyreMeasurementDto,
  ) {
    return this.measurements.create({ kind: 'order', id }, dto);
  }

  @Post('workshop-check-ins/:id/tyre-measurements')
  @ApiCreatedResponse({ type: TyreMeasurementResponseDto })
  createForCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTyreMeasurementDto,
  ) {
    return this.measurements.create({ kind: 'checkIn', id }, dto);
  }

  @Get('workshop-orders/:id/tyre-measurements')
  @ApiOkResponse({ type: TyreMeasurementListResponseDto })
  listForOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TyreMeasurementQueryDto,
  ) {
    return this.measurements.list({ kind: 'order', id }, query);
  }

  @Get('workshop-check-ins/:id/tyre-measurements')
  @ApiOkResponse({ type: TyreMeasurementListResponseDto })
  listForCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TyreMeasurementQueryDto,
  ) {
    return this.measurements.list({ kind: 'checkIn', id }, query);
  }

  @Get('tyre-set-events/:id/tyre-measurements')
  @ApiOkResponse({ type: TyreMeasurementListResponseDto })
  listForEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TyreMeasurementQueryDto,
  ) {
    return this.measurements.list({ kind: 'event', id }, query);
  }

  @Get('tyre-measurements/:id')
  @ApiOkResponse({ type: TyreMeasurementResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.measurements.findOne(id);
  }
}
