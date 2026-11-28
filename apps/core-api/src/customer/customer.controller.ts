import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Headers,
  Query,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import {
  CUSTOM_FIELD_FILTER_DESCRIPTION,
  CustomFieldFilterParams,
  CustomFieldListQuery,
} from '../custom-fields/custom-field-list-query.js';
import { SCOPE_CONTEXT_HEADER } from '../auth/scope-context/scope-context.constants.js';
import { CustomerService } from './customer.service.js';
import { CustomerListService } from './customer-list.service.js';
import { CustomerActivityService } from './activity/customer-activity.service.js';
import { CustomFieldsGdprService } from '../custom-fields/custom-fields-gdpr.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import {
  CustomersCappedCountQueryDto,
  FindAllCustomersQueryDto,
} from './dto/find-all-customers-query.dto.js';
import { CustomerActivityQueryDto } from './dto/customer-activity-query.dto.js';
import { CustomerActivityResponseDto } from './dto/customer-activity-response.dto.js';
import { CustomerDetailResponseDto } from './dto/customer-detail-response.dto.js';
import { CustomerResponseDto } from './dto/customer-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import {
  ApiListCursorModeQuery,
  ApiListOffsetPaginationQueries,
} from '../common/dto/list-cursor-query.decorator.js';
import { CappedListCountResponseDto } from '../common/dto/list-cursor-response.dto.js';
import {
  QueryBuilder,
  type QueryParams,
} from '../common/utils/query-builder.js';
import { DryRunSupported } from '../dry-run/dry-run.decorators.js';

async function findAllCustomersOffset(
  customerService: CustomerService,
  query: FindAllCustomersQueryDto,
) {
  const { search, type, page, pageSize, sortField, sortDirection } = query;
  const queryParams: QueryParams = {};
  const parsedPage = page ? parseInt(page, 10) : NaN;
  const parsedPageSize = pageSize ? parseInt(pageSize, 10) : NaN;

  if (Number.isFinite(parsedPage) && parsedPage > 0) {
    queryParams.page = parsedPage;
  }
  if (Number.isFinite(parsedPageSize) && parsedPageSize > 0) {
    queryParams.pageSize = parsedPageSize;
  }
  if (sortField) {
    queryParams.sorting = [
      {
        field: sortField,
        direction: sortDirection ?? 'asc',
      },
    ];
  }
  if (type) {
    queryParams.filters = [{ field: 'type', operator: 'equals', value: type }];
  }

  if (search || Object.keys(queryParams).length > 0) {
    const whitelist = [
      'first_name',
      'last_name',
      'company_name',
      'email',
      'type',
      'phone',
      'address_city',
      'createdAt',
    ];
    const prismaQuery = QueryBuilder.buildPrismaQuery(queryParams, whitelist);
    const result = await customerService.findAll(prismaQuery, search);

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

  const result = await customerService.findAll(search);
  return {
    data: result.data,
    meta: {
      total: result.total,
      page: 1,
      pageSize: result.data.length || 1,
      pageCount: 1,
    },
  };
}

@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly customerList: CustomerListService,
    private readonly customerActivityService: CustomerActivityService,
    private readonly customFieldsGdpr: CustomFieldsGdprService,
  ) {}

  @Post()
  @DryRunSupported()
  @ApiCreatedResponse({ type: CustomerResponseDto })
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customerService.create(createCustomerDto);
  }

  @Get('capped-count')
  @ApiOperation({
    operationId: 'CustomerController_cappedCount',
    description: CUSTOM_FIELD_FILTER_DESCRIPTION,
    summary: 'Bounded match count for the customer list (ADR-0035)',
  })
  @ApiQuery({ type: CustomersCappedCountQueryDto, required: false })
  @ApiHeader({ name: SCOPE_CONTEXT_HEADER, required: true })
  @ApiOkResponse({ type: CappedListCountResponseDto })
  cappedCount(
    @CustomFieldListQuery(CustomersCappedCountQueryDto)
    query: CustomersCappedCountQueryDto,
    @Headers(SCOPE_CONTEXT_HEADER) scopeContext?: string,
    @CustomFieldFilterParams() customFields?: URLSearchParams,
  ) {
    return this.customerList.cappedListCount(query, scopeContext, customFields);
  }

  @Get()
  @ApiOperation({
    summary: 'List customers',
    description: CUSTOM_FIELD_FILTER_DESCRIPTION,
  })
  @ApiHeader({
    name: SCOPE_CONTEXT_HEADER,
    required: false,
    description: 'Required in cursor mode (ADR-0038).',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Free-text search term for customer name, company name, email, or legacy ID',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'type',
    required: false,
    schema: { type: 'string', enum: ['PRIVATE', 'COMPANY'] },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cursor mode only. Default 50, maximum 100.',
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiListOffsetPaginationQueries()
  @ApiListCursorModeQuery()
  @ApiPaginatedResponse(CustomerResponseDto)
  async findAll(
    @CustomFieldListQuery(FindAllCustomersQueryDto)
    query: FindAllCustomersQueryDto,
    @Headers(SCOPE_CONTEXT_HEADER) scopeContext?: string,
    @CustomFieldFilterParams() customFields?: URLSearchParams,
  ) {
    if (query.pagination === 'cursor' || query.cursor) {
      return this.customerList.findAllWithCursor(
        query,
        scopeContext,
        customFields,
      );
    }
    await this.customerList.assertNoOffsetCustomFieldFilters(customFields);
    return findAllCustomersOffset(this.customerService, query);
  }

  @Get(':id/activity')
  @ApiOkResponse({ type: CustomerActivityResponseDto })
  getActivity(
    @Param('id') id: string,
    @Query() query: CustomerActivityQueryDto,
  ) {
    return this.customerActivityService.getActivity(id, query);
  }

  @Get(':id')
  @ApiQuery({
    name: 'historyPage',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'historyLimit',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiOkResponse({ type: CustomerDetailResponseDto })
  findOne(
    @Param('id') id: string,
    @Query('historyPage') historyPage?: string,
    @Query('historyLimit') historyLimit?: string,
  ) {
    const parsedHistoryPage = historyPage ? parseInt(historyPage, 10) : NaN;
    const parsedHistoryLimit = historyLimit ? parseInt(historyLimit, 10) : NaN;

    return this.customerService.findOne(id, {
      historyPage:
        Number.isFinite(parsedHistoryPage) && parsedHistoryPage > 0
          ? parsedHistoryPage
          : undefined,
      historyLimit:
        Number.isFinite(parsedHistoryLimit) && parsedHistoryLimit > 0
          ? parsedHistoryLimit
          : undefined,
    });
  }

  @Patch(':id')
  @ApiOkResponse({ type: CustomerResponseDto })
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customerService.update(id, updateCustomerDto);
  }

  @Get(':id/art15-export')
  art15Export(@Param('id') id: string) {
    return this.customFieldsGdpr.exportCustomerArt15Package(id);
  }

  @Get(':id/art20-export')
  art20Export(@Param('id') id: string) {
    return this.customFieldsGdpr.exportCustomerArt20Package(id);
  }

  @Post(':id/erase')
  erase(@Param('id') id: string) {
    return this.customFieldsGdpr.eraseCustomerPersonalData(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
