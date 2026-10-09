import { Global, Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommonModule } from '../common/common.module.js';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { decisionProviderFactory } from './decision-provider.factory.js';
import { DecisionLiveApplyService } from './decision-live-apply.service.js';
import { DecisionShadowService } from './decision-shadow.service.js';
import { DecisionUseCaseHooksService } from './decision-use-case-hooks.service.js';

@Global()
@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AgentPolicyModule,
    AgentProposalModule,
    AgentActionLogModule,
  ],
  providers: [
    decisionProviderFactory,
    DecisionShadowService,
    DecisionUseCaseHooksService,
    DecisionLiveApplyService,
  ],
  exports: [
    DECISION_PROVIDER_TOKEN,
    DecisionShadowService,
    DecisionUseCaseHooksService,
    DecisionLiveApplyService,
  ],
})
export class DecisionModule {}
