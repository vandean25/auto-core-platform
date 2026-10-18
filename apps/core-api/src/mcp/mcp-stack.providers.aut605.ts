import type { Provider } from '@nestjs/common';
import { McpReadToolService } from './mcp-read-tool.service.js';
import { McpReadToolServiceAut605 } from './mcp-read-tool.service.aut605.js';
import { McpSessionService } from './mcp-session.service.js';
import { McpSessionServiceAut605 } from './mcp-session.service.aut605.js';

function useLegacyMcpStackForE2e(): boolean {
  return process.env.MCP_E2E_LEGACY_STACK === 'true';
}

/** Nest providers that pick the AUT-605 MCP stack unless legacy e2e env is set. */
export const MCP_STACK_PROVIDERS_AUT605: Provider[] = [
  {
    provide: McpReadToolService,
    useClass: useLegacyMcpStackForE2e()
      ? McpReadToolService
      : McpReadToolServiceAut605,
  },
  {
    provide: McpSessionService,
    useClass: useLegacyMcpStackForE2e()
      ? McpSessionService
      : McpSessionServiceAut605,
  },
];
