import { Injectable } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type {
  McpReadToolName,
  McpToolName,
  McpWriteToolName,
} from './mcp.constants.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import type { McpWriteExecution } from './mcp-write-pipeline.service.js';
import { capMcpToolPayload } from './mcp-output.util.js';
import { summarizeMcpDocumentPdfForLog } from './mcp-document-read.mapper.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  mcpToolInputSchemas,
  mcpWriteToolInputSchemas,
} from './mcp-tool-schemas.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';

export type McpToolCallContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

/**
 * Action-log summaries for read tools whose full result must not be stored. A
 * document link is a bearer credential, so its row keeps the document and the
 * expiry only. Tools without an entry keep the default empty summary.
 */
const READ_RESULT_SUMMARIES: Partial<
  Record<McpReadToolName, (result: unknown) => unknown>
> = {
  get_document_pdf: summarizeMcpDocumentPdfForLog,
};

@Injectable()
export class McpToolHandlerService {
  private readonly agentActionLog: AgentActionLogService;
  private readonly writePipeline: McpWritePipelineService;
  private readonly pendingActionExecutors: PendingActionExecutorService;
  private readonly readTools: McpReadToolService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    agentActionLog: AgentActionLogService,
    writePipeline: McpWritePipelineService,
    pendingActionExecutors: PendingActionExecutorService,
    readTools: McpReadToolService,
  ) {
    this.agentActionLog = agentActionLog;
    this.writePipeline = writePipeline;
    this.pendingActionExecutors = pendingActionExecutors;
    this.readTools = readTools;
  }

  async executeTool(
    toolName: McpToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    if (isWriteTool(toolName)) {
      return this.executeWriteTool(toolName, rawArgs, context);
    }

    const schema = mcpToolInputSchemas[toolName];
    const resultSummary = READ_RESULT_SUMMARIES[toolName];
    const record = await this.agentActionLog.record(
      {
        ...this.agentLogRow(toolName, rawArgs, context),
        tier: 'AUTO',
        status: 'EXECUTED',
        ...(resultSummary ? { resultSummary } : {}),
      },
      async () => {
        const parsed = schema.parse(rawArgs ?? {});
        return this.readTools.run(toolName, parsed, context);
      },
    );

    return capMcpToolPayload(record.workResult);
  }

  private async executeWriteTool(
    toolName: McpWriteToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    const schema = mcpWriteToolInputSchemas[toolName];
    let parsed: unknown;
    try {
      parsed = schema.parse(rawArgs ?? {});
    } catch (error) {
      await this.logWriteInputFailure(toolName, rawArgs, context, error);
      throw error;
    }
    const result = await this.writePipeline.run(
      this.buildWriteExecution(toolName),
      parsed,
      context,
    );
    return capMcpToolPayload(result);
  }

  async recordInvalidWriteArguments(
    toolName: string,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<void> {
    if (
      !Object.prototype.hasOwnProperty.call(mcpWriteToolInputSchemas, toolName)
    ) {
      return;
    }

    const writeToolName = toolName as McpWriteToolName;
    try {
      mcpWriteToolInputSchemas[writeToolName].parse(rawArgs ?? {});
    } catch (error) {
      await this.logWriteInputFailure(writeToolName, rawArgs, context, error);
    }
  }

  private async logWriteInputFailure(
    toolName: McpWriteToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
    error: unknown,
  ): Promise<void> {
    // Schema validation runs before policy, so no tier was evaluated. Logging
    // PROPOSE here would read as a proposal awaiting approval.
    await this.agentActionLog.record({
      ...this.agentLogRow(toolName, rawArgs, context),
      tier: 'NOT_EVALUATED',
      status: 'FAILED',
      resultSummary: {
        error: error instanceof Error ? error.message : 'Invalid input',
      },
    });
  }

  /** The action-log fields every MCP call shares. The caller adds the tier, status, and result. */
  private agentLogRow(
    toolName: McpToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
  ) {
    return {
      actorType: 'AGENT' as const,
      agentId: context.agentId,
      onBehalfOfUserId: context.onBehalfOfUserId,
      actionType: `mcp.${toolName}`,
      inputSummary: { tool: toolName, args: rawArgs },
    };
  }

  private buildWriteExecution(toolName: McpWriteToolName): McpWriteExecution {
    const actionTypeByTool: Record<McpWriteToolName, string> = {
      draft_workshop_order: 'workshop_order.create',
      reserve_part: 'inventory.part_reserve',
      release_reservation: 'inventory.part_release',
      propose_line_item: 'workshop_order.propose_line',
      propose_registration_intake: 'registration_intake.apply',
      propose_workshop_booking: 'workshop.booking_package',
      propose_purchase_order: 'purchase_order.propose_draft',
      propose_workshop_order_completion: 'workshop_order.complete',
      propose_invoice_draft_from_order:
        'invoice.create_draft_from_workshop_order',
      propose_estimate_send: 'workshop_estimate.send',
      request_workshop_media_upload: 'workshop.media_upload_slot',
      propose_mechanic_finding: 'workshop_order.propose_mechanic_finding',
      generate_weekly_report_pdf: 'report.generate_weekly_pdf',
    };
    const executor = this.pendingActionExecutors.resolve(
      actionTypeByTool[toolName],
    );
    const policyActionType =
      toolName === 'propose_estimate_send'
        ? 'estimate.send_customer_message'
        : executor.actionType;
    return {
      toolName,
      policyActionType,
      buildPolicyContext: (input) => executor.buildPolicyContext(input),
      buildExecutionContext: executor.buildExecutionContext
        ? (input) => executor.buildExecutionContext!(input)
        : undefined,
      preview: executor.preview
        ? (input, executionContext) =>
            executor.preview!(input, executionContext)
        : undefined,
      execute: (input, executionContext) =>
        executor.execute(input, executionContext),
      executeOutsideTransaction: executor.executeOutsideTransaction ?? false,
      refreshReplayResult: executor.refreshReplayResult
        ? (result) => executor.refreshReplayResult!(result)
        : undefined,
      buildResultSummary: (result) => executor.buildResultSummary(result),
      buildLogMetadata: executor.buildLogMetadata
        ? (result) => executor.buildLogMetadata!(result)
        : undefined,
    };
  }
}

const MCP_WRITE_TOOL_NAME_SET = new Set<string>([
  'draft_workshop_order',
  'reserve_part',
  'release_reservation',
  'propose_line_item',
  'propose_registration_intake',
  'propose_workshop_booking',
  'propose_purchase_order',
  'propose_workshop_order_completion',
  'propose_invoice_draft_from_order',
  'propose_estimate_send',
  'request_workshop_media_upload',
  'propose_mechanic_finding',
  'generate_weekly_report_pdf',
]);

function isWriteTool(toolName: McpToolName): toolName is McpWriteToolName {
  return MCP_WRITE_TOOL_NAME_SET.has(toolName);
}
