import {
  PickerlDueListQueryDto,
  PickerlDueListExportQueryDto,
  PickerlDuePaginatedResponseDto,
} from './dto/pickerl-due-list.dto.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Header,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { VehicleService } from './vehicle.service.js';
import { VehicleIdentityService } from './vehicle-identity.service.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import {
  VehiclePaginatedResponseDto,
  VehicleResponseDto,
} from './dto/vehicle-response.dto.js';

@Controller('vehicles')
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly vehicleIdentityService: VehicleIdentityService,
  ) {}

  @Get('pickerl-due')
  @ApiOkResponse({ type: PickerlDuePaginatedResponseDto })
  findPickerlDue(@Query() query: PickerlDueListQueryDto) {
    return this.vehicleService.findPickerlDue(query);
  }

  @Get('pickerl-due/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  exportPickerlDue(@Query() query: PickerlDueListExportQueryDto) {
    return this.vehicleService.exportPickerlDueCsv(query);
  }

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
  @ApiOkResponse({ type: VehiclePaginatedResponseDto })
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
    const isInvalidSortDirection =
      sortDirection !== undefined &&
      sortDirection !== 'asc' &&
      sortDirection !== 'desc';

    if (isInvalidPage || isInvalidPageSize) {
      throw new BadRequestException(
        'page and pageSize must be positive integers',
      );
    }
    if (isInvalidSortDirection) {
      throw new BadRequestException('sortDirection must be "asc" or "desc"');
    }

    return this.vehicleService.findAll({
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortField,
      sortDirection: sortDirection ? sortDirection : undefined,
    });
  }

  @Post()
  @ApiCreatedResponse({ type: VehicleResponseDto })
  create(@Body() createVehicleDto: CreateVehicleDto) {
    return this.vehicleService.create(createVehicleDto);
  }

  @Post(':id/resolve-identity')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VehicleResponseDto })
  resolveIdentity(@Param('id') id: string) {
    return this.vehicleIdentityService.resolveIdentity(id);
  }

  @Get(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  findOne(@Param('id') id: string) {
    return this.vehicleService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  update(@Param('id') id: string, @Body() updateVehicleDto: UpdateVehicleDto) {
    return this.vehicleService.update(id, updateVehicleDto);
  }
}
