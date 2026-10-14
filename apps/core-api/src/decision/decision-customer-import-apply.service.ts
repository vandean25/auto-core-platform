import { Injectable, Logger } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DECISION_LIVE_BATCH_BUDGET_MULTIPLIER,
  DECISION_LIVE_MAX_CONCURRENT_CALLS,
  DECISION_USE_CASES,
} from './decision.constants.js';
import { readDecisionHttpTimeoutMs } from './decision-env.js';
import {
  DECISION_LIVE_LOG_CONTEXT,
  IMPORT_ACTION_TYPE,
} from './decision-live-apply.constants.js';
import {
  errorName,
  evaluateDecisionTier,
} from './decision-live-apply.helpers.js';
import {
  applyImportRowMatchChanges,
  refreshImportJobTotals,
} from './decision-live-apply.util.js';
import type {
  CustomerImportDecisionParams,
  CustomerImportLiveResult,
} from './decision-live-apply.types.js';
import { DecisionAuditRecorder } from './decision-audit-recorder.service.js';
import {
  buildImportLiveDecisions,
  emptyImportWrite,
  isChangePlan,
  pairRedactedChoices,
  planImportChange,
  type ChangeImportPlan,
  type ImportCall,
  type ImportPlan,
  type ImportWriteResult,
} from './decision-live-import.plan.js';
import { DecisionModeResolver } from './decision-mode-resolver.service.js';
import { DecisionProviderClient } from './decision-provider-client.service.js';
import {
  DecisionShadowService,
  redactShadowParams,
} from './decision-shadow.service.js';
import {
  DecisionUseCaseHooksService,
  type ImportRowMatchingCase,
} from './decision-use-case-hooks.service.js';

type ImportCaseRequest = {
  tenantId: string;
  traceId: string;
  matchingCase: ImportRowMatchingCase;
  deadlineAt: number;
};

/**
 * Live apply for customer import dry runs (AUT-413). Asks Jev about each row the
 * rules left open, then applies, proposes or refuses the adoptable matches by
 * policy tier. Never throws into the import.
 */
@Injectable()
export class DecisionCustomerImportApplier {
  private readonly logger = new Logger(DECISION_LIVE_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shadow: DecisionShadowService,
    private readonly hooks: DecisionUseCaseHooksService,
    private readonly agentPolicy: AgentPolicyService,
    private readonly agentProposals: AgentProposalService,
    private readonly modes: DecisionModeResolver,
    private readonly providerClient: DecisionProviderClient,
    private readonly audit: DecisionAuditRecorder,
  ) {}

  async apply(
    params: CustomerImportDecisionParams,
  ): Promise<CustomerImportLiveResult> {
    if ((await this.modes.resolveEffectiveMode(params.tenantId)) !== 'live') {
      return { mode: 'shadow' };
    }
    try {
      return await this.runLive(params);
    } catch (error) {
      this.logger.warn(
        `Decision live import skipped; rules outcome kept: ${errorName(error)}`,
      );
      return { mode: 'live', totals: params.totals };
    }
  }

  private async runLive(
    params: CustomerImportDecisionParams,
  ): Promise<CustomerImportLiveResult> {
    const traceId = this.shadow.resolveTraceId(params.traceId);
    const matchingCases = await this.hooks.buildCustomerImportMatchingCases(
      params.tenantId,
      params.rows,
    );
    if (matchingCases.length === 0) {
      return { mode: 'live', totals: params.totals };
    }

    const evaluation = await evaluateDecisionTier(
      this.agentPolicy,
      IMPORT_ACTION_TYPE,
    );
    const plans = await this.planMatches(
      params.tenantId,
      traceId,
      matchingCases,
    );
    const write = await this.writeByTier(
      evaluation.tier,
      params,
      plans.filter(isChangePlan),
      traceId,
    );
    const decisions = buildImportLiveDecisions({
      tenantId: params.tenantId,
      traceId,
      jobId: params.jobId,
      tier: evaluation.tier,
      policyReasons: evaluation.reasons,
      providerId: this.providerClient.providerId,
      plans,
      write,
    });
    await chunkedPromiseAll(
      decisions,
      (decision) => this.audit.record(decision),
      DECISION_LIVE_MAX_CONCURRENT_CALLS,
    );
    return { mode: 'live', totals: write.totals };
  }

  /** The whole batch shares one budget, so a slow provider cannot stall the import. */
  private async planMatches(
    tenantId: string,
    traceId: string,
    matchingCases: ImportRowMatchingCase[],
  ): Promise<ImportPlan[]> {
    const deadlineAt =
      Date.now() +
      readDecisionHttpTimeoutMs() * DECISION_LIVE_BATCH_BUDGET_MULTIPLIER;
    const calls = await chunkedPromiseAll(
      matchingCases,
      (matchingCase) =>
        this.askForImportCase({ tenantId, traceId, matchingCase, deadlineAt }),
      DECISION_LIVE_MAX_CONCURRENT_CALLS,
    );
    return calls.map((call): ImportPlan => planImportChange(call));
  }

  private async writeByTier(
    tier: AgentPolicyTier,
    params: CustomerImportDecisionParams,
    changes: ChangeImportPlan[],
    traceId: string,
  ): Promise<ImportWriteResult> {
    if (changes.length === 0) {
      return emptyImportWrite(params.totals);
    }
    if (tier === AgentPolicyTier.AUTO) {
      return this.applyAuto(params, changes);
    }
    if (tier === AgentPolicyTier.PROPOSE) {
      return this.propose(params, changes, traceId);
    }
    return emptyImportWrite(params.totals);
  }

  private async applyAuto(
    params: CustomerImportDecisionParams,
    changes: ChangeImportPlan[],
  ): Promise<ImportWriteResult> {
    try {
      const applied = await this.prisma.$transaction(async (tx) => {
        const rowNos = await applyImportRowMatchChanges(tx, {
          tenantId: params.tenantId,
          jobId: params.jobId,
          changes: changes.map((plan) => plan.change),
        });
        if (rowNos.length === 0) {
          return { rowNos, totals: params.totals };
        }
        // The recount takes the job lock and fails unless the job is still
        // DRY_RUN_DONE. A job that moved on during the Jev wait rolls the rows back.
        const recounted = await refreshImportJobTotals(tx, {
          tenantId: params.tenantId,
          jobId: params.jobId,
        });
        if (!recounted) {
          throw new Error('Import job left DRY_RUN_DONE during the decision');
        }
        return { rowNos, totals: recounted };
      });
      return {
        ...emptyImportWrite(applied.totals),
        appliedRowNos: new Set(applied.rowNos),
      };
    } catch (error) {
      // The transaction rolls back as a unit, so no row or total changed.
      this.logger.warn(
        `Decision live import apply failed; rules outcome kept: ${errorName(error)}`,
      );
      return { ...emptyImportWrite(params.totals), applyFailed: true };
    }
  }

  private async propose(
    params: CustomerImportDecisionParams,
    changes: ChangeImportPlan[],
    traceId: string,
  ): Promise<ImportWriteResult> {
    try {
      await chunkedPromiseAll(
        changes,
        (plan) =>
          this.agentProposals.persistPendingAction({
            action_type: IMPORT_ACTION_TYPE,
            payload_json: {
              import_job_id: params.jobId,
              row_no: plan.change.row_no,
              customer_id: plan.change.customer_id,
            },
            preview_json: {
              suggested_choice: plan.call.providerCall.ok
                ? plan.call.providerCall.suggestion.choice
                : null,
              rules_choice: plan.call.redactedRulesChoice,
            },
            tier: AgentPolicyTier.PROPOSE,
            trace_id: traceId,
          }),
        DECISION_LIVE_MAX_CONCURRENT_CALLS,
      );
      return emptyImportWrite(params.totals);
    } catch (error) {
      this.logger.warn(
        `Decision live proposal failed; rules outcome kept: ${errorName(error)}`,
      );
      return { ...emptyImportWrite(params.totals), proposalFailed: true };
    }
  }

  private async askForImportCase(
    request: ImportCaseRequest,
  ): Promise<ImportCall> {
    const { matchingCase } = request;
    const redacted = redactShadowParams({
      tenantId: request.tenantId,
      traceId: request.traceId,
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      input: matchingCase.input,
      choices: matchingCase.choices,
      actualOutcome: {
        choice: matchingCase.actualChoice,
        source: 'import_dry_run',
      },
    });
    const providerCall = await this.providerClient.ask(
      {
        useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
        input: redacted.input,
        choices: redacted.choices,
      },
      request.deadlineAt,
    );
    return {
      matchingCase,
      redactedInput: redacted.input,
      redactedChoices: redacted.choices,
      redactedRulesChoice: redacted.actualOutcome.choice,
      originalByRedacted: pairRedactedChoices(
        redacted.choices,
        matchingCase.choices,
      ),
      providerCall,
    };
  }
}
