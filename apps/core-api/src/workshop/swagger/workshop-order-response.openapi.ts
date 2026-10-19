import { applyDecorators } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../common/dto/paginated-response.dto.js';
import { WorkshopController } from '../workshop.controller.js';
import { WorkshopOrderResponseDto } from '../dto/workshop-order-response.dto.js';

const orderResponse = applyDecorators(
  ApiOkResponse({ type: WorkshopOrderResponseDto }),
);

const orderCreated = applyDecorators(
  ApiCreatedResponse({ type: WorkshopOrderResponseDto }),
);

const paginatedOrders = applyDecorators(
  ApiPaginatedResponse(WorkshopOrderResponseDto),
);

const orderResponseMethods = new Set([
  'findOne',
  'updateOrder',
  'updateTask',
  'deleteTask',
  'replaceTaskLineItems',
]);

function applyToMethod(
  methodName: string,
  decoratorFactory: typeof orderResponse,
) {
  const descriptor = Object.getOwnPropertyDescriptor(
    WorkshopController.prototype,
    methodName,
  );
  if (!descriptor) {
    return;
  }
  decoratorFactory(WorkshopController.prototype, methodName, descriptor);
}

applyToMethod('create', orderCreated);
applyToMethod('findAll', paginatedOrders);
for (const methodName of orderResponseMethods) {
  applyToMethod(methodName, orderResponse);
}
