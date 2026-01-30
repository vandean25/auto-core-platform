import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { VendorService } from './vendor.service';

@Controller('vendors')
export class VendorController {
    constructor(private readonly vendorService: VendorService) { }

    @Post()
    async create(@Body() body: { name: string; email: string; accountNumber: string; supportedBrands: string[] }) {
        return this.vendorService.create(body);
    }

    @Get()
    async findAll() {
        return this.vendorService.findAll();
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.vendorService.findOne(id);
    }

    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body() body: { name?: string; email?: string; accountNumber?: string; supportedBrands?: string[] }
    ) {
        return this.vendorService.update(id, body);
    }
}
