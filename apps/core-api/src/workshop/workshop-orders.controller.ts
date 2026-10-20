import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkshopOrdersControllerImpl } from './workshop-orders.controller.impl.js';
import { WorkshopOrdersHttpHandlers } from './workshop-orders.http-handlers.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrdersController extends WorkshopOrdersControllerImpl {
  constructor(ordersHandlers: WorkshopOrdersHttpHandlers) {
    super(ordersHandlers);
  }
}
