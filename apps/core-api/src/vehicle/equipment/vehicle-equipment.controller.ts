import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  PatchVehicleEquipmentOptionDto,
  ReplaceVehicleEquipmentDto,
  VehicleEquipmentAssignmentDto,
  VehicleEquipmentOptionDto,
  VehicleEquipmentOptionListResponseDto,
} from './dto/vehicle-equipment.dto.js';

function parsePositiveIntQuery(
  value: string | undefined,
  field: string,
  fallback: number,
): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_PAGINATION',
      message: `${field} must be a positive integer.`,
    });
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new BadRequestException({
      code: 'INVALID_PAGINATION',
      message: `${field} must be a positive integer.`,
    });
  }
  return parsed;
}

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
    const parsedPage = parsePositiveIntQuery(page, 'page', 1);
    const parsedLimit = parsePositiveIntQuery(limit, 'limit', 100);
    return this.equipment.listOptions(parsedPage, parsedLimit, search);
  }

  @Patch('vehicle-equipment-options/:optionId')
  @ApiOperation({ summary: 'Activate or deactivate a tenant equipment option' })
  @ApiOkResponse({ type: VehicleEquipmentOptionDto })
  patchOption(
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() dto: PatchVehicleEquipmentOptionDto,
  ) {
    return this.equipment.patchOption(optionId, dto);
  }

  @Get('vehicle-stock/:vehicleId/equipment')
  @ApiOperation({
    summary: 'Get equipment for the current stock cycle of a stock vehicle',
  })
  @ApiOkResponse({ type: VehicleEquipmentAssignmentDto })
  getAssignment(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.equipment.getVehicleEquipment(vehicleId);
  }

  @Put('vehicle-stock/:vehicleId/equipment')
  @ApiOperation({
    summary: 'Replace equipment for the current stock cycle of a stock vehicle',
  })
  @ApiOkResponse({ type: VehicleEquipmentAssignmentDto })
  replaceAssignment(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: ReplaceVehicleEquipmentDto,
  ) {
    return this.equipment.replaceVehicleEquipment(vehicleId, dto);
  }
}
