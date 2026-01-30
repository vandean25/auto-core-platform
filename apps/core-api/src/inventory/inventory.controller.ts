import { Controller, Get, Param, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';

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
  ) {
    return await this.inventoryService.findAll({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      location,
      brand,
    });
  }
}
