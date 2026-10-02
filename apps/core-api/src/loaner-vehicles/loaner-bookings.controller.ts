import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import {
  CreateLoanerBookingDto,
  HandOverLoanerBookingDto,
  LoanerBookingListResponseDto,
  LoanerBookingResponseDto,
  LoanerOverdueQueryDto,
  ReturnLoanerBookingDto,
  UpdateLoanerBookingDto,
} from './dto/loaner-booking.dto.js';
import { LoanerVehiclesService } from './loaner-vehicles.service.js';

@ApiTags('Workshop')
@Controller('workshop/loaner-bookings')
export class LoanerBookingsController {
  constructor(private readonly loanerService: LoanerVehiclesService) {}

  @Get()
  @MechanicAccessible()
  @ApiOkResponse({ type: LoanerBookingListResponseDto })
  list() {
    return this.loanerService.listBookings();
  }

  @Get('overdue')
  @MechanicAccessible()
  @ApiOkResponse({ type: LoanerBookingListResponseDto })
  overdue(@Query() query: LoanerOverdueQueryDto) {
    return this.loanerService.listOverdue(query.asOf);
  }

  @Get(':id')
  @MechanicAccessible()
  @ApiOkResponse({ type: LoanerBookingResponseDto })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanerService.getBooking(id);
  }

  @Post()
  @ApiCreatedResponse({ type: LoanerBookingResponseDto })
  @ApiConflictResponse({ description: 'Overlapping active booking' })
  create(@Body() dto: CreateLoanerBookingDto) {
    return this.loanerService.createBooking(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: LoanerBookingResponseDto })
  @ApiConflictResponse({ description: 'Overlapping active booking' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoanerBookingDto,
  ) {
    return this.loanerService.updateBooking(id, dto);
  }

  @Post(':id/cancel')
  @ApiOkResponse({ type: LoanerBookingResponseDto })
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanerService.cancelBooking(id);
  }

  @Post(':id/hand-over')
  @ApiOkResponse({ type: LoanerBookingResponseDto })
  handOver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HandOverLoanerBookingDto,
  ) {
    return this.loanerService.handOverBooking(id, dto);
  }

  @Post(':id/return')
  @ApiOkResponse({ type: LoanerBookingResponseDto })
  returnBooking(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnLoanerBookingDto,
  ) {
    return this.loanerService.returnBooking(id, dto);
  }
}
