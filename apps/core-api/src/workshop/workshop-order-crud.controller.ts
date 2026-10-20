import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
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

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrdersController {
  private readonly logger = new Logger(WorkshopOrdersController.name);

  constructor(private readonly ordersHandlers: WorkshopOrdersHttpHandlers) {}

  private logAction(action: string) {
    this.logger.debug(action);
  }

  @Post('orders')
  @DryRunSupported()
  @ApiWorkshopOrderCreatedResponse()
  create(@Body() dto: CreateWorkshopOrderDto) {
    this.logAction('create');
    return this.ordersHandlers.create(dto);
  }

  @Get('orders')
  @ApiWorkshopPaginationQueries()
  @ApiWorkshopOrderPaginatedResponse()
  findAll(@Query() query: FindAllWorkshopOrdersQueryDto) {
    this.logAction('findAll');
    return this.ordersHandlers.findAll(query);
  }

  @Get('orders/:id')
  @ApiWorkshopOrderOkResponse()
  findOne(@Param('id') id: string) {
    this.logAction('findOne');
    return this.ordersHandlers.findOne(id);
  }

  @Patch('orders/:id')
  @ApiWorkshopOrderOkResponse()
  updateOrder(@Param('id') id: string, @Body() dto: UpdateWorkshopOrderDto) {
    this.logAction('updateOrder');
    return this.ordersHandlers.updateOrder(id, dto);
  }

  @Post('orders/:id/create-invoice')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoiceFromOrder(@Param('id') id: string) {
    this.logAction('createInvoiceFromOrder');
    return this.ordersHandlers.createInvoiceFromOrder(id);
  }
}
