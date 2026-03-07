import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
} from '@nestjs/common';
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
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy: string = 'due_date',
    @Query('order') order: 'asc' | 'desc' = 'asc',
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 25;
    return this.service.findAll(vendorId, status, pageNum, pageSizeNum, sortBy, order);
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
