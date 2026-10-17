import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { VehicleEquipmentService } from './vehicle-equipment.service.js';
import {
  ReplaceVehicleEquipmentDto,
  VehicleEquipmentAssignmentDto,
  VehicleEquipmentOptionListResponseDto,
} from './dto/vehicle-equipment.dto.js';

@ApiTags('vehicle-equipment')
@Controller()
export class VehicleEquipmentController {
  constructor(private readonly equipment: VehicleEquipmentService) {}

  @Get('vehicle-equipment-options')
  @ApiOperation({ summary: 'List active tenant equipment taxonomy options' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer' } })
  @ApiOkResponse({ type: VehicleEquipmentOptionListResponseDto })
  listOptions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const parsedPage = page ? Number.parseInt(page, 10) : 1;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    return this.equipment.listOptions(parsedPage, parsedLimit, search);
  }

  @Get('vehicle-stock/:vehicleId/equipment')
  @ApiOperation({ summary: 'Get equipment assigned to a stock vehicle' })
  @ApiOkResponse({ type: VehicleEquipmentAssignmentDto })
  getAssignment(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.equipment.getVehicleEquipment(vehicleId);
  }

  @Put('vehicle-stock/:vehicleId/equipment')
  @ApiOperation({ summary: 'Replace equipment assigned to a stock vehicle' })
  @ApiOkResponse({ type: VehicleEquipmentAssignmentDto })
  replaceAssignment(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: ReplaceVehicleEquipmentDto,
  ) {
    return this.equipment.replaceVehicleEquipment(vehicleId, dto);
  }
}
