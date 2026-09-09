import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  Get,
  Query,
  HttpCode,
  Patch,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-items.dto';
import { AddPurchaseOrderItemsDto } from './dto/add-purchase-order-items.dto';
import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';
import {
  PurchaseOrderPaginatedResponseDto,
  PurchaseOrderResponseDto,
  PurchaseOrderItemResponseDto,
} from './dto/purchase-order-response.dto';
import { PurchaseOrderQueryBuilder } from './purchase-order-query.builder';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto';

@Controller('purchase-orders')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  @ApiCreatedResponse({ type: PurchaseOrderResponseDto })
  createPurchaseOrder(@Body() createPurchaseOrderDto: CreatePurchaseOrderDto) {
    return this.purchaseService.createPurchaseOrder(
      createPurchaseOrderDto.vendorId,
      createPurchaseOrderDto.items,
    );
  }

  @Post(':id/receive')
  @HttpCode(201)
  @ApiCreatedResponse({ type: PurchaseOrderResponseDto })
  receiveItems(
    @Param('id') orderId: string,
    @Body() receivePurchaseOrderDto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseService.receiveItems(
      orderId,
      receivePurchaseOrderDto.items,
    );
  }

  @Post(':id/mark-as-sent')
  @HttpCode(200)
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  markAsSent(@Param('id') id: string) {
    return this.purchaseService.markAsSent(id);
  }

  @Get()
  @ApiPaginatedResponse(PurchaseOrderResponseDto)
  async findAll(
    @Query() query: FindPurchaseOrdersQueryDto,
  ): Promise<PurchaseOrderPaginatedResponseDto> {
    if (PurchaseOrderQueryBuilder.usesAdvancedQuery(query)) {
      const prismaQuery = PurchaseOrderQueryBuilder.toPrismaQuery(query);
      const result = await this.purchaseService.findAll(prismaQuery);
      return PurchaseOrderQueryBuilder.toPaginatedResponse(result, query);
    }

    const result = await this.purchaseService.findAll(
      PurchaseOrderQueryBuilder.toLegacyStatus(query),
    );
    return PurchaseOrderQueryBuilder.toLegacyPaginatedResponse(result);
  }

  @Get(':id')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  findOne(@Param('id') id: string) {
    return this.purchaseService.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.purchaseService.remove(id);
  }

  @Get(':id/items')
  @ApiOkResponse({ type: [PurchaseOrderItemResponseDto] })
  getPurchaseOrderItems(@Param('id') id: string) {
    return this.purchaseService.getPurchaseOrderItems(id);
  }

  @Get(':id/items/:itemId')
  @ApiOkResponse({ type: PurchaseOrderItemResponseDto })
  getPurchaseOrderItem(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.purchaseService.getPurchaseOrderItem(orderId, itemId);
  }

  @Post(':id/items')
  @ApiCreatedResponse({ type: PurchaseOrderResponseDto })
  addItems(
    @Param('id') orderId: string,
    @Body() dto: AddPurchaseOrderItemsDto,
  ) {
    return this.purchaseService.addItemsToPurchaseOrder(orderId, dto.items);
  }

  @Patch(':id/items/:itemId')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  updateItem(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePurchaseOrderItemDto,
  ) {
    return this.purchaseService.updatePurchaseOrderItem(orderId, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  deleteItem(@Param('id') orderId: string, @Param('itemId') itemId: string) {
    return this.purchaseService.deleteItemFromPurchaseOrder(orderId, itemId);
  }
}
