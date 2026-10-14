import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DECISION_TENANT_OPT_OUT_MODE,
  type DecisionApplyMode,
} from './decision.constants.js';
import { resolveEnvDecisionApplyMode } from './decision-env.js';
import { DECISION_LIVE_LOG_CONTEXT } from './decision-live-apply.constants.js';
import { errorName } from './decision-live-apply.helpers.js';

/**
 * Environment first, so a shadow deployment never reads the tenant row. A
 * tenant can only opt out (`shadow`); it can never turn live on.
 */
@Injectable()
export class DecisionModeResolver {
  private readonly logger = new Logger(DECISION_LIVE_LOG_CONTEXT);
  private productionGateWarned = false;

  constructor(private readonly prisma: PrismaService) {}

  async resolveEffectiveMode(tenantId: string): Promise<DecisionApplyMode> {
    const environment = resolveEnvDecisionApplyMode();
    this.warnProductionGateOnce(environment.blockedByProductionGate);
    if (environment.mode !== 'live') {
      return 'shadow';
    }
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { decision_apply_mode: true },
      });
      return tenant &&
        tenant.decision_apply_mode !== DECISION_TENANT_OPT_OUT_MODE
        ? 'live'
        : 'shadow';
    } catch (error) {
      this.logger.warn(
        `Decision apply mode lookup failed; using shadow: ${errorName(error)}`,
      );
      return 'shadow';
    }
  }

  async isLiveForTenant(tenantId: string): Promise<boolean> {
    return (await this.resolveEffectiveMode(tenantId)) === 'live';
  }

  private warnProductionGateOnce(blockedByProductionGate: boolean): void {
    if (!blockedByProductionGate || this.productionGateWarned) {
      return;
    }
    this.productionGateWarned = true;
    this.logger.warn(
      'DECISION_APPLY_MODE=live ignored: production runtime needs DECISION_LIVE_OPT_IN=true. Using shadow.',
    );
  }
}
