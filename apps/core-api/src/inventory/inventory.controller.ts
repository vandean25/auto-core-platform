import { Controller, Get, Param, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
    constructor(private readonly inventoryService: InventoryService) { }

    @Get('availability/:sku')
    async checkAvailability(@Param('sku') sku: string) {
        return await this.inventoryService.checkAvailability(sku);
    }

    @Get()
    async findAll(
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '10',
        @Query('search') search?: string,
        @Query('location') location?: string,
    ) {
        return await this.inventoryService.findAll({
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            search,
            location,
        });
    }
}
