import { Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { CommonModule } from '../common/common.module.js';
import { DryRunModule } from '../dry-run/dry-run.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PendingActionExecutorModule } from '../pending-action-executor/pending-action-executor.module.js';
import { AgentProposalAuthorization } from './agent-proposal.authorization.js';
import { AgentProposalController } from './agent-proposal.controller.js';
import { AgentProposalService } from './agent-proposal.service.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    DryRunModule,
    PendingActionExecutorModule,
    AgentPolicyModule,
    AgentActionLogModule,
  ],
  controllers: [AgentProposalController],
  providers: [AgentProposalService, AgentProposalAuthorization],
  exports: [AgentProposalService],
})
export class AgentProposalModule {}
