import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerDetailResponseDto } from './dto/customer-detail-response.dto';
import { QueryBuilder } from '../common/utils/query-builder';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customerService.create(createCustomerDto);
  }

  @Get()
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'type',
    required: false,
    schema: { type: 'string', enum: ['PRIVATE', 'COMPANY'] },
  })
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
    @Query('search') search?: string,
    @Query('type') type?: 'PRIVATE' | 'COMPANY',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const queryParams: any = {};
    const parsedPage = page ? parseInt(page, 10) : NaN;
    const parsedPageSize = pageSize ? parseInt(pageSize, 10) : NaN;

    if (search) queryParams.search = search;
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
      queryParams.filters = [
        { field: 'type', operator: 'equals', value: type },
      ];
    }

    if (Object.keys(queryParams).length > 0) {
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
      const searchFields = ['first_name', 'last_name', 'company_name', 'email'];
      const prismaQuery = QueryBuilder.buildPrismaQuery(
        queryParams,
        whitelist,
        searchFields,
      );
      const result = (await this.customerService.findAll(prismaQuery)) as any;

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

    return this.customerService.findAll(search);
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
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customerService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
