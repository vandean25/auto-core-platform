import * as express from 'express';
import {
  Controller,
  Post,
  Body,
  Param,
  Get,
  Res,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { QueryBuilder } from '../common/utils/query-builder';

@Controller('purchase-orders')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  async createPurchaseOrder(
    @Body()
    body: {
      vendorId: string;
      items: { catalogItemId: string; quantity: number; unitCost: number }[];
    },
  ) {
    return this.purchaseService.createPurchaseOrder(body.vendorId, body.items);
  }

  @Post(':id/receive')
  async receiveItems(
    @Param('id') orderId: string,
    @Body() body: { items: { itemId: string; quantity: number }[] },
    @Res() res: express.Response,
  ) {
    const result = await this.purchaseService.receiveItems(orderId, body.items);
    if (!result) {
      throw new BadRequestException('Receipt failed to return data');
    }
    return res.status(201).json(result);
  }

  @Get()
  async findAll(@Query('status') status?: string, @Query('params') params?: string) {
    if (params) {
        let queryParams;
        try {
            queryParams = JSON.parse(params);
        } catch {
            throw new BadRequestException('Invalid params JSON');
        }

        const whitelist = ['order_number', 'status', 'vendor.name', 'total_amount', 'createdAt', 'created_at', 'expected_date'];
        const searchFields = ['order_number', 'vendor.name'];
        const prismaQuery = QueryBuilder.buildPrismaQuery(queryParams, whitelist, searchFields);
        
        const result = await this.purchaseService.findAll(prismaQuery) as any;
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
    return this.purchaseService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.purchaseService.findOne(id);
  }
}
