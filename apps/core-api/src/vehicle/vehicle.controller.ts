import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { VehicleService } from './vehicle.service';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Controller('vehicles')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Get()
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({ name: 'sortField', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  })
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const integerPattern = /^\d+$/;
    const isInvalidPage =
      page !== undefined &&
      (!integerPattern.test(page) || parseInt(page, 10) <= 0);
    const isInvalidPageSize =
      pageSize !== undefined &&
      (!integerPattern.test(pageSize) || parseInt(pageSize, 10) <= 0);

    if (isInvalidPage || isInvalidPageSize) {
      throw new BadRequestException(
        'page and pageSize must be positive integers',
      );
    }

    return this.vehicleService.findAll({
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortField,
      sortDirection,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehicleService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVehicleDto: UpdateVehicleDto) {
    return this.vehicleService.update(id, updateVehicleDto);
  }
}
