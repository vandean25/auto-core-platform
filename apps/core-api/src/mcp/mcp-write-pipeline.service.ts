import { Injectable } from '@nestjs/common';
import { McpWritePipelineHost } from './mcp-write-pipeline.host.js';

export type {
  McpWriteExecution,
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.types.js';

/** Nest injection token; implementation lives in {@link McpWritePipelineHost}. */
@Injectable()
export class McpWritePipelineService extends McpWritePipelineHost {}
