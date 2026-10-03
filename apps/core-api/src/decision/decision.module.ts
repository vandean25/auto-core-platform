import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommonModule } from '../common/common.module.js';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { decisionProviderFactory } from './decision-provider.factory.js';
import { DecisionShadowService } from './decision-shadow.service.js';
import { DecisionUseCaseHooksService } from './decision-use-case-hooks.service.js';

@Global()
@Module({
  imports: [PrismaModule, CommonModule],
  providers: [
    decisionProviderFactory,
    DecisionShadowService,
    DecisionUseCaseHooksService,
  ],
  exports: [
    DECISION_PROVIDER_TOKEN,
    DecisionShadowService,
    DecisionUseCaseHooksService,
  ],
})
export class DecisionModule {}
