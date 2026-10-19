import { Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { CommonModule } from '../common/common.module.js';
import { DryRunModule } from '../dry-run/dry-run.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PendingActionExecutorModule } from '../pending-action-executor/pending-action-executor.module.js';
import { MechanicMcpModule } from '../mechanic/mechanic-mcp.module.js';
import { AgentProposalAuthorization } from './agent-proposal.authorization.js';
import { AgentProposalController } from './agent-proposal.controller.js';
import { AgentProposalService } from './agent-proposal.service.js';
import { AgentProposalDecisionService } from './agent-proposal-decision.service.js';
import { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';
import { AgentProposalReadService } from './agent-proposal-read.service.js';
import { AgentProposalSubmissionService } from './agent-proposal-submission.service.js';
import { AgentProposalSubmitPayloadNormalizer } from './agent-proposal-submit-payload-normalizer.service.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    DryRunModule,
    PendingActionExecutorModule,
    AgentPolicyModule,
    AgentActionLogModule,
    WorkshopModule,
    InvoicesModule,
    MechanicMcpModule,
  ],
  controllers: [AgentProposalController],
  providers: [
    AgentProposalService,
    AgentProposalAuthorization,
    AgentProposalReadService,
    AgentProposalDecisionService,
    AgentProposalSubmissionService,
    AgentProposalSubmitPayloadNormalizer,
    AgentProposalPolicyEvaluator,
  ],
  exports: [
    AgentProposalService,
    AgentProposalReadService,
    AgentProposalAuthorization,
  ],
})
export class AgentProposalModule {}
