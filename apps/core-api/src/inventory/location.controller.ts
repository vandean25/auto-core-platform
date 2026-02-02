import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LocationService } from './location.service';
import { LocationType } from '@prisma/client';

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
  create(@Body() body: { name: string; code: string; type: LocationType; parentId?: string }) {
    return this.locationService.create(body);
  }

  @Patch(':id')
  update(
      @Param('id') id: string,
      @Body() body: { name?: string; code?: string; type?: LocationType; parentId?: string }
  ) {
      return this.locationService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.locationService.remove(id);
  }
}
