import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentActionLogAuthorization } from './agent-action-log.authorization.js';
import { AgentActionLogService } from './agent-action-log.service.js';
import {
  AgentActionLogListResponseDto,
  AgentActionTraceDetailResponseDto,
  QueryAgentActionsDto,
} from './dto/index.js';

@ApiTags('Agent Actions')
@Controller('agent-actions')
export class AgentActionLogController {
  constructor(
    private readonly agentActionLogService: AgentActionLogService,
    private readonly authorization: AgentActionLogAuthorization,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List agent action logs (OWNER/ADMIN/ADVISOR)',
    description:
      'Returns cursor-paginated agent action log rows for the authenticated tenant.',
  })
  @ApiOkResponse({ type: AgentActionLogListResponseDto })
  findAll(
    @Query() query: QueryAgentActionsDto,
  ): Promise<AgentActionLogListResponseDto> {
    this.authorization.assertSupervisorOrAdmin();
    return this.agentActionLogService.findAll(query);
  }

  @Get(':traceId')
  @ApiOperation({
    summary: 'Get agent action trace detail (OWNER/ADMIN/ADVISOR)',
    description:
      'Returns all log rows for a trace ID plus audit entries correlated on the same trace.',
  })
  @ApiOkResponse({ type: AgentActionTraceDetailResponseDto })
  findByTraceId(
    @Param('traceId') traceId: string,
  ): Promise<AgentActionTraceDetailResponseDto> {
    this.authorization.assertSupervisorOrAdmin();
    return this.agentActionLogService.findByTraceId(traceId);
  }
}
