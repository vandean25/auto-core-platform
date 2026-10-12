import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { AccountingExportReadinessService } from './accounting-export-readiness.service.js';
import {
  AccountingExportReadinessQueryDto,
  AccountingExportReadinessResponseDto,
} from './dto/accounting-export-readiness.dto.js';

@Controller('finance/accounting-export-readiness')
export class AccountingExportReadinessController {
  constructor(
    private readonly accountingExportReadinessService: AccountingExportReadinessService,
  ) {}

  @Get()
  @ApiOkResponse({ type: AccountingExportReadinessResponseDto })
  readiness(@Query() query: AccountingExportReadinessQueryDto) {
    return this.accountingExportReadinessService.getReadiness(query);
  }
}
