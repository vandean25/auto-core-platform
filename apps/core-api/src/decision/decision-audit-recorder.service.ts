import { Injectable, Logger } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { DECISION_LIVE_LOG_CONTEXT } from './decision-live-apply.constants.js';
import { errorName } from './decision-live-apply.helpers.js';
import {
  buildLiveActionLogInput,
  buildLiveShadowRecord,
} from './decision-live-audit.mapper.js';
import type { LiveDecision } from './decision-live-apply.types.js';
import { DecisionShadowService } from './decision-shadow.service.js';

@Injectable()
export class DecisionAuditRecorder {
  private readonly logger = new Logger(DECISION_LIVE_LOG_CONTEXT);

  constructor(
    private readonly agentActionLog: AgentActionLogService,
    private readonly shadow: DecisionShadowService,
  ) {}

  /**
   * One audit row per live decision, plus a shadow row when shadow logging is on.
   * Failures are logged and swallowed, so a decision never throws into its caller.
   */
  async record(decision: LiveDecision): Promise<void> {
    try {
      await this.agentActionLog.record(buildLiveActionLogInput(decision));
    } catch (error) {
      this.logger.warn(
        `Decision live audit write failed for ${decision.useCase}: ${errorName(error)}`,
      );
    }

    if (!this.shadow.isShadowEnabled()) {
      return;
    }
    try {
      const shadowRecord = buildLiveShadowRecord(decision);
      await this.shadow.writeShadowRecord(
        shadowRecord.params,
        shadowRecord.outcome,
      );
    } catch (error) {
      this.logger.debug(
        `Decision live shadow write failed for ${decision.useCase}: ${errorName(error)}`,
      );
    }
  }
}
