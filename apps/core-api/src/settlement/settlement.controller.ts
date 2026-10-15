import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { SettlementService } from './settlement.service.js';
import {
  CancelFiscalReceiptDto,
  RecordSettlementDto,
  ReconcileSettlementDto,
} from './dto/record-settlement.dto.js';

@Controller('invoices')
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get(':id/settlement')
  @ApiOperation({ summary: 'Get settlement state for an invoice (OWNER/ADMIN)' })
  @ApiOkResponse({ description: 'Settlement summary' })
  getSettlement(@Param('id') id: string) {
    return this.settlementService.getSettlement(id);
  }

  @Post(':id/settlement')
  @ApiOperation({ summary: 'Record full settlement for an issued invoice (OWNER/ADMIN)' })
  @ApiOkResponse({ description: 'Settlement result' })
  recordSettlement(@Param('id') id: string, @Body() dto: RecordSettlementDto) {
    return this.settlementService.recordSettlement(id, dto);
  }

  @Post(':id/settlement/reconcile')
  @ApiOperation({ summary: 'Reconcile PENDING/UNKNOWN fiscal receipt (OWNER/ADMIN)' })
  @ApiOkResponse({ description: 'Settlement after reconcile' })
  reconcileSettlement(
    @Param('id') id: string,
    @Body() dto: ReconcileSettlementDto,
  ) {
    return this.settlementService.reconcileSettlement(id, dto);
  }
}

@Controller('fiscal-receipts')
export class FiscalReceiptsController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post(':id/cancellation')
  @ApiOperation({ summary: 'Sign fiscal cancellation receipt (OWNER/ADMIN)' })
  @ApiOkResponse({ description: 'Settlement after cancellation' })
  cancelFiscalReceipt(
    @Param('id') id: string,
    @Body() dto: CancelFiscalReceiptDto,
  ) {
    return this.settlementService.cancelFiscalReceipt(id, dto);
  }
}
