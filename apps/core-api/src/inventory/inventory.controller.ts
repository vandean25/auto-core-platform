import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';
import { QueryBuilder } from '../common/utils/query-builder';
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
  async findAll(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
    @Query('location') location?: string,
    @Query('brand') brand?: string,
    @Query('brandId') brandId?: string,
    @Query('params') params?: string,
  ) {
    if (params) {
      let queryParams;
      try {
        queryParams = JSON.parse(params);
      } catch (error) {
        throw new BadRequestException('Invalid params JSON');
      }

      const whitelist = ['sku', 'name', 'brand.name', 'createdAt'];
      const searchFields = ['sku', 'name', 'brand.name'];
      const prismaQuery = QueryBuilder.buildPrismaQuery(
        queryParams,
        whitelist,
        searchFields,
      );

      return await this.inventoryService.findAll(prismaQuery);
    }

    return await this.inventoryService.findAll({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
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
