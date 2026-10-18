import { Injectable, Optional } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { DryRunService } from '../dry-run/dry-run.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import type { McpWriteDryRunResult } from './mcp-write-dry-run.util.js';
import {
  evaluateMcpWritePolicy,
  recordMcpWriteFailure,
  simulateMcpWrite,
  type McpWritePipelineCommitDeps,
} from './mcp-write-pipeline.commit.js';
import { runMcpWritePipeline } from './mcp-write-pipeline.run.js';
import type {
  McpWriteExecution,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.service.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { mechanicFindingProposeNoop } from '../mechanic/mechanic-finding-propose.noop.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import type { McpWriteToolName } from './mcp.constants.js';

export type McpWritePipelineHostResult =
  McpWriteToolResult | McpWriteDryRunResult;

const logActionType = (toolName: McpWriteToolName): string => `mcp.${toolName}`;

@Injectable()
export class McpWritePipelineHost {
  private readonly commitDeps: McpWritePipelineCommitDeps;

  constructor(
    prisma: PrismaService,
    agentPolicy: AgentPolicyService,
    dryRun: DryRunService,
    private readonly agentActionLog: AgentActionLogService,
    agentProposals: AgentProposalService,
    private readonly commandIdempotency: McpWriteCommandIdempotencyService,
    private readonly requestContext: RequestContextService,
    tenantContext: TenantContextService,
    private readonly workshopBookingPackage: WorkshopBookingPackageService,
    private readonly workshopOrderCompletion: WorkshopOrderCompletionService,
    private readonly invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService,
    private readonly workshopEstimateSendPropose: WorkshopEstimateSendProposeService,
    @Optional() mechanicFindingPropose?: MechanicFindingProposeService,
  ) {
    this.commitDeps = {
      prisma,
      agentPolicy,
      dryRun,
      agentActionLog,
      tenantContext,
      commandIdempotency,
      mechanicFindingPropose: (mechanicFindingPropose ??
        mechanicFindingProposeNoop) as MechanicFindingProposeService,
    };
  }

  async run(
    execution: McpWriteExecution,
    input: unknown,
    context: McpWriteToolContext,
  ): Promise<McpWritePipelineHostResult> {
    return runMcpWritePipeline({
      execution,
      rawInput: input,
      context,
      commitDeps: this.commitDeps,
      enrichDeps: {
        workshopBookingPackage: this.workshopBookingPackage,
        workshopOrderCompletion: this.workshopOrderCompletion,
        invoiceWorkshopDraftPropose: this.invoiceWorkshopDraftPropose,
        workshopEstimateSendPropose: this.workshopEstimateSendPropose,
        mechanicFindingPropose: this.commitDeps.mechanicFindingPropose,
      },
      commandIdempotency: this.commandIdempotency,
      requestContext: this.requestContext,
      agentActionLog: this.agentActionLog,
      evaluatePolicy: (call) => evaluateMcpWritePolicy(this.commitDeps, call),
      simulate: (call) => simulateMcpWrite(this.commitDeps, call),
      recordFailure: (call, error) =>
        recordMcpWriteFailure(this.commitDeps, call, error),
      logActionType,
    });
  }
}
