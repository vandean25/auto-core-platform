import * as express from 'express';
import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  Get,
  Res,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { PurchaseService } from './purchase.service';
import { QueryBuilder } from '../common/utils/query-builder';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-items.dto';

@Controller('purchase-orders')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  async createPurchaseOrder(
    @Body() createPurchaseOrderDto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseService.createPurchaseOrder(
      createPurchaseOrderDto.vendorId,
      createPurchaseOrderDto.items,
    );
  }

  @Post(':id/receive')
  async receiveItems(
    @Param('id') orderId: string,
    @Body() receivePurchaseOrderDto: ReceivePurchaseOrderDto,
    @Res() res: express.Response,
  ) {
    const result = await this.purchaseService.receiveItems(
      orderId,
      receivePurchaseOrderDto.items,
    );
    if (!result) {
      throw new BadRequestException('Receipt failed to return data');
    }
    return res.status(201).json(result);
  }

  @Get()
  @ApiQuery({
    name: 'status',
    required: false,
    schema: {
      type: 'string',
      enum: ['DRAFT', 'SENT', 'PARTIAL', 'COMPLETED', 'open', 'all'],
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
    @Query('status') status?: string,
    @Query('search') search?: string,
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
    if (status && status !== 'open' && status !== 'all') {
      queryParams.filters = [
        { field: 'status', operator: 'equals', value: status },
      ];
    }

    if (Object.keys(queryParams).length > 0) {
      const whitelist = [
        'order_number',
        'status',
        'vendor.name',
        'total_amount',
        'createdAt',
        'created_at',
        'expected_date',
      ];
      const searchFields = ['order_number', 'vendor.name'];
      const prismaQuery = QueryBuilder.buildPrismaQuery(
        queryParams,
        whitelist,
        searchFields,
      );
      const result = (await this.purchaseService.findAll(prismaQuery)) as any;
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

    return this.purchaseService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.purchaseService.findOne(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.purchaseService.remove(id);
  }
}
