import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('invoices')
  createDraft(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.salesService.createDraft(createInvoiceDto);
  }

  @Put('invoices/:id/finalize')
  finalize(@Param('id') id: string) {
    return this.salesService.finalize(id);
  }

  @Get('invoices')
  findAll() {
    return this.salesService.findAll();
  }

  @Get('invoices/:id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }
}
