import { Injectable } from '@nestjs/common';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpToolCallContext } from './mcp-tool-handler.service.js';
import { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import { runMcpComplianceReadTool } from './mcp-compliance-read.dispatch.js';
import { isMcpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';
import type { McpToolNameWithCompliance } from './mcp-read-tool-catalog.aut605.js';
import { mcpComplianceReadInputSchemas } from './mcp-tool-schemas.compliance-reads.js';
import { capMcpToolPayload } from './mcp-output.util.js';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';

/** Routes AUT-605 compliance read tools without editing {@link McpToolHandlerService}. */
@Injectable()
export class McpToolHandlerComplianceWrapper {
  constructor(
    private readonly core: McpToolHandlerService,
    private readonly agentActionLog: AgentActionLogService,
    private readonly complianceReads: McpComplianceReadFacade,
  ) {}

  async executeTool(
    toolName: McpToolNameWithCompliance,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    if (!isMcpComplianceReadToolName(toolName)) {
      return this.core.executeTool(toolName, rawArgs, context);
    }

    const schema = mcpComplianceReadInputSchemas[toolName];
    const record = await this.agentActionLog.record(
      {
        actorType: 'AGENT' as const,
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType: `mcp.${toolName}`,
        inputSummary: { tool: toolName, args: rawArgs },
        tier: 'AUTO',
        status: 'EXECUTED',
      },
      async () => {
        const parsed = schema.parse(rawArgs ?? {});
        return runMcpComplianceReadTool(this.complianceReads, toolName, parsed);
      },
    );
    return capMcpToolPayload(record.workResult);
  }

  recordInvalidWriteArguments(
    toolName: string,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<void> {
    return this.core.recordInvalidWriteArguments(toolName, rawArgs, context);
  }
}
