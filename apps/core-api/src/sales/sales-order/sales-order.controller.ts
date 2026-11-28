import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import { SalesOrderService } from './sales-order.service.js';
import { SalesOrderListService } from './sales-order-list.service.js';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto.js';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto.js';
import {
  SalesOrderCursorPageResponseDto,
  SalesOrderPaginatedResponseDto,
  SalesOrderResponseDto,
} from './dto/sales-order-response.dto.js';
import { InvoiceResponseDto } from '../dto/invoice-response.dto.js';
import { SalesOrderStatus } from '@prisma/client';
import {
  QueryBuilder,
  type QueryParams,
} from '../../common/utils/query-builder.js';
import {
  ApiListCursorModeQuery,
  ApiListOffsetPaginationQueries,
} from '../../common/dto/list-cursor-query.decorator.js';
import { CappedListCountResponseDto } from '../../common/dto/list-cursor-response.dto.js';
import { SCOPE_CONTEXT_HEADER } from '../../auth/scope-context/scope-context.constants.js';

@Controller('sales-orders')
export class SalesOrderController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly salesOrderList: SalesOrderListService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: SalesOrderResponseDto })
  create(@Body() createDto: CreateSalesOrderDto) {
    return this.salesOrderService.create(createDto);
  }

  @Get('capped-count')
  @ApiOperation({
    summary: 'Bounded match count for the sales order list (ADR-0035)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: {
      type: 'string',
      enum: ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED'],
    },
  })
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'params', required: false, schema: { type: 'string' } })
  @ApiHeader({ name: SCOPE_CONTEXT_HEADER, required: true })
  @ApiOkResponse({ type: CappedListCountResponseDto })
  cappedCount(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('params') params?: string,
    @Query() rawQuery: Record<string, string | undefined> = {},
    @Headers(SCOPE_CONTEXT_HEADER) scopeContext?: string,
  ) {
    return this.salesOrderList.cappedListCount(
      {
        status,
        search,
        params,
        page: rawQuery.page,
        pageSize: rawQuery.pageSize,
      },
      scopeContext,
    );
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
  @ApiListOffsetPaginationQueries()
  @ApiListCursorModeQuery()
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cursor mode only. Default 25, maximum 100.',
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({ name: 'params', required: false, schema: { type: 'string' } })
  @ApiHeader({
    name: SCOPE_CONTEXT_HEADER,
    required: false,
    description: 'Required in cursor mode (ADR-0038).',
  })
  @ApiExtraModels(
    SalesOrderPaginatedResponseDto,
    SalesOrderCursorPageResponseDto,
  )
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(SalesOrderPaginatedResponseDto) },
        { $ref: getSchemaPath(SalesOrderCursorPageResponseDto) },
      ],
    },
  })
  async findAll(
    @Query('status') status?: SalesOrderStatus,
    @Query('params') rawParams?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Query('pagination') pagination?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Headers(SCOPE_CONTEXT_HEADER) scopeContext?: string,
  ) {
    if (pagination === 'cursor' || Boolean(cursor)) {
      return this.salesOrderList.findAllWithCursor(
        {
          status,
          params: rawParams,
          page,
          pageSize,
          search,
          sortField,
          sortDirection,
          limit,
          cursor,
        },
        scopeContext,
      );
    }
    return this.findAllOffset({
      status,
      rawParams,
      page,
      pageSize,
      search,
      sortField,
      sortDirection,
    });
  }

  private async findAllOffset(query: {
    status?: SalesOrderStatus;
    rawParams?: string;
    page?: string;
    pageSize?: string;
    search?: string;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  }) {
    const queryParams = this.parseQueryParams(query.rawParams);
    const parsedPage = query.page ? parseInt(query.page, 10) : NaN;
    const parsedPageSize = query.pageSize ? parseInt(query.pageSize, 10) : NaN;

    if (Number.isFinite(parsedPage) && parsedPage > 0) {
      queryParams.page = parsedPage;
    }
    if (Number.isFinite(parsedPageSize) && parsedPageSize > 0) {
      queryParams.pageSize = parsedPageSize;
    }
    if (query.search) queryParams.search = query.search;
    if (query.sortField) {
      queryParams.sorting = [
        {
          field: query.sortField,
          direction: query.sortDirection ?? 'asc',
        },
      ];
    }

    if (query.status) {
      queryParams.filters = [
        {
          field: 'status',
          operator: 'equals',
          value: query.status,
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
          typeof parsed.pageSize === 'number' &&
          Number.isFinite(parsed.pageSize)
            ? parsed.pageSize
            : undefined,
        search: typeof parsed.search === 'string' ? parsed.search : undefined,
      };
    } catch {
      throw new BadRequestException('params must be valid JSON');
    }
  }

  @Get(':id')
  @ApiOkResponse({ type: SalesOrderResponseDto })
  findOne(@Param('id') id: string) {
    return this.salesOrderService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: SalesOrderResponseDto })
  update(@Param('id') id: string, @Body() updateDto: UpdateSalesOrderDto) {
    return this.salesOrderService.update(id, updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salesOrderService.remove(id);
  }

  @Post(':id/create-invoice')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoice(@Param('id') id: string) {
    return this.salesOrderService.createInvoiceFromOrder(id);
  }
}
