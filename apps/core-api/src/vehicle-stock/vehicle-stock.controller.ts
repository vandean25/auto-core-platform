import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { VehicleStockStatus } from '@prisma/client';
import { VehicleStockQueryService } from './vehicle-stock-query.service.js';
import { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto.js';
import { MoveVehicleSiteDto } from './dto/move-vehicle-site.dto.js';
import { VehicleStockMoveService } from './vehicle-stock-move.service.js';
import { VehicleStockReportsService } from './vehicle-stock-reports.service.js';
import {
  VehicleStockAgeReportQueryDto,
  VehicleStockMarginReportQueryDto,
  VehicleStockAgeReportResponseDto,
  VehicleStockMarginReportResponseDto,
  VehicleStockMarginRoleTotalsDto,
} from './dto/vehicle-stock-reports.dto.js';
import {
  GewaehrleistungDueListQueryDto,
  GewaehrleistungDueListResponseDto,
} from './dto/gewaehrleistung-due-list.dto.js';

@ApiTags('vehicle-stock')
@ApiExtraModels(VehicleStockMarginRoleTotalsDto)
@Controller('vehicle-stock')
export class VehicleStockController {
  constructor(
    private readonly stock: VehicleStockQueryService,
    private readonly moves: VehicleStockMoveService,
    private readonly reports: VehicleStockReportsService,
  ) {}

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
      sortDirection:
        sortDirection === 'desc'
          ? 'desc'
          : sortDirection === 'asc'
            ? 'asc'
            : undefined,
    });
  }

  @Get('reports/stock-age')
  @ApiOperation({ summary: 'List dealer stock vehicles by days in stock' })
  @ApiOkResponse({
    type: VehicleStockAgeReportResponseDto,
    description: 'Paginated stock age report',
  })
  stockAgeReport(@Query() query: VehicleStockAgeReportQueryDto) {
    return this.reports.stockAge(query);
  }

  @Get('reports/margin')
  @ApiOperation({ summary: 'List invoiced vehicle margins for a date period' })
  @ApiQuery({
    name: 'from',
    required: true,
    schema: { type: 'string', format: 'date' },
  })
  @ApiQuery({
    name: 'to',
    required: true,
    schema: { type: 'string', format: 'date' },
  })
  @ApiOkResponse({
    type: VehicleStockMarginReportResponseDto,
    description: 'Paginated vehicle margin report and totals',
  })
  marginReport(@Query() query: VehicleStockMarginReportQueryDto) {
    return this.reports.margin(query);
  }

  @Get('gewaehrleistung-due')
  @ApiOperation({
    summary: 'List consumer vehicle sales nearing base-period end',
  })
  @ApiOkResponse({ type: GewaehrleistungDueListResponseDto })
  gewaehrleistungDue(@Query() query: GewaehrleistungDueListQueryDto) {
    return this.stock.listGewaehrleistungDue(query);
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

  @Post(':vehicleId/move-site')
  moveSite(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: MoveVehicleSiteDto,
  ) {
    return this.moves.moveAcrossSites(vehicleId, dto);
  }
}
