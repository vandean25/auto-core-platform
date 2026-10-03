import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentPolicyService } from './agent-policy.service.js';
import {
  AgentPolicyEvaluateRequestDto,
  AgentPolicyEvaluationResponseDto,
  AgentPolicyRuleListResponseDto,
  AgentPolicyRuleResponseDto,
  UpsertAgentPolicyRuleDto,
} from './dto/agent-policy.dto.js';

@ApiTags('agent-policy')
@Controller('agent-policy')
export class AgentPolicyController {
  constructor(private readonly agentPolicyService: AgentPolicyService) {}

  @Get('rules')
  @ApiOperation({ summary: 'List effective agent policy rules (OWNER/ADMIN)' })
  @ApiOkResponse({ type: AgentPolicyRuleListResponseDto })
  listRules(): Promise<AgentPolicyRuleListResponseDto> {
    return this.agentPolicyService.listRules();
  }

  @Put('rules/:actionType')
  @ApiOperation({
    summary: 'Create a new tenant policy rule version (OWNER/ADMIN)',
  })
  @ApiOkResponse({ type: AgentPolicyRuleResponseDto })
  upsertRule(
    @Param('actionType') actionType: string,
    @Body() body: UpsertAgentPolicyRuleDto,
  ): Promise<AgentPolicyRuleResponseDto> {
    return this.agentPolicyService.upsertRule(actionType, body);
  }

  @Post('evaluate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Evaluate policy tier for an action (OWNER/ADMIN, dry-run)',
  })
  @ApiOkResponse({ type: AgentPolicyEvaluationResponseDto })
  evaluate(
    @Body() body: AgentPolicyEvaluateRequestDto,
  ): Promise<AgentPolicyEvaluationResponseDto> {
    return this.agentPolicyService.evaluate(body);
  }
}
