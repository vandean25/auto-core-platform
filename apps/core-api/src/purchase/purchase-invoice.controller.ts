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
    // Validate and normalize pagination parameters
    let pageNum = page ? parseInt(page, 10) : 1;
    let pageSizeNum = pageSize ? parseInt(pageSize, 10) : 25;

    // Ensure valid integers, treating NaN and non-positive values as defaults
    if (!Number.isFinite(pageNum) || pageNum < 1) pageNum = 1;
    if (!Number.isFinite(pageSizeNum) || pageSizeNum < 1) pageSizeNum = 25;

    // Enforce maximum page size
    const MAX_PAGE_SIZE = 100;
    if (pageSizeNum > MAX_PAGE_SIZE) pageSizeNum = MAX_PAGE_SIZE;

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
