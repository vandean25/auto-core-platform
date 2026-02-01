import { Controller, Get, Post, Body, Patch, Param, Query, Delete, BadRequestException } from '@nestjs/common';
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
  async findAll(@Query('status') status?: SalesOrderStatus, @Query('params') params?: string) {
    if (params) {
        let queryParams;
        try {
            queryParams = JSON.parse(params);
        } catch (error) {
            throw new BadRequestException('Invalid JSON in params query parameter');
        }

        const whitelist = ['status', 'order_number', 'total_amount', 'createdAt', 'customer.last_name', 'customer.company_name'];
        const searchFields = ['order_number', 'customer.last_name', 'customer.company_name'];
        
        const prismaQuery = QueryBuilder.buildPrismaQuery(queryParams, whitelist, searchFields);
        const result = await this.salesOrderService.findAll(prismaQuery) as any;
        
        return {
            data: result.data,
            meta: {
                total: result.total,
                page: queryParams.page ?? 1,
                pageSize: queryParams.pageSize ?? 25,
                pageCount: Math.ceil(result.total / (queryParams.pageSize ?? 25)),
            }
        };
    }

    return this.salesOrderService.findAll(status);
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
