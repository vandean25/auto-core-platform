import type { Provider } from '@nestjs/common';
import { McpReadToolService } from './mcp-read-tool.service.js';
import { McpReadToolServiceAut615 } from './mcp-read-tool.service.aut615.js';
import { McpSessionService } from './mcp-session.service.js';
import { McpSessionServiceAut615 } from './mcp-session.service.aut615.js';

function useLegacyMcpStackForE2e(): boolean {
  return process.env.MCP_E2E_LEGACY_STACK === 'true';
}

/** Nest providers that pick the AUT-615 MCP stack unless legacy e2e env is set. */
export const MCP_STACK_PROVIDERS_AUT615: Provider[] = [
  {
    provide: McpReadToolService,
    useClass: useLegacyMcpStackForE2e()
      ? McpReadToolService
      : McpReadToolServiceAut615,
  },
  {
    provide: McpSessionService,
    useClass: useLegacyMcpStackForE2e()
      ? McpSessionService
      : McpSessionServiceAut615,
  },
];
