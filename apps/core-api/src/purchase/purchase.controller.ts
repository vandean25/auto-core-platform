import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  Get,
  BadRequestException,
  Query,
  HttpCode,
  Patch,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { PurchaseService } from './purchase.service';
import { QueryBuilder, type QueryParams } from '../common/utils/query-builder';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-items.dto';
import { AddPurchaseOrderItemsDto } from './dto/add-purchase-order-items.dto';
import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import type { Prisma } from '@prisma/client';

@Controller('purchase-orders')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  async createPurchaseOrder(
    @Body() createPurchaseOrderDto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseService.createPurchaseOrder(
      createPurchaseOrderDto.vendorId,
      createPurchaseOrderDto.items,
    );
  }

  @Post(':id/receive')
  @HttpCode(201)
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  async receiveItems(
    @Param('id') orderId: string,
    @Body() receivePurchaseOrderDto: ReceivePurchaseOrderDto,
  ) {
    const result = await this.purchaseService.receiveItems(
      orderId,
      receivePurchaseOrderDto.items,
    );
    if (!result) {
      throw new BadRequestException('Receipt failed to return data');
    }
    return result;
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
  @ApiQuery({
    name: 'search',
    required: false,
    schema: {
      type: 'string',
    },
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
  @ApiQuery({
    name: 'sortField',
    required: false,
    schema: {
      type: 'string',
    },
  })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  })
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  async findAll(
    @Query('status') status?: string,
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
      const prismaQuery: Prisma.PurchaseOrderFindManyArgs =
        QueryBuilder.buildPrismaQuery(queryParams, whitelist, searchFields);
      const result = await this.purchaseService.findAll(prismaQuery);
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

    const result = await this.purchaseService.findAll(status);
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
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  async findOne(@Param('id') id: string) {
    return this.purchaseService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  async updatePurchaseOrder(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseService.updatePurchaseOrder(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.purchaseService.remove(id);
  }

  @Post(':id/items')
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  async addItems(
    @Param('id') orderId: string,
    @Body() dto: AddPurchaseOrderItemsDto,
  ) {
    return this.purchaseService.addItemsToPurchaseOrder(orderId, dto.items);
  }

  @Patch(':id/items/:itemId')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  async updateItem(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePurchaseOrderItemDto,
  ) {
    return this.purchaseService.updatePurchaseOrderItem(orderId, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  async deleteItem(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.purchaseService.deleteItemFromPurchaseOrder(orderId, itemId);
  }
}
