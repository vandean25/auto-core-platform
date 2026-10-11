import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { LedgerService } from './ledger.service.js';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto.js';
import {
  AvailabilityCheckResultDto,
  InventoryItemResponseDto,
  InventoryTransactionResponseDto,
  CatalogItemResponseDto,
} from './dto/inventory-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import {
  ApiInventorySort,
  parsePositiveInt,
  parseSortDirection,
} from './inventory-list-query.js';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Get('availability/:sku')
  @ApiOkResponse({ type: AvailabilityCheckResultDto })
  async checkAvailability(@Param('sku') sku: string) {
    return await this.inventoryService.checkAvailability(sku);
  }

  @Get(':id/history')
  @ApiOkResponse({ type: [InventoryTransactionResponseDto] })
  async getHistory(@Param('id') id: string) {
    const transactions = await this.ledgerService.getTransactionHistory(id);
    // Return last 20 transactions
    return transactions.slice(0, 20);
  }

  @Get()
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
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'location', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'brand', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'brandId',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiInventorySort()
  @ApiPaginatedResponse(InventoryItemResponseDto)
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('location') location?: string,
    @Query('brand') brand?: string,
    @Query('brandId') brandId?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: string,
  ) {
    return await this.inventoryService.findAll({
      page: parsePositiveInt(page, 1),
      pageSize: parsePositiveInt(pageSize, 10),
      search,
      location,
      brand,
      brandId: parsePositiveInt(brandId),
      sortField,
      sortDirection: parseSortDirection(sortDirection),
    });
  }

  @Post()
  @ApiCreatedResponse({ type: CatalogItemResponseDto })
  async createItem(@Body() createInventoryItemDto: CreateInventoryItemDto) {
    return await this.inventoryService.createItem(createInventoryItemDto);
  }
}
