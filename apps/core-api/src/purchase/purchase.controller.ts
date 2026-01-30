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
  async findAll(@Query('status') status?: string) {
    return this.purchaseService.findAll(status);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.purchaseService.findOne(id);
  }
}
