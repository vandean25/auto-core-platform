import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { CustomerNotesService } from './customer-notes.service.js';
import {
  CreateCustomerNoteDto,
  CustomerNoteListResponseDto,
  CustomerNoteResponseDto,
  PinCustomerNoteDto,
  UpdateCustomerNoteDto,
} from './dto/customer-note.dto.js';

@Controller('customers/:customerId/notes')
export class CustomerNotesController {
  constructor(private readonly customerNotesService: CustomerNotesService) {}

  @Get()
  @ApiOkResponse({ type: CustomerNoteListResponseDto })
  list(@Param('customerId') customerId: string) {
    return this.customerNotesService.list(customerId);
  }

  @Post()
  @ApiCreatedResponse({ type: CustomerNoteResponseDto })
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerNoteDto,
  ) {
    return this.customerNotesService.create(customerId, dto);
  }

  @Patch(':noteId')
  @ApiOkResponse({ type: CustomerNoteResponseDto })
  update(
    @Param('customerId') customerId: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateCustomerNoteDto,
  ) {
    return this.customerNotesService.update(customerId, noteId, dto);
  }

  @Patch(':noteId/pin')
  @ApiOkResponse({ type: CustomerNoteResponseDto })
  setPinned(
    @Param('customerId') customerId: string,
    @Param('noteId') noteId: string,
    @Body() dto: PinCustomerNoteDto,
  ) {
    return this.customerNotesService.setPinned(customerId, noteId, dto.pinned);
  }

  @Delete(':noteId')
  remove(
    @Param('customerId') customerId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.customerNotesService.remove(customerId, noteId);
  }
}
