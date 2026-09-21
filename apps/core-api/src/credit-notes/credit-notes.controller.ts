import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { CreditNotesService } from './credit-notes.service.js';
import {
  CreateCreditNoteDto,
  CreditNoteListQueryDto,
  CreditNoteResponseDto,
  FinalizeCreditNoteDto,
  UpdateCreditNoteDto,
  VoidCreditNoteDto,
} from './dto/credit-note.dto.js';

@Controller('credit-notes')
export class CreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Get()
  @ApiPaginatedResponse(CreditNoteResponseDto)
  list(@Query() query: CreditNoteListQueryDto) {
    return this.creditNotesService.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  findOne(@Param('id') id: string) {
    return this.creditNotesService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  updateDraft(@Param('id') id: string, @Body() dto: UpdateCreditNoteDto) {
    return this.creditNotesService.updateDraft(id, dto);
  }

  @Post(':id/finalize')
  @ApiCreatedResponse({ type: CreditNoteResponseDto })
  finalize(@Param('id') id: string, @Body() dto: FinalizeCreditNoteDto) {
    return this.creditNotesService.finalize(id, dto);
  }

  @Post(':id/void')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  void(@Param('id') id: string, @Body() dto: VoidCreditNoteDto) {
    return this.creditNotesService.void(id, dto);
  }
}

@Controller('invoices')
export class InvoiceCreditNotesController {
  constructor(private readonly creditNotesService: CreditNotesService) {}

  @Post(':id/credit-notes')
  @ApiCreatedResponse({ type: CreditNoteResponseDto })
  createFromInvoice(
    @Param('id') invoiceId: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.creditNotesService.createFromInvoice(invoiceId, dto);
  }
}
