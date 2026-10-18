import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { agentPolicyOutcome } from '../agent-policy/agent-policy.evaluator.js';
import { withSpan } from '../common/observability/trace.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import type { AgentActionRecordInput } from '../agent-action-log/agent-action-log.types.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import {
  MCP_AGENT_FACING_CODES,
  type McpWriteToolName,
} from './mcp.constants.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  McpWriteCommandIdempotencyService,
  type McpWriteCommandClaim,
} from './mcp-write-command-idempotency.service.js';
import {
  fingerprintMcpWriteArgs,
  parseMcpWriteCommandInput,
} from './mcp-write-command-idempotency.util.js';
import { randomUUID } from 'node:crypto';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { mechanicFindingProposeNoop } from '../mechanic/mechanic-finding-propose.noop.js';
import { MECHANIC_FINDING_ACTION_TYPE } from '../mechanic/mechanic-finding.constants.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';

export type McpWriteToolContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

export type McpWriteExecution = {
  toolName: McpWriteToolName;
  policyActionType: string;
  buildPolicyContext: (
    input: unknown,
  ) => AgentPolicyEvaluateContext | Promise<AgentPolicyEvaluateContext>;
  buildExecutionContext?: (input: unknown) => Promise<Record<string, unknown>>;
  execute: (
    input: unknown,
    executionContext?: Record<string, unknown>,
  ) => Promise<unknown>;
  buildResultSummary: (result: unknown) => unknown;
  buildLogMetadata?: (
    result: unknown,
  ) => Pick<AgentActionRecordInput, 'entityType' | 'entityId' | 'reversible'>;
  preview?: (
    input: unknown,
    executionContext?: Record<string, unknown>,
  ) => Promise<unknown>;
  executeOutsideTransaction?: boolean;
  refreshReplayResult?: (
    result: McpWriteToolResult,
  ) => Promise<McpWriteToolResult>;
};

export type McpWriteToolResult = {
  tool: McpWriteToolName;
  tier: AgentPolicyTier;
  status: 'executed' | 'needs_approval';
  would_change: WouldChangeItem[];
  result?: unknown;
  proposal?: unknown;
  pending_action_id?: string;
  trace_id?: string;
  /** True when this response was returned from a durable command_id receipt. */
  replayed?: boolean;
};

/** One write call as it moves through the pipeline. Tier and reasons are filled in by the policy step. */
type WriteCall = {
  execution: McpWriteExecution;
  input: unknown;
  context: McpWriteToolContext;
  actionType: string;
  inputSummary: { tool: McpWriteToolName; args: unknown };
  tier: AgentPolicyTier;
  reasons: string[];
};

type WriteSimulation = {
  preview: unknown;
  wouldChange: WouldChangeItem[];
  executionContext?: Record<string, unknown>;
};

const logActionType = (toolName: McpWriteToolName): string => `mcp.${toolName}`;

@Injectable()
export class McpWritePipelineService {
  private readonly prisma: PrismaService;
  private readonly agentPolicy: AgentPolicyService;
  private readonly dryRun: DryRunService;
  private readonly agentActionLog: AgentActionLogService;
  private readonly agentProposals: AgentProposalService;
  private readonly commandIdempotency: McpWriteCommandIdempotencyService;
  private readonly requestContext: RequestContextService;
  private readonly tenantContext: TenantContextService;
  private readonly workshopBookingPackage: WorkshopBookingPackageService;
  private readonly workshopOrderCompletion: WorkshopOrderCompletionService;
  private readonly invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService;
  private readonly workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  private readonly mechanicFindingPropose: MechanicFindingProposeService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    prisma: PrismaService,
    agentPolicy: AgentPolicyService,
    dryRun: DryRunService,
    agentActionLog: AgentActionLogService,
    agentProposals: AgentProposalService,
    commandIdempotency: McpWriteCommandIdempotencyService,
    requestContext: RequestContextService,
    tenantContext: TenantContextService,
    workshopBookingPackage: WorkshopBookingPackageService,
    workshopOrderCompletion: WorkshopOrderCompletionService,
    invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService,
    workshopEstimateSendPropose: WorkshopEstimateSendProposeService,
    @Optional() mechanicFindingPropose?: MechanicFindingProposeService,
  ) {
    this.prisma = prisma;
    this.agentPolicy = agentPolicy;
    this.dryRun = dryRun;
    this.agentActionLog = agentActionLog;
    this.agentProposals = agentProposals;
    this.commandIdempotency = commandIdempotency;
    this.requestContext = requestContext;
    this.tenantContext = tenantContext;
    this.workshopBookingPackage = workshopBookingPackage;
    this.workshopOrderCompletion = workshopOrderCompletion;
    this.invoiceWorkshopDraftPropose = invoiceWorkshopDraftPropose;
    this.workshopEstimateSendPropose = workshopEstimateSendPropose;
    this.mechanicFindingPropose = (mechanicFindingPropose ??
      mechanicFindingProposeNoop) as MechanicFindingProposeService;
  }

  private async normalizeWriteInput(
    execution: McpWriteExecution,
    input: unknown,
  ): Promise<unknown> {
    if (execution.toolName === 'propose_workshop_booking') {
      return this.workshopBookingPackage.enrichInput(input);
    }
    if (execution.toolName === 'propose_workshop_order_completion') {
      return this.workshopOrderCompletion.enrichInput(input);
    }
    if (execution.toolName === 'propose_invoice_draft_from_order') {
      return this.invoiceWorkshopDraftPropose.enrichInput(input);
    }
    if (execution.toolName === 'propose_estimate_send') {
      return this.workshopEstimateSendPropose.enrichInput(input);
    }
    if (execution.toolName === 'propose_mechanic_finding') {
      return this.mechanicFindingPropose.enrichInput(input);
    }
    return input;
  }

  /**
   * Runs one write call as one `agent.action` span: policy first, then an `agent.decision` span around
   * refusal, a rollback preview, and either a proposal or the write.
   */
  async run(
    execution: McpWriteExecution,
    input: unknown,
    context: McpWriteToolContext,
  ): Promise<McpWriteToolResult> {
    const { commandId, businessInput } = parseMcpWriteCommandInput(input);
    const workInput = commandId ? businessInput : input;

    let claim: McpWriteCommandClaim | undefined;
    let idempotencyMeta:
      { command_id: string; args_fingerprint: string } | undefined;
    if (commandId) {
      const originalTraceId = this.requestContext.getTraceId() ?? randomUUID();
      const argsFingerprint = fingerprintMcpWriteArgs(
        execution.toolName,
        workInput,
      );
      idempotencyMeta = {
        command_id: commandId,
        args_fingerprint: argsFingerprint,
      };
      const gate = await this.commandIdempotency.beginOrReplay({
        commandId,
        toolName: execution.toolName,
        argsFingerprint,
        context,
        originalTraceId,
      });
      if (gate.kind === 'replay') {
        if (execution.refreshReplayResult) {
          return execution.refreshReplayResult(gate.result);
        }
        return gate.result;
      }
      claim = gate.claim;
    }

    try {
      return await this.runOnce(
        execution,
        workInput,
        context,
        input,
        idempotencyMeta,
        claim,
      );
    } catch (error) {
      if (claim) {
        await this.commandIdempotency.abandon(claim);
      }
      throw error;
    }
  }

  private async runOnce(
    execution: McpWriteExecution,
    input: unknown,
    context: McpWriteToolContext,
    loggedInput: unknown,
    idempotencyMeta?: { command_id: string; args_fingerprint: string },
    claim?: McpWriteCommandClaim,
  ): Promise<McpWriteToolResult> {
    const normalizedInput = await this.normalizeWriteInput(execution, input);
    const call: WriteCall = {
      execution,
      input: normalizedInput,
      context,
      actionType: logActionType(execution.toolName),
      inputSummary: { tool: execution.toolName, args: loggedInput },
      tier: AgentPolicyTier.PROPOSE,
      reasons: [],
    };

    return withSpan(
      'Agent action',
      'agent.action',
      {
        'agent.action.type': call.actionType,
        'agent.trace_id': TenantContextStorage.getRequestMeta()?.traceId,
      },
      async (span) => {
        await this.evaluatePolicy(call);
        span.setAttribute('agent.policy.tier', call.tier);

        const result = await withSpan(
          'Agent decision',
          'agent.decision',
          { 'agent.policy.outcome': agentPolicyOutcome(call.tier) },
          () => this.decideAndRun(call, idempotencyMeta, claim),
        );
        if (result.trace_id) {
          span.setAttribute('agent.trace_id', result.trace_id);
        }
        return result;
      },
    );
  }

  /** Refuses, proposes, or executes a call whose tier is settled. Only AUTO and PROPOSE reach the preview. */
  private async decideAndRun(
    call: WriteCall,
    idempotencyMeta?: { command_id: string; args_fingerprint: string },
    claim?: McpWriteCommandClaim,
  ): Promise<McpWriteToolResult> {
    if (call.tier === AgentPolicyTier.HUMAN_ONLY) {
      return this.refuse(call);
    }

    const simulation = await this.simulate(call);
    if (call.tier === AgentPolicyTier.PROPOSE) {
      return this.propose(call, simulation, idempotencyMeta, claim);
    }
    return this.execute(call, simulation.wouldChange, claim);
  }

  private async evaluatePolicy(call: WriteCall): Promise<void> {
    try {
      const policyContext = await call.execution.buildPolicyContext(call.input);
      const evaluation = await this.agentPolicy.evaluateAction(
        call.execution.policyActionType,
        policyContext,
      );
      call.tier = effectiveMcpWriteTier(
        call.execution.toolName,
        evaluation.tier,
      );
      call.reasons = evaluation.reasons;
    } catch (error) {
      await this.recordFailure(call, error);
      throw error;
    }
  }

  private async refuse(call: WriteCall): Promise<never> {
    await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: call.context.agentId,
      onBehalfOfUserId: call.context.onBehalfOfUserId,
      actionType: call.actionType,
      tier: call.tier,
      status: MCP_AGENT_FACING_CODES.refusedLogStatus,
      inputSummary: call.inputSummary,
      resultSummary: { reasons: call.reasons },
    });
    throw new ForbiddenException({
      code: MCP_AGENT_FACING_CODES.notPermitted,
      message: `${MCP_AGENT_FACING_CODES.notPermitted}: Action ${call.execution.policyActionType} requires human approval and was refused.`,
    });
  }

  /** Previews the write inside a rollback transaction, and checks the active site did not move under a pending action. */
  private async simulate(call: WriteCall): Promise<WriteSimulation> {
    try {
      const executionContext =
        call.tier === AgentPolicyTier.PROPOSE
          ? await call.execution.buildExecutionContext?.(call.input)
          : undefined;
      const previewResult = call.execution.preview
        ? {
            result: await call.execution.preview(call.input, executionContext),
            wouldChange: [] as WouldChangeItem[],
          }
        : await this.dryRun.executeInRollbackTransaction(() =>
            call.execution.execute(call.input, executionContext),
          );
      if (executionContext?.site_id !== undefined) {
        await this.assertActiveSiteUnchanged(call, executionContext);
      }
      return {
        preview: previewResult.result,
        wouldChange: previewResult.wouldChange,
        executionContext,
      };
    } catch (error) {
      await this.recordFailure(call, error);
      throw error;
    }
  }

  private async assertActiveSiteUnchanged(
    call: WriteCall,
    executionContext: Record<string, unknown>,
  ): Promise<void> {
    const appliedContext = await call.execution.buildExecutionContext?.(
      call.input,
    );
    if (appliedContext?.site_id !== executionContext.site_id) {
      throw new ConflictException(
        'The active site changed while the pending action was simulated',
      );
    }
  }

  private async propose(
    call: WriteCall,
    simulation: WriteSimulation,
    idempotencyMeta?: { command_id: string; args_fingerprint: string },
    claim?: McpWriteCommandClaim,
  ): Promise<McpWriteToolResult> {
    // Nothing is committed until the pending action is applied, so the whole preview is provisional.
    let proposalPayload: unknown = call.input;
    let proposalActionType = call.execution.policyActionType;
    let proposalPreview: unknown = simulation.preview;
    if (call.execution.toolName === 'propose_estimate_send') {
      proposalActionType = 'estimate.send_customer_message';
    }
    if (call.execution.toolName === 'propose_mechanic_finding') {
      const built = await this.mechanicFindingPropose.buildProposalPayload(
        call.input,
        call.context.agentId,
      );
      proposalPayload = built.payload_json;
      proposalActionType = MECHANIC_FINDING_ACTION_TYPE;
      proposalPreview = {
        ...built.preview_json,
        would_change: simulation.wouldChange,
      };
    }
    const proposal = {
      payload: proposalPayload,
      would_change: simulation.wouldChange,
      preview: proposalPreview,
      provisional: true,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const record = await this.agentActionLog.recordInTransaction(
          {
            actorType: 'AGENT',
            agentId: call.context.agentId,
            onBehalfOfUserId: call.context.onBehalfOfUserId,
            actionType: call.actionType,
            tier: call.tier,
            status: 'PROPOSED',
            inputSummary: call.inputSummary,
            resultSummary: proposal,
          },
          tx,
        );
        const tenantId = await this.tenantContext.getTenantId();
        const pendingAction = await tx.agentProposal.create({
          data: {
            tenant_id: tenantId,
            trace_id: record.traceId,
            action_type: proposalActionType,
            payload_json: proposalPayload as Prisma.InputJsonValue,
            preview_json: JSON.parse(
              JSON.stringify({
                ...proposal,
                ...(simulation.executionContext
                  ? { execution_context: simulation.executionContext }
                  : {}),
                ...(idempotencyMeta
                  ? { mcp_command_idempotency: idempotencyMeta }
                  : {}),
              }),
            ) as Prisma.InputJsonValue,
            tier: call.tier,
            status: AgentProposalStatus.PENDING,
            created_by_agent: call.context.agentId,
          },
        });
        const result: McpWriteToolResult = {
          tool: call.execution.toolName,
          tier: call.tier,
          status: MCP_AGENT_FACING_CODES.needsApprovalStatus,
          would_change: simulation.wouldChange,
          proposal,
          pending_action_id: pendingAction.id,
          trace_id: record.traceId,
        };
        if (claim) {
          await this.commandIdempotency.completeInTransaction(
            tx,
            claim,
            result,
          );
        }
        return result;
      });
    } catch (error) {
      await this.recordFailure(call, error);
      throw error;
    }
  }

  private async execute(
    call: WriteCall,
    wouldChange: WouldChangeItem[],
    claim?: McpWriteCommandClaim,
  ): Promise<McpWriteToolResult> {
    try {
      const workResult = call.execution.executeOutsideTransaction
        ? await call.execution.execute(call.input)
        : undefined;
      return await this.prisma.$transaction(async (tx) => {
        const record = await this.agentActionLog.recordInTransaction(
          {
            actorType: 'AGENT',
            agentId: call.context.agentId,
            onBehalfOfUserId: call.context.onBehalfOfUserId,
            actionType: call.actionType,
            tier: call.tier,
            status: 'EXECUTED',
            inputSummary: call.inputSummary,
            resultSummary: (result) =>
              call.execution.buildResultSummary(result),
          },
          tx,
          workResult !== undefined
            ? () => Promise.resolve(workResult)
            : () =>
                DryRunStorage.run({ isDryRun: false, tx }, () =>
                  call.execution.execute(call.input),
                ),
          call.execution.buildLogMetadata,
        );
        const result: McpWriteToolResult = {
          tool: call.execution.toolName,
          tier: call.tier,
          status: MCP_AGENT_FACING_CODES.executedStatus,
          would_change: wouldChange,
          result: record.workResult,
          trace_id: record.traceId,
        };
        if (claim) {
          await this.commandIdempotency.completeInTransaction(
            tx,
            claim,
            result,
          );
        }
        return result;
      });
    } catch (error) {
      await this.recordFailure(call, error);
      throw error;
    }
  }

  private async recordFailure(call: WriteCall, error: unknown): Promise<void> {
    await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: call.context.agentId,
      onBehalfOfUserId: call.context.onBehalfOfUserId,
      actionType: call.actionType,
      tier: call.tier,
      status: 'FAILED',
      inputSummary: call.inputSummary,
      resultSummary: {
        reasons: call.reasons,
        error: error instanceof Error ? error.message : 'Write tool failed',
      },
    });
  }
}
