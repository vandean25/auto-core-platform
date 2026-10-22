import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  CreateVehiclePartyDto,
  EndVehiclePartyDto,
  VehiclePartiesResponseDto,
  VehiclePartyResponseDto,
} from './dto/vehicle-party.dto.js';
import { VehiclePartyService } from './vehicle-party.service.js';

@Controller('vehicles/:vehicleId/parties')
export class VehiclePartyController {
  constructor(private readonly parties: VehiclePartyService) {}

  @Get()
  @ApiOperation({
    summary: 'List vehicle parties with history and the payer suggestion',
  })
  @ApiOkResponse({ type: VehiclePartiesResponseDto })
  @ApiNotFoundResponse({ description: 'Vehicle was not found' })
  list(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.parties.list(vehicleId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a vehicle party' })
  @ApiCreatedResponse({ type: VehiclePartyResponseDto })
  @ApiConflictResponse({ description: 'Overlaps an existing party interval' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid interval or role' })
  add(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: CreateVehiclePartyDto,
  ) {
    return this.parties.add(vehicleId, dto);
  }

  @Patch(':partyId')
  @ApiOperation({ summary: 'End an open-ended vehicle party' })
  @ApiOkResponse({ type: VehiclePartyResponseDto })
  @ApiConflictResponse({ description: 'The party already has an end date' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid end date' })
  end(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('partyId', ParseUUIDPipe) partyId: string,
    @Body() dto: EndVehiclePartyDto,
  ) {
    return this.parties.end(vehicleId, partyId, dto);
  }
}
