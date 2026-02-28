import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Get('availability/:sku')
  async checkAvailability(@Param('sku') sku: string) {
    return await this.inventoryService.checkAvailability(sku);
  }

  @Get(':id/history')
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
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('location') location?: string,
    @Query('brand') brand?: string,
    @Query('brandId') brandId?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedPageSize = pageSize ? parseInt(pageSize, 10) : NaN;
    const parsedBrandId = brandId ? parseInt(brandId, 10) : NaN;

    return await this.inventoryService.findAll({
      page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
      pageSize:
        Number.isFinite(parsedPageSize) && parsedPageSize > 0
          ? parsedPageSize
          : 10,
      search,
      location,
      brand,
      brandId:
        Number.isFinite(parsedBrandId) && parsedBrandId > 0
          ? parsedBrandId
          : undefined,
    });
  }

  @Post()
  async createItem(@Body() createInventoryItemDto: CreateInventoryItemDto) {
    return await this.inventoryService.createItem(createInventoryItemDto);
  }
}
