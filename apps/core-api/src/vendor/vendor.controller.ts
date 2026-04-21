import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { VendorService } from './vendor.service';
import { QueryBuilder, type QueryParams } from '../common/utils/query-builder';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { VendorResponseDto } from './dto/vendor-response.dto';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto';

@Controller('vendors')
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post()
  @ApiCreatedResponse({ type: VendorResponseDto })
  async create(@Body() createVendorDto: CreateVendorDto) {
    return this.vendorService.create(createVendorDto);
  }

  @Get()
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
  @ApiPaginatedResponse(VendorResponseDto)
  async findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const queryParams: QueryParams = {};
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

    if (Object.keys(queryParams).length > 0) {
      const whitelist = ['name', 'email', 'account_number', 'createdAt'];
      const searchFields = ['name', 'email', 'account_number'];
      const prismaQuery = QueryBuilder.buildPrismaQuery(
        queryParams,
        whitelist,
        searchFields,
      );
      const result = await this.vendorService.findAll(prismaQuery);
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

    const result = await this.vendorService.findAll();
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

  @Get(':id')
  @ApiOkResponse({ type: VendorResponseDto })
  async findOne(@Param('id') id: string) {
    return this.vendorService.findOne(id);
  }

  @Put(':id')
  @ApiOkResponse({ type: VendorResponseDto })
  async update(
    @Param('id') id: string,
    @Body() updateVendorDto: UpdateVendorDto,
  ) {
    return this.vendorService.update(id, updateVendorDto);
  }

  @Delete(':id')
  @ApiResponse({ status: 204, description: 'Vendor deleted successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Vendor cannot be deleted because linked records exist.',
  })
  @ApiResponse({ status: 404, description: 'Vendor not found.' })
  async remove(@Param('id') id: string) {
    return this.vendorService.remove(id);
  }
}
