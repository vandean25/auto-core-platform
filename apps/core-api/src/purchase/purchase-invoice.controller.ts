import { Controller, Get, Post, Body, Param, Query, Patch } from '@nestjs/common';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { CreatePurchaseInvoiceDto } from './dto/create-purchase-invoice.dto';
import { PurchaseInvoiceStatus } from '@prisma/client';

@Controller('purchase-invoices')
export class PurchaseInvoiceController {
  constructor(private readonly service: PurchaseInvoiceService) {}

  @Post()
  create(@Body() createDto: CreatePurchaseInvoiceDto) {
    return this.service.create(createDto);
  }

  @Get()
  findAll(
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: PurchaseInvoiceStatus,
  ) {
    return this.service.findAll(vendorId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/post')
  post(@Param('id') id: string) {
    return this.service.post(id);
  }
}
