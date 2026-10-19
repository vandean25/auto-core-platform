import './mcp-tool-descriptions.bootstrap.js';
import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { MCP_NEST_IMPORTS } from './mcp-nest.imports.js';
import { MCP_NEST_PROVIDERS } from './mcp-nest.providers.js';

@Module({
  imports: MCP_NEST_IMPORTS,
  controllers: [McpController],
  providers: MCP_NEST_PROVIDERS,
})
export class McpModule {}
