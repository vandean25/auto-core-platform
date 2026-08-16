import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { VehicleStockStatus } from '@prisma/client';
import { VehicleStockQueryService } from './vehicle-stock-query.service';
import { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto';

@ApiTags('vehicle-stock')
@Controller('vehicle-stock')
export class VehicleStockController {
  constructor(private readonly stock: VehicleStockQueryService) {}

  @Get()
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'stock_status',
    required: false,
    schema: { type: 'string', enum: Object.values(VehicleStockStatus) },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'limit',
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
  list(
    @Query('search') search?: string,
    @Query('stock_status') stockStatus?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    return this.stock.list({
      search,
      stock_status: stockStatus,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit
        ? parseInt(limit, 10)
        : pageSize
          ? parseInt(pageSize, 10)
          : undefined,
      sortField,
      sortDirection: sortDirection === 'desc' ? 'desc' : sortDirection === 'asc' ? 'asc' : undefined,
    });
  }

  @Get(':vehicleId')
  detail(@Param('vehicleId') vehicleId: string) {
    return this.stock.detail(vehicleId);
  }

  @Patch(':vehicleId')
  patch(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: PatchVehicleStockDto,
  ) {
    return this.stock.patch(vehicleId, dto);
  }
}
