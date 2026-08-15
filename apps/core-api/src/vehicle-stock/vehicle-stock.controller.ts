import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VehicleStockStatus } from '@prisma/client';
import { VehicleStockQueryService } from './vehicle-stock-query.service';
import { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto';

@ApiTags('vehicle-stock')
@Controller('vehicle-stock')
export class VehicleStockController {
  constructor(private readonly stock: VehicleStockQueryService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('stock_status') stockStatus?: VehicleStockStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('pageSize') pageSize?: string,
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
