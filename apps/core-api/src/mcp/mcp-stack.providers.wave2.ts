import type { Provider } from '@nestjs/common';
import { McpReadToolService } from './mcp-read-tool.service.js';
import { McpReadToolServiceWave2 } from './mcp-read-tool.service.wave2.js';
import { McpSessionService } from './mcp-session.service.js';
import { McpSessionServiceWave2 } from './mcp-session.service.wave2.js';

function useLegacyMcpStackForE2e(): boolean {
  return process.env.MCP_E2E_LEGACY_STACK === 'true';
}

/** Default MCP read stack: compliance reads plus wave-2 shop reads (legacy e2e can pin the base stack). */
export const MCP_STACK_PROVIDERS_WAVE2: Provider[] = [
  {
    provide: McpReadToolService,
    useClass: useLegacyMcpStackForE2e()
      ? McpReadToolService
      : McpReadToolServiceWave2,
  },
  {
    provide: McpSessionService,
    useClass: useLegacyMcpStackForE2e()
      ? McpSessionService
      : McpSessionServiceWave2,
  },
];
