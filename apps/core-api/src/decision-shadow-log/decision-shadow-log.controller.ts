import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DecisionShadowLogAuthorization } from './decision-shadow-log.authorization.js';
import { DecisionShadowLogService } from './decision-shadow-log.service.js';
import {
  DecisionShadowLogListResponseDto,
  QueryDecisionShadowLogsDto,
} from './dto/index.js';

@ApiTags('Decision Shadow Logs')
@Controller('decision-shadow-logs')
export class DecisionShadowLogController {
  constructor(
    private readonly decisionShadowLogService: DecisionShadowLogService,
    private readonly authorization: DecisionShadowLogAuthorization,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List decision shadow logs (OWNER/ADMIN/ADVISOR)',
    description:
      'Returns cursor-paginated, read-only Jev/decision-adapter shadow rows for the authenticated tenant. Suggestions are never applied.',
  })
  @ApiOkResponse({ type: DecisionShadowLogListResponseDto })
  findAll(
    @Query() query: QueryDecisionShadowLogsDto,
  ): Promise<DecisionShadowLogListResponseDto> {
    this.authorization.assertSupervisorOrAdmin();
    return this.decisionShadowLogService.findAll(query);
  }
}
