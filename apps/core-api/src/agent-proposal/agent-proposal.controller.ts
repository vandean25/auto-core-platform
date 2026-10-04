import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AgentProposalAuthorization } from './agent-proposal.authorization.js';
import { AgentProposalService } from './agent-proposal.service.js';
import {
  AgentProposalListResponseDto,
  AgentProposalResponseDto,
  CreateAgentProposalDto,
  QueryAgentProposalsDto,
  RejectAgentProposalDto,
} from './dto/agent-proposal.dto.js';

@ApiTags('Agent Proposals')
@Controller('agent-proposals')
export class AgentProposalController {
  constructor(
    private readonly agentProposalService: AgentProposalService,
    private readonly authorization: AgentProposalAuthorization,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List agent proposals (OWNER/ADMIN/ADVISOR/SALES)',
    description:
      'Returns agent proposals for the authenticated tenant with lazy expiration handling.',
  })
  @ApiOkResponse({ type: AgentProposalListResponseDto })
  listProposals(
    @Query() query: QueryAgentProposalsDto,
  ): Promise<AgentProposalListResponseDto> {
    this.authorization.assertSupervisor();
    return this.agentProposalService.listProposals(query);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve and execute an agent proposal',
    description:
      'Re-evaluates policy conditions, atomically transitions status to APPROVED, logs the audit event, dispatches the payload, and marks as EXECUTED.',
  })
  @ApiOkResponse({ type: AgentProposalResponseDto })
  approveProposal(@Param('id') id: string): Promise<AgentProposalResponseDto> {
    this.authorization.assertSupervisor();
    return this.agentProposalService.approveProposal(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject an agent proposal',
    description:
      'Transitions proposal to REJECTED with reason and logs the rejection in agent action audit logs.',
  })
  @ApiOkResponse({ type: AgentProposalResponseDto })
  rejectProposal(
    @Param('id') id: string,
    @Body() body?: RejectAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    this.authorization.assertSupervisor();
    return this.agentProposalService.rejectProposal(id, body);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an agent proposal (seeding/testing)',
    description:
      'Creates a new agent proposal for the current tenant in PENDING status.',
  })
  @ApiCreatedResponse({ type: AgentProposalResponseDto })
  createProposal(
    @Body() body: CreateAgentProposalDto,
  ): Promise<AgentProposalResponseDto> {
    this.authorization.assertSupervisor();
    return this.agentProposalService.createProposal(body);
  }
}
