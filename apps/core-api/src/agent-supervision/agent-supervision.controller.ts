import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentProposalAuthorization } from '../agent-proposal/agent-proposal.authorization.js';
import { AgentSupervisionTriageService } from './agent-supervision-triage.service.js';
import {
  AgentSupervisionTriageListResponseDto,
  QueryAgentSupervisionTriageDto,
} from './dto/agent-supervision-triage.dto.js';

@ApiTags('Agent Supervision')
@Controller('agent-supervision')
export class AgentSupervisionController {
  constructor(
    private readonly triageService: AgentSupervisionTriageService,
    private readonly authorization: AgentProposalAuthorization,
  ) {}

  @Get('triage')
  @ApiOperation({
    summary: 'Deterministic read-only supervision triage inbox',
    description:
      'Merges pending agent proposals, customer-waiting workshop work, and overdue loaners for authorized sites.',
  })
  @ApiOkResponse({ type: AgentSupervisionTriageListResponseDto })
  listTriage(
    @Query() query: QueryAgentSupervisionTriageDto,
  ): Promise<AgentSupervisionTriageListResponseDto> {
    this.authorization.assertSupervisor();
    return this.triageService.listTriage(query);
  }
}
