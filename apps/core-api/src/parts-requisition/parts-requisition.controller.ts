import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { PurchaseOrderResponseDto } from '../purchase/dto/purchase-order-response.dto.js';
import { CreatePartsRequisitionDto } from './dto/create-parts-requisition.dto.js';
import { CreatePartsReservationDto } from './dto/create-parts-reservation.dto.js';
import { CreateRequisitionPurchaseOrderDto } from './dto/create-requisition-purchase-order.dto.js';
import { ConsumePartsReservationDto } from './dto/consume-parts-reservation.dto.js';
import { ReleasePartsReservationDto } from './dto/release-parts-reservation.dto.js';
import { PartsRequisitionResponseDto } from './dto/parts-requisition-response.dto.js';
import { PartsReservationResponseDto } from './dto/parts-reservation-response.dto.js';
import { PartsShortageResponseDto } from './dto/parts-shortage-response.dto.js';
import { PartsShortagesQueryDto } from './dto/parts-shortages-query.dto.js';
import { PartsRequisitionService } from './parts-requisition.service.js';

@Controller()
@ApiTags('parts-requisitions')
export class PartsRequisitionController {
  constructor(private readonly service: PartsRequisitionService) {}

  @Post('parts-reservations')
  @ApiCreatedResponse({ type: PartsReservationResponseDto })
  createReservation(@Body() dto: CreatePartsReservationDto) {
    return this.service.createOnHandReservation(dto);
  }

  @Post('parts-reservations/:id/consume')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PartsReservationResponseDto })
  consumeReservation(
    @Param('id') reservationId: string,
    @Body() dto: ConsumePartsReservationDto,
  ) {
    return this.service.consumeReservation(reservationId, dto);
  }

  @Post('parts-reservations/:id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PartsReservationResponseDto })
  releaseReservation(
    @Param('id') reservationId: string,
    @Body() dto: ReleasePartsReservationDto,
  ) {
    return this.service.releaseReservation(reservationId, dto);
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
