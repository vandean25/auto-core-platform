import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto';
import { CreatePartsReservationDto } from './dto/create-parts-reservation.dto';
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
}
