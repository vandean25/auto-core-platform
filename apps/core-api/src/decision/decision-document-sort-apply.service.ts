import { Injectable, Logger } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DECISION_USE_CASES,
  type DocumentSortType,
} from './decision.constants.js';
import { readDecisionHttpTimeoutMs } from './decision-env.js';
import {
  DECISION_LIVE_LOG_CONTEXT,
  DOCUMENT_SORT_ACTION_TYPE,
  DOCUMENT_SORT_RULES_FINAL_TYPE,
} from './decision-live-apply.constants.js';
import {
  errorName,
  evaluateDecisionTier,
} from './decision-live-apply.helpers.js';
import { applyDocumentSortType } from './decision-live-apply.util.js';
import type { DocumentSortDecisionParams } from './decision-live-apply.types.js';
import { DecisionAuditRecorder } from './decision-audit-recorder.service.js';
import {
  buildDocumentSortLiveDecision,
  gateDocumentSortSuggestion,
  type DocumentSortWrite,
} from './decision-live-document-sort.outcome.js';
import { DecisionModeResolver } from './decision-mode-resolver.service.js';
import { DecisionProviderClient } from './decision-provider-client.service.js';
import {
  DecisionShadowService,
  redactShadowParams,
} from './decision-shadow.service.js';
import {
  buildDocumentSortCase,
  type DocumentSortCase,
} from './decision-use-case-hooks.service.js';
import {
  buildDocumentSortExcerpt,
  documentSortExcerptAudit,
  type DocumentSortLiveInput,
} from './document-sort-excerpt.js';

/**
 * Live apply for document sort (AUT-413). The heuristic is final unless it
 * returns Sonstiges. Only that gap is sent to Jev, as the signals plus a
 * redacted, capped text excerpt. Runs after the asset is READY, so AUTO never
 * writes a type to a rejected or quarantined asset. Never throws into the caller.
 */
@Injectable()
export class DecisionDocumentSortApplier {
  private readonly logger = new Logger(DECISION_LIVE_LOG_CONTEXT);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shadow: DecisionShadowService,
    private readonly agentPolicy: AgentPolicyService,
    private readonly agentProposals: AgentProposalService,
    private readonly modes: DecisionModeResolver,
    private readonly providerClient: DecisionProviderClient,
    private readonly audit: DecisionAuditRecorder,
  ) {}

  async apply(params: DocumentSortDecisionParams): Promise<void> {
    if ((await this.modes.resolveEffectiveMode(params.tenantId)) !== 'live') {
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
      const evaluation = await evaluateDecisionTier(
        this.agentPolicy,
        DOCUMENT_SORT_ACTION_TYPE,
      );
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
      const excerpt = buildDocumentSortExcerpt(params.text);
      const signalsInput = redacted.input as DocumentSortCase['input'];
      const providerInput = {
        ...signalsInput,
        text_excerpt: excerpt.text,
      } satisfies DocumentSortLiveInput;
      const providerCall = await this.providerClient.ask(
        {
          useCase: DECISION_USE_CASES.DOCUMENT_SORT,
          input: providerInput,
          choices: redacted.choices,
        },
        Date.now() + readDecisionHttpTimeoutMs(),
      );

      const gate = gateDocumentSortSuggestion(providerCall, evaluation.tier);
      const write =
        'sortType' in gate
          ? await this.writeSuggestion(
              params,
              traceId,
              evaluation.tier,
              gate.sortType,
            )
          : gate;
      await this.audit.record(
        buildDocumentSortLiveDecision({
          tenantId: params.tenantId,
          traceId,
          assetId: params.assetId,
          tier: evaluation.tier,
          policyReasons: evaluation.reasons,
          write,
          providerCall,
          providerId: this.providerClient.providerId,
          redactedInput: {
            ...signalsInput,
            ...documentSortExcerptAudit(excerpt),
          },
          redactedChoices: redacted.choices,
          redactedRulesChoice: redacted.actualOutcome.choice,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Decision live document sort skipped; heuristic outcome kept: ${errorName(error)}`,
      );
    }
  }

  /** AUTO writes the type to a READY asset with no type yet. PROPOSE only queues it. */
  private async writeSuggestion(
    params: DocumentSortDecisionParams,
    traceId: string,
    tier: AgentPolicyTier,
    sortType: DocumentSortType,
  ): Promise<DocumentSortWrite> {
    try {
      if (tier === AgentPolicyTier.AUTO) {
        const applied = await applyDocumentSortType(this.prisma, {
          tenantId: params.tenantId,
          assetId: params.assetId,
          sortType,
        });
        return applied
          ? { outcome: 'applied', reason: null }
          : { outcome: 'fallback', reason: 'target_not_ready' };
      }
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
      return { outcome: 'proposed', reason: null };
    } catch (error) {
      this.logger.warn(
        `Decision live document sort write failed; heuristic outcome kept: ${errorName(error)}`,
      );
      return { outcome: 'fallback', reason: 'apply_failed' };
    }
  }
}
