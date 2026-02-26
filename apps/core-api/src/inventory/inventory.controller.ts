import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
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
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'location', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'brand', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'brandId', required: false, schema: { type: 'integer', minimum: 1 } })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('location') location?: string,
    @Query('brand') brand?: string,
    @Query('brandId') brandId?: string,
  ) {
    return await this.inventoryService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 10,
      search,
      location,
      brand,
      brandId: brandId ? parseInt(brandId, 10) : undefined,
    });
  }

  @Post()
  async createItem(@Body() createInventoryItemDto: CreateInventoryItemDto) {
    return await this.inventoryService.createItem(createInventoryItemDto);
  }
}
