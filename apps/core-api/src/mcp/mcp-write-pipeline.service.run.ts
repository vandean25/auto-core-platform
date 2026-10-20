import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import type { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import type { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import type { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import type { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { parseMcpWriteCommandInput } from './mcp-write-command-idempotency.util.js';
import {
  evaluateMcpWritePolicy,
  recordMcpWriteFailure,
  simulateMcpWrite,
  type McpWritePipelineCommitDeps,
} from './mcp-write-pipeline.commit.js';
import {
  isCustomerMcpProposeTool,
  runCustomerMcpProposePath,
} from './mcp-write-pipeline.customer-propose-path.js';
import { runMcpWritePipeline } from './mcp-write-pipeline.run.masked-log.js';
import type {
  McpWriteExecution,
  McpWriteToolContext,
} from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';

export type McpWritePipelineServiceHost = {
  commitDeps: McpWritePipelineCommitDeps;
  agentActionLog: AgentActionLogService;
  commandIdempotency: McpWriteCommandIdempotencyService;
  requestContext: RequestContextService;
  workshopBookingPackage: WorkshopBookingPackageService;
  workshopOrderCompletion: WorkshopOrderCompletionService;
  invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
};

const logActionType = (toolName: McpWriteToolName): string => `mcp.${toolName}`;

export function runMcpWritePipelineService(
  pipeline: McpWritePipelineServiceHost,
  execution: McpWriteExecution,
  input: unknown,
  context: McpWriteToolContext,
) {
  const parsed = parseMcpWriteCommandInput(input);

  if (isCustomerMcpProposeTool(execution.toolName) && !parsed.dryRun) {
    return runCustomerMcpProposePath({
      execution,
      rawInput: input,
      context,
      commitDeps: pipeline.commitDeps,
      enrichDeps: {
        workshopBookingPackage: pipeline.workshopBookingPackage,
        workshopOrderCompletion: pipeline.workshopOrderCompletion,
        invoiceWorkshopDraftPropose: pipeline.invoiceWorkshopDraftPropose,
        workshopEstimateSendPropose: pipeline.workshopEstimateSendPropose,
        mechanicFindingPropose: pipeline.commitDeps.mechanicFindingPropose,
      },
      commandIdempotency: pipeline.commandIdempotency,
      traceId: pipeline.requestContext.getTraceId(),
      logActionType,
    });
  }

  return runMcpWritePipeline({
    execution,
    rawInput: input,
    context,
    commitDeps: pipeline.commitDeps,
    enrichDeps: {
      workshopBookingPackage: pipeline.workshopBookingPackage,
      workshopOrderCompletion: pipeline.workshopOrderCompletion,
      invoiceWorkshopDraftPropose: pipeline.invoiceWorkshopDraftPropose,
      workshopEstimateSendPropose: pipeline.workshopEstimateSendPropose,
      mechanicFindingPropose: pipeline.commitDeps.mechanicFindingPropose,
    },
    commandIdempotency: pipeline.commandIdempotency,
    requestContext: pipeline.requestContext,
    agentActionLog: pipeline.agentActionLog,
    evaluatePolicy: (call) => evaluateMcpWritePolicy(pipeline.commitDeps, call),
    simulate: (call) => simulateMcpWrite(pipeline.commitDeps, call),
    recordFailure: (call, error) =>
      recordMcpWriteFailure(pipeline.commitDeps, call, error),
    logActionType,
  });
}
