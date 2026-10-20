import { applyDecorators } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { WorkshopOrderResponseDto } from './dto/workshop-response.dto.js';
import { WORKSHOP_ERROR_RESPONSE_SCHEMA } from './workshop-controller.http-helpers.js';

export function ApiWorkshopOrderCreatedResponse() {
  return applyDecorators(ApiCreatedResponse({ type: WorkshopOrderResponseDto }));
}

export function ApiWorkshopOrderOkResponse() {
  return applyDecorators(ApiOkResponse({ type: WorkshopOrderResponseDto }));
}

export function ApiWorkshopOrderPaginatedResponse() {
  return applyDecorators(ApiPaginatedResponse(WorkshopOrderResponseDto));
}

export function ApiWorkshopDeleteTaskResponses() {
  return applyDecorators(
    ApiOkResponse({ type: WorkshopOrderResponseDto }),
    ApiResponse({
      status: 200,
      description: 'Workshop task deleted successfully.',
    }),
    ApiResponse({
      status: 400,
      description:
        'Task cannot be deleted because the order is invoiced or already has a linked invoice.',
      schema: WORKSHOP_ERROR_RESPONSE_SCHEMA,
    }),
    ApiResponse({
      status: 404,
      description: 'Workshop task or order was not found.',
      schema: WORKSHOP_ERROR_RESPONSE_SCHEMA,
    }),
  );
}

export function ApiWorkshopOrderPdfDownload() {
  return applyDecorators(
    ApiProduces('application/pdf'),
    ApiOkResponse({
      description: 'Workshop PDF',
      schema: {
        type: 'string',
        format: 'binary',
      },
    }),
  );
}
