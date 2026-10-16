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
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { LedgerService } from './ledger.service.js';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto.js';
import {
  AvailabilityCheckResultDto,
  CatalogItemResponseDto,
  InventoryItemDetailResponseDto,
  InventoryItemResponseDto,
  InventoryTransactionResponseDto,
} from './dto/inventory-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import {
  ApiInventorySort,
  parsePositiveInt,
  parseSortDirection,
} from './inventory-list-query.js';
import { ReceiveInventoryStockDto } from './dto/receive-inventory-stock.dto.js';
import { AdjustInventoryStockDto } from './dto/adjust-inventory-stock.dto.js';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly ledgerService: LedgerService,
    private readonly inventoryItemMutations: InventoryItemMutationsService,
  ) {}

  @Get('availability/:sku')
  @ApiOkResponse({ type: AvailabilityCheckResultDto })
  async checkAvailability(@Param('sku') sku: string) {
    return await this.inventoryService.checkAvailability(sku);
  }

  @Get(':id/history')
  @ApiOkResponse({ type: [InventoryTransactionResponseDto] })
  async getHistory(@Param('id', ParseUUIDPipe) id: string) {
    const transactions = await this.ledgerService.getTransactionHistory(id);
    return transactions.slice(0, 20);
  }

  @Get(':id')
  @ApiOkResponse({ type: InventoryItemDetailResponseDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.inventoryService.findOne(id);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async receiveStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveInventoryStockDto,
  ) {
    await this.inventoryItemMutations.receiveStock(id, dto);
  }

  @Post(':id/adjust')
  @HttpCode(HttpStatus.NO_CONTENT)
  async adjustStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustInventoryStockDto,
  ) {
    await this.inventoryItemMutations.adjustStock(id, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CatalogItemResponseDto })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return await this.inventoryItemMutations.updateItem(id, dto);
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
