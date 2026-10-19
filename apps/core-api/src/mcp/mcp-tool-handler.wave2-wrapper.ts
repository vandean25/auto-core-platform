import { Injectable } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { McpToolHandlerComplianceWrapper } from './mcp-tool-handler.compliance-wrapper.js';
import type { McpToolCallContext } from './mcp-tool-handler.service.js';
import { isMcpWave2ReadToolName } from './mcp-read-tool-catalog.aut615.js';
import type { McpToolNameWithWave2 } from './mcp-read-tool-catalog.aut615.js';
import { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';
import { runMcpWave2ReadTool } from './mcp-wave2-read.dispatch.js';
import { mcpWave2ReadInputSchemas } from './mcp-tool-schemas.aut615-reads.js';
import { capMcpToolPayload } from './mcp-output.util.js';

/** Routes AUT-615 wave-2 read tools ahead of the AUT-605 compliance wrapper. */
@Injectable()
export class McpToolHandlerWave2Wrapper {
  constructor(
    private readonly compliance: McpToolHandlerComplianceWrapper,
    private readonly agentActionLog: AgentActionLogService,
    private readonly wave2Reads: McpWave2ReadFacade,
  ) {}

  async executeTool(
    toolName: McpToolNameWithWave2,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    if (!isMcpWave2ReadToolName(toolName)) {
      return this.compliance.executeTool(toolName, rawArgs, context);
    }

    const schema = mcpWave2ReadInputSchemas[toolName];
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
        return runMcpWave2ReadTool(this.wave2Reads, toolName, parsed);
      },
    );
    return capMcpToolPayload(record.workResult);
  }

  recordInvalidWriteArguments(
    toolName: string,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<void> {
    return this.compliance.recordInvalidWriteArguments(
      toolName,
      rawArgs,
      context,
    );
  }
}
