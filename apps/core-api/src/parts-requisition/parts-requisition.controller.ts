import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto';
import { PurchaseOrderResponseDto } from '../purchase/dto/purchase-order-response.dto';
import { CreatePartsRequisitionDto } from './dto/create-parts-requisition.dto';
import { CreatePartsReservationDto } from './dto/create-parts-reservation.dto';
import { CreateRequisitionPurchaseOrderDto } from './dto/create-requisition-purchase-order.dto';
import { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto';
import { PartsReservationResponseDto } from './dto/parts-reservation-response.dto';
import { PartsShortageResponseDto } from './dto/parts-shortage-response.dto';
import { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto';
import { PartsRequisitionService } from './parts-requisition.service';

@Controller()
@ApiTags('parts-requisitions')
export class PartsRequisitionController {
  constructor(private readonly service: PartsRequisitionService) {}

  @Post('parts-reservations')
  @ApiCreatedResponse({ type: PartsReservationResponseDto })
  createReservation(@Body() dto: CreatePartsReservationDto) {
    return this.service.createOnHandReservation(dto);
  }

  @Get('parts-requisitions/shortages')
  @ApiPaginatedResponse(PartsShortageResponseDto)
  getShortages(@Query() query: PartsShortagesQueryDto) {
    return this.service.getShortages(query);
  }

  @Post('parts-requisitions')
  @ApiCreatedResponse({ type: PartsRequisitionResponseDto })
  createRequisitionSheet(@Body() dto: CreatePartsRequisitionDto) {
    return this.service.createRequisitionSheet(dto);
  }

  @Post('parts-requisitions/:id/create-purchase-order')
  @ApiCreatedResponse({ type: PurchaseOrderResponseDto })
  createPurchaseOrder(
    @Param('id') requisitionId: string,
    @Body() dto: CreateRequisitionPurchaseOrderDto,
  ) {
    return this.service.createPurchaseOrderForRequisition(requisitionId, dto);
  }
}
