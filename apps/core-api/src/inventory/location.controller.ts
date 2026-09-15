import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { LocationService } from './location.service.js';

import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import {
  LocationResponseDto,
  LocationTreeNodeDto,
} from './dto/location-response.dto.js';

@Controller('inventory/locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get('tree')
  @ApiOkResponse({ type: [LocationTreeNodeDto] })
  getTree() {
    return this.locationService.getTree();
  }

  @Get('bins')
  @ApiOkResponse({ type: [LocationResponseDto] })
  getBins() {
    return this.locationService.getBins();
  }

  @Get(':id/children')
  @ApiOkResponse({ type: [LocationResponseDto] })
  getChildren(@Param('id') id: string) {
    return this.locationService.getChildren(id);
  }

  @Get()
  @ApiOkResponse({ type: [LocationResponseDto] })
  findAll() {
    return this.locationService.findAll();
  }

  @Post()
  @ApiCreatedResponse({ type: LocationResponseDto })
  create(@Body() createLocationDto: CreateLocationDto) {
    return this.locationService.create(createLocationDto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: LocationResponseDto })
  update(
    @Param('id') id: string,
    @Body() updateLocationDto: UpdateLocationDto,
  ) {
    return this.locationService.update(id, updateLocationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locationService.remove(id);
  }
}
