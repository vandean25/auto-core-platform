import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderStatus } from '@prisma/client';
import { QueryBuilder } from '../../common/utils/query-builder';

@Controller('sales-orders')
export class SalesOrderController {
  constructor(private readonly salesOrderService: SalesOrderService) {}

  @Post()
  create(@Body() createDto: CreateSalesOrderDto) {
    return this.salesOrderService.create(createDto);
  }

  @Get()
  @ApiQuery({
    name: 'status',
    required: false,
    schema: {
      type: 'string',
      enum: ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED'],
    },
  })
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({ name: 'sortField', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  })
  async findAll(
    @Query('status') status?: SalesOrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const queryParams: any = {};
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedPageSize = pageSize ? parseInt(pageSize, 10) : NaN;

    if (Number.isFinite(parsedPage) && parsedPage > 0) {
      queryParams.page = parsedPage;
    }
    if (Number.isFinite(parsedPageSize) && parsedPageSize > 0) {
      queryParams.pageSize = parsedPageSize;
    }
    if (search) queryParams.search = search;
    if (sortField) {
      queryParams.sorting = [
        {
          field: sortField,
          direction: sortDirection ?? 'asc',
        },
      ];
    }

    if (status) {
      queryParams.filters = [
        {
          field: 'status',
          operator: 'equals',
          value: status,
        },
      ];
    }

    const whitelist = [
      'status',
      'order_number',
      'total_amount',
      'createdAt',
      'customer.last_name',
      'customer.company_name',
    ];
    const searchFields = [
      'order_number',
      'customer.last_name',
      'customer.company_name',
    ];

    const prismaQuery = QueryBuilder.buildPrismaQuery(
      queryParams,
      whitelist,
      searchFields,
    );
    const result = (await this.salesOrderService.findAll(prismaQuery)) as any;

    return {
      data: result.data,
      meta: {
        total: result.total,
        page: queryParams.page ?? 1,
        pageSize: queryParams.pageSize ?? 25,
        pageCount: Math.ceil(result.total / (queryParams.pageSize ?? 25)),
      },
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesOrderService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateSalesOrderDto) {
    return this.salesOrderService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salesOrderService.remove(id);
  }

  @Post(':id/create-invoice')
  createInvoice(@Param('id') id: string) {
    return this.salesOrderService.createInvoiceFromOrder(id);
  }
}
