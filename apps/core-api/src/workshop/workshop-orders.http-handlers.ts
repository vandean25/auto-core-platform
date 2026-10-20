import { Injectable } from '@nestjs/common';
import {
  CreateWorkshopOrderDto,
  FindAllWorkshopOrdersQueryDto,
  UpdateWorkshopOrderDto,
} from './dto/index.js';
import * as intake from './workshop-intake.service.js';
import * as invoice from './workshop-invoice.service.js';
import { parsePaginationParams } from './workshop-controller.http-helpers.js';

@Injectable()
export class WorkshopOrdersHttpHandlers {
  constructor(
    private readonly intakeService: intake.WorkshopIntakeService,
    private readonly invoiceService: invoice.WorkshopInvoiceService,
  ) {}

  create(dto: CreateWorkshopOrderDto) {
    return this.intakeService.create(dto);
  }

  findAll(query: FindAllWorkshopOrdersQueryDto) {
    const pagination = parsePaginationParams(query.page, query.pageSize);
    return this.intakeService.findAll({
      search: query.search,
      ...pagination,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      customerId: query.customerId,
    });
  }

  findOne(id: string) {
    return this.intakeService.findOne(id);
  }

  updateOrder(id: string, dto: UpdateWorkshopOrderDto) {
    return this.intakeService.updateOrder(id, dto);
  }

  createInvoiceFromOrder(id: string) {
    return this.invoiceService.createInvoiceFromOrder(id);
  }
}
