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
  BatchApplyAgentProposalsDto,
  BatchApplyAgentProposalsResponseDto,
  AgentProposalListResponseDto,
  AgentProposalResponseDto,
  CreateAgentProposalDto,
  QueryAgentProposalsDto,
  RejectAgentProposalDto,
  SubmitPendingAgentActionDto,
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
    summary: 'List agent proposals (OWNER/ADMIN/ADVISOR)',
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

  @Post(':id/apply')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Apply and execute a pending agent action',
    description:
      'Re-evaluates current policy and atomically applies one pending action.',
  })
  @ApiOkResponse({ type: AgentProposalResponseDto })
  applyProposal(@Param('id') id: string): Promise<AgentProposalResponseDto> {
    this.authorization.assertSupervisor();
    return this.agentProposalService.approveProposal(id);
  }

  @Post('batch-apply')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Apply pending agent actions independently by ID',
    description:
      'Applies each proposal in its own transaction and returns an outcome per ID.',
  })
  @ApiOkResponse({ type: BatchApplyAgentProposalsResponseDto })
  batchApplyProposals(
    @Body() body: BatchApplyAgentProposalsDto,
  ): Promise<BatchApplyAgentProposalsResponseDto> {
    this.authorization.assertSupervisor();
    return this.agentProposalService.batchApplyProposals(body);
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

  @Post('submit')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Simulate and submit a pending agent action',
    description:
      'Builds policy context on the server, simulates the supported action, and stores it in the tenant proposal queue.',
  })
  @ApiCreatedResponse({ type: AgentProposalResponseDto })
  submitPendingAction(
    @Body() body: SubmitPendingAgentActionDto,
  ): Promise<AgentProposalResponseDto> {
    return this.agentProposalService.submitPendingAction(body);
  }
}
