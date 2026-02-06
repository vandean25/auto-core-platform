import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { LocationService } from './location.service';

import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('inventory/locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Get('tree')
  getTree() {
    return this.locationService.getTree();
  }

  @Get('bins')
  getBins() {
    return this.locationService.getBins();
  }

  @Get(':id/children')
  getChildren(@Param('id') id: string) {
    return this.locationService.getChildren(id);
  }

  @Get()
  findAll() {
    return this.locationService.findAll();
  }

  @Post()
  create(@Body() createLocationDto: CreateLocationDto) {
    return this.locationService.create(createLocationDto);
  }

  @Patch(':id')
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