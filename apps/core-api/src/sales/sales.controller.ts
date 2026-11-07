import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import { SalesService } from './sales.service.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import {
  InvoiceCursorPageResponseDto,
  InvoiceResponseDto,
} from './dto/invoice-response.dto.js';
import { parseSortDirection } from '../inventory/inventory-list-query.js';
import { InvoiceListService } from './invoice-list.service.js';
import { CappedListCountResponseDto } from '../common/dto/list-cursor-response.dto.js';
import { ApiListCursorModeQuery } from '../common/dto/list-cursor-query.decorator.js';
import { DryRunRefused } from '../dry-run/dry-run.decorators.js';

@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly invoiceList: InvoiceListService,
  ) {}

  @Post('invoices')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createDraft(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.salesService.createDraft(createInvoiceDto);
  }

  @Patch('invoices/:id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  updateDraft(
    @Param('id') id: string,
    @Body() createInvoiceDto: CreateInvoiceDto,
  ) {
    return this.salesService.updateDraft(id, createInvoiceDto);
  }

  @Put('invoices/:id/finalize')
  @DryRunRefused(
    'Invoice finalization consumes numbering sequences and creates irreversible legal tax records',
  )
  @ApiOkResponse({ type: InvoiceResponseDto })
  finalize(@Param('id') id: string) {
    return this.salesService.finalize(id);
  }

  @Get('invoices/capped-count')
  @ApiOperation({
    summary: 'Bounded match count for the invoice list search (ADR-0035)',
  })
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiOkResponse({ type: CappedListCountResponseDto })
  cappedCount(@Query('search') search?: string) {
    return this.invoiceList.cappedListCount({ search });
  }

  @Get('invoices')
  @ApiOperation({
    summary:
      'List invoices. Unpaged array by default; `pagination=cursor` returns a keyset page.',
  })
  @ApiListCursorModeQuery()
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cursor mode only. Default 25, maximum 100.',
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'sortField',
    required: false,
    description: 'Cursor mode only: `invoice_number` or `date` (default).',
    schema: { type: 'string', enum: ['invoice_number', 'date'] },
  })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  })
  @ApiExtraModels(InvoiceResponseDto, InvoiceCursorPageResponseDto)
  @ApiOkResponse({
    schema: {
      oneOf: [
        { type: 'array', items: { $ref: getSchemaPath(InvoiceResponseDto) } },
        { $ref: getSchemaPath(InvoiceCursorPageResponseDto) },
      ],
    },
  })
  findAll(
    @Query('pagination') pagination?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: string,
  ) {
    if (pagination === 'cursor' || cursor) {
      return this.invoiceList.findAllWithCursor({
        search,
        sortField,
        sortDirection: parseSortDirection(sortDirection),
        limit,
        cursor,
      });
    }
    return this.salesService.findAll();
  }

  @Get('invoices/:id')
  @ApiOkResponse({ type: InvoiceResponseDto })
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }
}
