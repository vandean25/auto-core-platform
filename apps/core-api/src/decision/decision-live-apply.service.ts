import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentPolicyTier, ImportRowAction } from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { AgentActionStatus } from '../agent-action-log/agent-action-log.types.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type {
  DryRunRowResult,
  ImportJobTotals,
} from '../import/import.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DECISION_LIVE_BATCH_BUDGET_MULTIPLIER,
  DECISION_LIVE_MAX_CONCURRENT_CALLS,
  DECISION_POLICY_ACTION_TYPES,
  DECISION_PROVIDER_TOKEN,
  DECISION_TENANT_OPT_OUT_MODE,
  DECISION_USE_CASES,
  type DecisionApplyMode,
  type DecisionUseCase,
  type DocumentSortType,
} from './decision.constants.js';
import {
  readDecisionHttpTimeoutMs,
  resolveEnvDecisionApplyMode,
} from './decision-env.js';
import {
  refreshImportJobTotals,
  applyDocumentSortType,
  applyImportRowMatchChanges,
  type ImportRowMatchChange,
} from './decision-live-apply.util.js';
import type { DecisionProvider } from './decision-provider.js';
import {
  DecisionShadowService,
  redactShadowParams,
} from './decision-shadow.service.js';
import {
  buildDocumentSortCase,
  DecisionUseCaseHooksService,
  type ImportRowMatchingCase,
} from './decision-use-case-hooks.service.js';
import type {
  DecisionChoiceInput,
  DecisionResult,
  DecisionShadowRecordParams,
} from './decision.types.js';

export type DecisionLiveOutcome =
  'applied' | 'proposed' | 'refused' | 'fallback';

/** Why a decision did not change anything. The rules outcome is kept in every case. */
export type DecisionLiveReason =
  | 'no_suggestion'
  | 'provider_error'
  | 'timeout'
  | 'budget_exceeded'
  | 'invalid_choice'
  | 'suggestion_matches_rules'
  | 'not_applicable'
  | 'target_not_ready'
  | 'record_changed'
  | 'apply_failed'
  | 'human_only';

export type CustomerImportLiveResult =
  { mode: 'shadow' } | { mode: 'live'; totals: ImportJobTotals };

type ProviderCall =
  | { ok: true; suggestion: DecisionResult }
  | {
      ok: false;
      reason: Extract<
        DecisionLiveReason,
        | 'no_suggestion'
        | 'provider_error'
        | 'timeout'
        | 'budget_exceeded'
        | 'invalid_choice'
      >;
      suggestion: DecisionResult | null;
    };

type LiveDecision = {
  tenantId: string;
  useCase: DecisionUseCase;
  actionType: string;
  tier: AgentPolicyTier;
  policyReasons: string[];
  traceId: string;
  outcome: DecisionLiveOutcome;
  reason: DecisionLiveReason | null;
  entityType: string;
  entityId: string;
  /** Redacted with redactShadowParams. Never raw customer data. */
  redactedInput: unknown;
  redactedChoices: string[];
  redactedRulesChoice: string;
  redactedSuggestedChoice: string | null;
  providerCall: ProviderCall;
  providerId: string;
  targetEntityId: string | null;
  rowNo: number | null;
};

type ImportCall = {
  matchingCase: ImportRowMatchingCase;
  redactedInput: unknown;
  redactedChoices: string[];
  redactedRulesChoice: string;
  /** Maps the redacted choice label back to the real choice label. */
  originalByRedacted: Map<string, string>;
  providerCall: ProviderCall;
};

type ImportPlan =
  | { kind: 'change'; call: ImportCall; change: ImportRowMatchChange }
  | { kind: 'fallback'; call: ImportCall; reason: DecisionLiveReason };

const LIVE_OUTCOME_STATUS: Record<DecisionLiveOutcome, AgentActionStatus> = {
  applied: 'EXECUTED',
  proposed: 'PROPOSED',
  refused: 'REFUSED',
  fallback: 'FALLBACK',
};

const IMPORT_ACTION_TYPE = DECISION_POLICY_ACTION_TYPES.IMPORT_ROW_MATCH;
const DOCUMENT_SORT_ACTION_TYPE = DECISION_POLICY_ACTION_TYPES.DOCUMENT_SORT;
const DOCUMENT_SORT_RULES_FINAL_TYPE: DocumentSortType = 'Sonstiges';

class DecisionLiveTimeoutError extends Error {}

/**
 * AUT-413 live-apply. Awaits Jev only where the rules leave a gap, then applies,
 * proposes or refuses the suggestion by policy tier. Never throws into the caller.
 */
@Injectable()
export class DecisionLiveApplyService {
  private readonly logger = new Logger(DecisionLiveApplyService.name);
  private productionGateWarned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly shadow: DecisionShadowService,
    private readonly hooks: DecisionUseCaseHooksService,
    private readonly agentPolicy: AgentPolicyService,
    private readonly agentProposals: AgentProposalService,
    private readonly agentActionLog: AgentActionLogService,
    @Inject(DECISION_PROVIDER_TOKEN)
    private readonly decisionProvider: DecisionProvider,
  ) {}

  /**
   * Environment first, so a shadow deployment never reads the tenant row. A
   * tenant can only opt out (`shadow`); it can never turn live on.
   */
  async resolveEffectiveMode(tenantId: string): Promise<DecisionApplyMode> {
    const environment = resolveEnvDecisionApplyMode();
    if (environment.blockedByProductionGate && !this.productionGateWarned) {
      this.productionGateWarned = true;
      this.logger.warn(
        'DECISION_APPLY_MODE=live ignored: production runtime needs DECISION_LIVE_OPT_IN=true. Using shadow.',
      );
    }
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

  async applyCustomerImportDecisions(params: {
    tenantId: string;
    traceId?: string;
    jobId: string;
    rows: DryRunRowResult[];
    totals: ImportJobTotals;
  }): Promise<CustomerImportLiveResult> {
    if ((await this.resolveEffectiveMode(params.tenantId)) !== 'live') {
      return { mode: 'shadow' };
    }
    try {
      return await this.runCustomerImportLive(params);
    } catch (error) {
      this.logger.warn(
        `Decision live import skipped; rules outcome kept: ${errorName(error)}`,
      );
      return { mode: 'live', totals: params.totals };
    }
  }

  /**
   * Doc sort: the heuristic is final unless it returns Sonstiges. Only that gap
   * is sent to Jev. Runs after the asset is READY, so AUTO never writes a type to
   * a rejected or quarantined asset.
   */
  async applyDocumentSortForAsset(params: {
    tenantId: string;
    assetId: string;
    traceId?: string;
    text: string;
  }): Promise<void> {
    if ((await this.resolveEffectiveMode(params.tenantId)) !== 'live') {
      return;
    }
    try {
      const documentCase = buildDocumentSortCase(params.text);
      if (
        !documentCase ||
        documentCase.actualType !== DOCUMENT_SORT_RULES_FINAL_TYPE
      ) {
        return;
      }
      const traceId = this.shadow.resolveTraceId(params.traceId);
      const evaluation = await this.evaluateTier(DOCUMENT_SORT_ACTION_TYPE);
      const redacted = redactShadowParams({
        tenantId: params.tenantId,
        traceId,
        useCase: DECISION_USE_CASES.DOCUMENT_SORT,
        input: documentCase.input,
        choices: documentCase.choices,
        actualOutcome: {
          choice: documentCase.actualType,
          source: 'heuristic_classifier',
        },
      });
      const providerCall = await this.askProvider(
        {
          useCase: DECISION_USE_CASES.DOCUMENT_SORT,
          input: redacted.input,
          choices: redacted.choices,
        },
        Date.now() + readDecisionHttpTimeoutMs(),
      );

      let outcome: DecisionLiveOutcome = 'fallback';
      let reason: DecisionLiveReason | null = null;
      if (!providerCall.ok) {
        reason = providerCall.reason;
      } else if (
        providerCall.suggestion.choice === DOCUMENT_SORT_RULES_FINAL_TYPE
      ) {
        reason = 'suggestion_matches_rules';
      } else {
        const sortType = providerCall.suggestion.choice as DocumentSortType;
        if (evaluation.tier === AgentPolicyTier.HUMAN_ONLY) {
          outcome = 'refused';
          reason = 'human_only';
        } else {
          try {
            if (evaluation.tier === AgentPolicyTier.AUTO) {
              const applied = await applyDocumentSortType(this.prisma, {
                tenantId: params.tenantId,
                assetId: params.assetId,
                sortType,
              });
              outcome = applied ? 'applied' : 'fallback';
              reason = applied ? null : 'target_not_ready';
            } else {
              await this.agentProposals.persistPendingAction({
                action_type: DOCUMENT_SORT_ACTION_TYPE,
                payload_json: {
                  document_brand_asset_id: params.assetId,
                  document_sort_type: sortType,
                },
                preview_json: {
                  heuristic_type: DOCUMENT_SORT_RULES_FINAL_TYPE,
                  suggested_type: sortType,
                },
                tier: AgentPolicyTier.PROPOSE,
                trace_id: traceId,
              });
              outcome = 'proposed';
            }
          } catch (error) {
            this.logger.warn(
              `Decision live document sort write failed; heuristic outcome kept: ${errorName(error)}`,
            );
            outcome = 'fallback';
            reason = 'apply_failed';
          }
        }
      }

      await this.recordDecision({
        tenantId: params.tenantId,
        traceId,
        useCase: DECISION_USE_CASES.DOCUMENT_SORT,
        actionType: DOCUMENT_SORT_ACTION_TYPE,
        tier: evaluation.tier,
        policyReasons: evaluation.reasons,
        outcome,
        reason,
        entityType: 'DocumentBrandAsset',
        entityId: params.assetId,
        redactedInput: redacted.input,
        redactedChoices: redacted.choices,
        redactedRulesChoice: redacted.actualOutcome.choice,
        redactedSuggestedChoice: providerCall.ok
          ? providerCall.suggestion.choice
          : null,
        providerCall,
        providerId: this.decisionProvider.providerId,
        targetEntityId:
          outcome === 'applied' || outcome === 'proposed'
            ? params.assetId
            : null,
        rowNo: null,
      });
    } catch (error) {
      this.logger.warn(
        `Decision live document sort skipped; heuristic outcome kept: ${errorName(error)}`,
      );
    }
  }

  private async runCustomerImportLive(params: {
    tenantId: string;
    traceId?: string;
    jobId: string;
    rows: DryRunRowResult[];
    totals: ImportJobTotals;
  }): Promise<CustomerImportLiveResult> {
    const traceId = this.shadow.resolveTraceId(params.traceId);
    const matchingCases = await this.hooks.buildCustomerImportMatchingCases(
      params.tenantId,
      params.rows,
    );
    if (matchingCases.length === 0) {
      return { mode: 'live', totals: params.totals };
    }

    const evaluation = await this.evaluateTier(IMPORT_ACTION_TYPE);
    const deadlineAt =
      Date.now() +
      readDecisionHttpTimeoutMs() * DECISION_LIVE_BATCH_BUDGET_MULTIPLIER;
    const calls = await chunkedPromiseAll(
      matchingCases,
      (matchingCase) =>
        this.askForImportCase({
          tenantId: params.tenantId,
          traceId,
          matchingCase,
          deadlineAt,
        }),
      DECISION_LIVE_MAX_CONCURRENT_CALLS,
    );
    const plans = calls.map((call): ImportPlan => planImportChange(call));
    const changes = plans.flatMap((plan) =>
      plan.kind === 'change' ? [plan] : [],
    );

    let totals = params.totals;
    const appliedRowNos = new Set<number>();
    let applyFailed = false;
    if (evaluation.tier === AgentPolicyTier.AUTO && changes.length > 0) {
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
        applied.rowNos.forEach((rowNo) => appliedRowNos.add(rowNo));
        totals = applied.totals;
      } catch (error) {
        // The transaction rolls back as a unit, so no row or total changed.
        applyFailed = true;
        this.logger.warn(
          `Decision live import apply failed; rules outcome kept: ${errorName(error)}`,
        );
      }
    }
    let proposalFailed = false;
    if (evaluation.tier === AgentPolicyTier.PROPOSE && changes.length > 0) {
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
      } catch (error) {
        proposalFailed = true;
        this.logger.warn(
          `Decision live proposal failed; rules outcome kept: ${errorName(error)}`,
        );
      }
    }

    const decisions = plans.map((plan): LiveDecision => {
      const call = plan.call;
      const base = {
        tenantId: params.tenantId,
        traceId,
        useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
        actionType: IMPORT_ACTION_TYPE,
        tier: evaluation.tier,
        policyReasons: evaluation.reasons,
        entityType: 'ImportJob',
        entityId: params.jobId,
        redactedInput: call.redactedInput,
        redactedChoices: call.redactedChoices,
        redactedRulesChoice: call.redactedRulesChoice,
        redactedSuggestedChoice: call.providerCall.ok
          ? call.providerCall.suggestion.choice
          : null,
        providerCall: call.providerCall,
        providerId: this.decisionProvider.providerId,
        rowNo: call.matchingCase.row.row_no,
      };
      if (plan.kind === 'fallback') {
        return {
          ...base,
          outcome: 'fallback',
          reason: plan.reason,
          targetEntityId: null,
        };
      }
      const customerId = plan.change.customer_id;
      if (evaluation.tier === AgentPolicyTier.AUTO) {
        const applied = appliedRowNos.has(plan.change.row_no);
        return {
          ...base,
          outcome: applied ? 'applied' : 'fallback',
          reason: applied
            ? null
            : applyFailed
              ? 'apply_failed'
              : 'record_changed',
          targetEntityId: applied ? customerId : null,
        };
      }
      if (evaluation.tier === AgentPolicyTier.PROPOSE) {
        return {
          ...base,
          outcome: proposalFailed ? 'fallback' : 'proposed',
          reason: proposalFailed ? 'apply_failed' : null,
          targetEntityId: proposalFailed ? null : customerId,
        };
      }
      return {
        ...base,
        outcome: 'refused',
        reason: 'human_only',
        targetEntityId: null,
      };
    });

    await chunkedPromiseAll(
      decisions,
      (decision) => this.recordDecision(decision),
      DECISION_LIVE_MAX_CONCURRENT_CALLS,
    );
    return { mode: 'live', totals };
  }

  private async askForImportCase(params: {
    tenantId: string;
    traceId: string;
    matchingCase: ImportRowMatchingCase;
    deadlineAt: number;
  }): Promise<ImportCall> {
    const { matchingCase } = params;
    const redacted = redactShadowParams({
      tenantId: params.tenantId,
      traceId: params.traceId,
      useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      input: matchingCase.input,
      choices: matchingCase.choices,
      actualOutcome: {
        choice: matchingCase.actualChoice,
        source: 'import_dry_run',
      },
    });
    const providerCall = await this.askProvider(
      {
        useCase: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
        input: redacted.input,
        choices: redacted.choices,
      },
      params.deadlineAt,
    );
    return {
      matchingCase,
      redactedInput: redacted.input,
      redactedChoices: redacted.choices,
      redactedRulesChoice: redacted.actualOutcome.choice,
      originalByRedacted: new Map(
        redacted.choices.map((choice, index): [string, string] => [
          choice,
          matchingCase.choices[index],
        ]),
      ),
      providerCall,
    };
  }

  /**
   * One bounded provider call. The race enforces the timeout even when a
   * provider ignores its own. Any suggestion outside `choices` is invalid.
   */
  private async askProvider(
    input: DecisionChoiceInput,
    deadlineAt: number,
  ): Promise<ProviderCall> {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      return { ok: false, reason: 'budget_exceeded', suggestion: null };
    }
    const timeoutMs = Math.min(readDecisionHttpTimeoutMs(), remainingMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new DecisionLiveTimeoutError()),
        timeoutMs,
      );
    });
    try {
      const suggestion = await Promise.race([
        this.decisionProvider.decide(input),
        timeout,
      ]);
      if (!suggestion) {
        return { ok: false, reason: 'no_suggestion', suggestion: null };
      }
      if (!input.choices.includes(suggestion.choice)) {
        return { ok: false, reason: 'invalid_choice', suggestion: null };
      }
      return { ok: true, suggestion };
    } catch (error) {
      if (error instanceof DecisionLiveTimeoutError) {
        return { ok: false, reason: 'timeout', suggestion: null };
      }
      this.logger.debug(
        `Decision live provider call failed: ${errorName(error)}`,
      );
      return { ok: false, reason: 'provider_error', suggestion: null };
    } finally {
      clearTimeout(timer);
    }
  }

  private async evaluateTier(actionType: string): Promise<{
    tier: AgentPolicyTier;
    reasons: string[];
  }> {
    const evaluation = await this.agentPolicy.evaluateAction(actionType, {});
    return { tier: evaluation.tier, reasons: evaluation.reasons };
  }

  /**
   * One audit row per live decision, plus a shadow row when shadow logging is on.
   * Failures are logged and swallowed. Log content is redacted, and it never
   * carries provider rationale or raw model output.
   */
  private async recordDecision(decision: LiveDecision): Promise<void> {
    const suggestion = decision.providerCall.ok
      ? decision.providerCall.suggestion
      : null;
    try {
      await this.agentActionLog.record({
        traceId: decision.traceId,
        actorType: 'SYSTEM',
        actionType: decision.actionType,
        tier: decision.tier,
        status: LIVE_OUTCOME_STATUS[decision.outcome],
        inputSummary: {
          mode: 'live',
          use_case: decision.useCase,
          input: decision.redactedInput,
          choices: decision.redactedChoices,
        },
        resultSummary: {
          mode: 'live',
          outcome: decision.outcome,
          reason: decision.reason,
          rules_choice: decision.redactedRulesChoice,
          suggested_choice: decision.redactedSuggestedChoice,
          target_entity_id: decision.targetEntityId,
          row_no: decision.rowNo,
          provider: suggestion?.provider ?? decision.providerId,
          model: suggestion?.model ?? null,
          latency_ms: suggestion?.latency_ms ?? null,
          policy_reasons: decision.policyReasons,
        },
        entityType: decision.entityType,
        entityId: decision.entityId,
        reversible: false,
      });
    } catch (error) {
      this.logger.warn(
        `Decision live audit write failed for ${decision.useCase}: ${errorName(error)}`,
      );
    }

    if (!this.shadow.isShadowEnabled()) {
      return;
    }
    try {
      await this.shadow.writeShadowRecord(
        {
          tenantId: decision.tenantId,
          traceId: decision.traceId,
          useCase: decision.useCase,
          input: decision.redactedInput,
          choices: decision.redactedChoices,
          actualOutcome: {
            choice: decision.redactedRulesChoice,
            source:
              decision.useCase === DECISION_USE_CASES.IMPORT_ROW_MATCHING
                ? 'import_dry_run'
                : 'heuristic_classifier',
          },
        } satisfies DecisionShadowRecordParams,
        {
          suggestion,
          error: decision.providerCall.ok ? null : decision.providerCall.reason,
          providerId: decision.providerId,
        },
      );
    } catch (error) {
      this.logger.debug(
        `Decision live shadow write failed for ${decision.useCase}: ${errorName(error)}`,
      );
    }
  }
}

function planImportChange(call: ImportCall): ImportPlan {
  const { matchingCase, providerCall } = call;
  if (!providerCall.ok) {
    return { kind: 'fallback', call, reason: providerCall.reason };
  }
  const choice = call.originalByRedacted.get(providerCall.suggestion.choice);
  if (choice === undefined) {
    return { kind: 'fallback', call, reason: 'invalid_choice' };
  }
  if (choice === matchingCase.actualChoice) {
    return { kind: 'fallback', call, reason: 'suggestion_matches_rules' };
  }
  // Only a real customer match on a CREATE row is adoptable. Same-file
  // candidates, create_new over an existing match, and rows the rules already
  // matched stay with the rules outcome.
  const target = matchingCase.candidateTargets.find(
    (candidate) => candidate.choice === choice,
  );
  const customerId = target?.entityId ?? null;
  if (
    choice === matchingCase.createChoice ||
    customerId === null ||
    matchingCase.row.action !== ImportRowAction.CREATE
  ) {
    return { kind: 'fallback', call, reason: 'not_applicable' };
  }
  return {
    kind: 'change',
    call,
    change: { row_no: matchingCase.row.row_no, customer_id: customerId },
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
