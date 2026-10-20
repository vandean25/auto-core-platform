import { Injectable } from '@nestjs/common';
import { McpWritePipelineHost } from './mcp-write-pipeline.host.js';
import {
  runMcpWritePipelineService,
  type McpWritePipelineServiceHost,
} from './mcp-write-pipeline.service.run.js';
import type {
  McpWriteExecution,
  McpWriteToolContext,
} from './mcp-write-pipeline.types.js';

export type {
  McpWriteExecution,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

/** Nest injection token for the MCP write pipeline. */
@Injectable()
export class McpWritePipelineService extends McpWritePipelineHost {
  override run(
    execution: McpWriteExecution,
    input: unknown,
    context: McpWriteToolContext,
  ) {
    return runMcpWritePipelineService(
      this as unknown as McpWritePipelineServiceHost,
      execution,
      input,
      context,
    );
  }
}
