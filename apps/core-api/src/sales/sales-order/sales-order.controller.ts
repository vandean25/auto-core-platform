import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderStatus } from '@prisma/client';
import {
  QueryBuilder,
  type QueryParams,
} from '../../common/utils/query-builder';

@Controller('sales-orders')
export class SalesOrderController {
  constructor(private readonly salesOrderService: SalesOrderService) {}

  @Post()
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
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
  @ApiQuery({ name: 'params', required: false, schema: { type: 'string' } })
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  async findAll(
    @Query('status') status?: SalesOrderStatus,
    @Query('params') rawParams?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const queryParams = this.parseQueryParams(rawParams);
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
    const result = await this.salesOrderService.findAll(prismaQuery);

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

  private parseQueryParams(rawParams?: string): QueryParams {
    if (!rawParams) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawParams) as QueryParams;

      return {
        filters: Array.isArray(parsed.filters) ? parsed.filters : undefined,
        sorting: Array.isArray(parsed.sorting) ? parsed.sorting : undefined,
        page:
          typeof parsed.page === 'number' && Number.isFinite(parsed.page)
            ? parsed.page
            : undefined,
        pageSize:
          typeof parsed.pageSize === 'number' && Number.isFinite(parsed.pageSize)
            ? parsed.pageSize
            : undefined,
        search: typeof parsed.search === 'string' ? parsed.search : undefined,
      };
    } catch {
      throw new BadRequestException('params must be valid JSON');
    }
  }

  @Get(':id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  findOne(@Param('id') id: string) {
    return this.salesOrderService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  update(@Param('id') id: string, @Body() updateDto: UpdateSalesOrderDto) {
    return this.salesOrderService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salesOrderService.remove(id);
  }

  @Post(':id/create-invoice')
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  createInvoice(@Param('id') id: string) {
    return this.salesOrderService.createInvoiceFromOrder(id);
  }
}
