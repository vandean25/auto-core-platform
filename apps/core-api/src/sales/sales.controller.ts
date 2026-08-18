import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('invoices')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createDraft(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.salesService.createDraft(createInvoiceDto);
  }

  @Put('invoices/:id/finalize')
  @ApiOkResponse({ type: InvoiceResponseDto })
  finalize(@Param('id') id: string) {
    return this.salesService.finalize(id);
  }

  @Get('invoices')
  @ApiOkResponse({ type: [InvoiceResponseDto] })
  findAll() {
    return this.salesService.findAll();
  }

  @Get('invoices/:id')
  @ApiOkResponse({ type: InvoiceResponseDto })
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }
}
