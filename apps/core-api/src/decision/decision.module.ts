import { Global, Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommonModule } from '../common/common.module.js';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { decisionProviderFactory } from './decision-provider.factory.js';
import { DecisionAuditRecorder } from './decision-audit-recorder.service.js';
import { DecisionCustomerImportApplier } from './decision-customer-import-apply.service.js';
import { DecisionDocumentSortApplier } from './decision-document-sort-apply.service.js';
import { DecisionLiveApplyService } from './decision-live-apply.service.js';
import { DecisionModeResolver } from './decision-mode-resolver.service.js';
import { DecisionProviderClient } from './decision-provider-client.service.js';
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
    DecisionModeResolver,
    DecisionProviderClient,
    DecisionAuditRecorder,
    DecisionCustomerImportApplier,
    DecisionDocumentSortApplier,
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
