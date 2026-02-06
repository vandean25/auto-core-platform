import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryBuilder } from '../common/utils/query-builder';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customerService.create(createCustomerDto);
  }

  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('params') params?: string,
  ) {
    if (params) {
      let queryParams;
      try {
        queryParams = JSON.parse(params);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in params query parameter');
      }

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

    // Backward compatibility
    return this.customerService.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
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
