import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { VehicleListingService } from './vehicle-listing.service.js';
import {
  CreateVehicleListingDto,
  PatchVehicleListingChannelDto,
  PatchVehicleListingDto,
  VehicleListingDto,
} from './dto/vehicle-listing.dto.js';

@ApiTags('vehicle-stock')
@Controller('vehicle-stock/:vehicleId/listing')
export class VehicleListingController {
  constructor(private readonly listings: VehicleListingService) {}

  @Get()
  @ApiOperation({ summary: 'Get marketplace listing for the current stock cycle' })
  @ApiOkResponse({ type: VehicleListingDto })
  get(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.listings.getListing(vehicleId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create marketplace listing for the current stock cycle' })
  @ApiCreatedResponse({ type: VehicleListingDto })
  create(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: CreateVehicleListingDto,
  ) {
    return this.listings.createListing(vehicleId, dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Update marketplace listing content' })
  @ApiOkResponse({ type: VehicleListingDto })
  patch(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: PatchVehicleListingDto,
  ) {
    return this.listings.patchListing(vehicleId, dto);
  }

  @Patch('channels/:platform')
  @ApiOperation({ summary: 'Update per-portal listing channel desired state' })
  @ApiOkResponse({ type: VehicleListingDto })
  patchChannel(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('platform') platform: string,
    @Body() dto: PatchVehicleListingChannelDto,
  ) {
    return this.listings.patchChannel(vehicleId, platform, dto);
  }
}
