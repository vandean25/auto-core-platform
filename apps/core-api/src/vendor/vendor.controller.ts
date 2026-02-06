import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { VendorService } from './vendor.service';
import { QueryBuilder } from '../common/utils/query-builder';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';

@Controller('vendors')
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post()
  async create(@Body() createVendorDto: CreateVendorDto) {
    return this.vendorService.create(createVendorDto);
  }

  @Get()
  async findAll(@Query('params') params?: string) {
    if (params) {
      let queryParams;
      try {
        queryParams = JSON.parse(params);
      } catch {
        throw new BadRequestException('Invalid params JSON');
      }

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
    return this.vendorService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.vendorService.findOne(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateVendorDto: UpdateVendorDto,
  ) {
    return this.vendorService.update(id, updateVendorDto);
  }
}
