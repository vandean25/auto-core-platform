import {
  Body,
  Controller,
  Get,
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
import {
  ApiWorkshopPaginationQueries,
  parsePaginationParams,
} from './workshop-controller.http-helpers.js';
import * as intake from './workshop-intake.service.js';
import * as invoice from './workshop-invoice.service.js';
import {
  ApiWorkshopOrderCreatedResponse,
  ApiWorkshopOrderOkResponse,
  ApiWorkshopOrderPaginatedResponse,
} from './workshop-orders.openapi-decorators.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrdersController {
  constructor(
    private readonly intakeService: intake.WorkshopIntakeService,
    private readonly invoiceService: invoice.WorkshopInvoiceService,
  ) {}

  @Post('orders')
  @DryRunSupported()
  @ApiWorkshopOrderCreatedResponse()
  create(@Body() dto: CreateWorkshopOrderDto) {
    return this.intakeService.create(dto);
  }

  @Get('orders')
  @ApiWorkshopPaginationQueries()
  @ApiWorkshopOrderPaginatedResponse()
  findAll(@Query() query: FindAllWorkshopOrdersQueryDto) {
    const pagination = parsePaginationParams(query.page, query.pageSize);
    return this.intakeService.findAll({
      search: query.search,
      ...pagination,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      customerId: query.customerId,
    });
  }

  @Get('orders/:id')
  @ApiWorkshopOrderOkResponse()
  findOne(@Param('id') id: string) {
    return this.intakeService.findOne(id);
  }

  @Patch('orders/:id')
  @ApiWorkshopOrderOkResponse()
  updateOrder(@Param('id') id: string, @Body() dto: UpdateWorkshopOrderDto) {
    return this.intakeService.updateOrder(id, dto);
  }

  @Post('orders/:id/create-invoice')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoiceFromOrder(@Param('id') id: string) {
    return this.invoiceService.createInvoiceFromOrder(id);
  }
}
