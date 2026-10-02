import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import { VehicleInspectionRecordService } from './vehicle-inspection-record.service.js';
import {
  CreateVehicleInspectionRecordDto,
  UpdateVehicleInspectionRecordDto,
  VehicleInspectionRecordResponseDto,
} from './dto/vehicle-inspection-record.dto.js';

@Controller('vehicles/:vehicleId/inspection-records')
export class VehicleInspectionRecordController {
  constructor(
    private readonly inspectionRecordService: VehicleInspectionRecordService,
  ) {}

  @Get()
  @MechanicAccessible()
  @ApiOkResponse({ type: [VehicleInspectionRecordResponseDto] })
  list(@Param('vehicleId') vehicleId: string) {
    return this.inspectionRecordService.listForVehicle(vehicleId);
  }

  @Get(':recordId')
  @MechanicAccessible()
  @ApiOkResponse({ type: VehicleInspectionRecordResponseDto })
  findOne(
    @Param('vehicleId') vehicleId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.inspectionRecordService.findOne(vehicleId, recordId);
  }

  @Post()
  @ApiCreatedResponse({ type: VehicleInspectionRecordResponseDto })
  create(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateVehicleInspectionRecordDto,
  ) {
    return this.inspectionRecordService.create(vehicleId, dto);
  }

  @Patch(':recordId')
  @ApiOkResponse({ type: VehicleInspectionRecordResponseDto })
  update(
    @Param('vehicleId') vehicleId: string,
    @Param('recordId') recordId: string,
    @Body() dto: UpdateVehicleInspectionRecordDto,
  ) {
    return this.inspectionRecordService.update(vehicleId, recordId, dto);
  }

  @Delete(':recordId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(
    @Param('vehicleId') vehicleId: string,
    @Param('recordId') recordId: string,
  ) {
    await this.inspectionRecordService.remove(vehicleId, recordId);
  }
}
