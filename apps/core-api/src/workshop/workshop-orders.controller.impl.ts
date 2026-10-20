import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { DryRunSupported } from '../dry-run/dry-run.decorators.js';
import { InvoiceResponseDto } from '../sales/dto/invoice-response.dto.js';
import {
  CreateWorkshopOrderDto,
  FindAllWorkshopOrdersQueryDto,
  UpdateWorkshopOrderDto,
} from './dto/index.js';
import { ApiWorkshopPaginationQueries } from './workshop-controller.http-helpers.js';
import {
  ApiWorkshopOrderCreatedResponse,
  ApiWorkshopOrderOkResponse,
  ApiWorkshopOrderPaginatedResponse,
} from './workshop-orders.openapi-decorators.js';
import { WorkshopOrdersHttpHandlers } from './workshop-orders.http-handlers.js';

export class WorkshopOrdersControllerImpl {
  constructor(protected readonly ordersHandlers: WorkshopOrdersHttpHandlers) {}

  @Post('orders')
  @DryRunSupported()
  @ApiWorkshopOrderCreatedResponse()
  create(@Body() dto: CreateWorkshopOrderDto) {
    return this.ordersHandlers.create(dto);
  }

  @Get('orders')
  @ApiWorkshopPaginationQueries()
  @ApiWorkshopOrderPaginatedResponse()
  findAll(@Query() query: FindAllWorkshopOrdersQueryDto) {
    return this.ordersHandlers.findAll(query);
  }

  @Get('orders/:id')
  @ApiWorkshopOrderOkResponse()
  findOne(@Param('id') id: string) {
    return this.ordersHandlers.findOne(id);
  }

  @Patch('orders/:id')
  @ApiWorkshopOrderOkResponse()
  updateOrder(@Param('id') id: string, @Body() dto: UpdateWorkshopOrderDto) {
    return this.ordersHandlers.updateOrder(id, dto);
  }

  @Post('orders/:id/create-invoice')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoiceFromOrder(@Param('id') id: string) {
    return this.ordersHandlers.createInvoiceFromOrder(id);
  }
}
