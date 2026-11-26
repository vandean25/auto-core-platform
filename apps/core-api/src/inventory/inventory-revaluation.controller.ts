import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import {
  RevaluationReportDto,
  RevalueUnvaluedAdjustmentsDto,
} from './dto/revalue-unvalued-adjustments.dto.js';
import { RevalueUnvaluedAdjustmentsService } from './revalue-unvalued-adjustments.service.js';

@Controller('inventory/revalue-unvalued-adjustments')
export class InventoryRevaluationController {
  constructor(
    private readonly revaluation: RevalueUnvaluedAdjustmentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revalue legacy unvalued stock corrections via Gegenbuchung (nachbewertet). QA only; production needs explicit approval.',
  })
  @ApiOkResponse({ type: RevaluationReportDto })
  async revalueUnvaluedAdjustments(
    @Body() dto: RevalueUnvaluedAdjustmentsDto,
  ): Promise<RevaluationReportDto> {
    return await this.revaluation.run(dto.dryRun);
  }
}
