import type { McpCapabilitiesService } from './mcp-capabilities.service.js';
import type { McpCapabilitiesPage } from './mcp-capabilities.service.js';
import { appendWave2ReadCapabilities } from './mcp-read-wave2-capabilities.js';
import { getCapabilitiesWithComplianceReads } from './mcp-capabilities-read.aut605.js';
import { decodeMcpCursor, encodeMcpCursor } from './mcp-output.util.js';
import { MCP_CAPABILITIES_DEFAULT_PAGE_SIZE } from './mcp.constants.js';

async function loadFullCapabilityCatalogWithWave2(
  capabilities: McpCapabilitiesService,
  sessionRole: string | null | undefined,
): Promise<{
  tools: McpCapabilitiesPage['data'];
  humanOnlyActions: string[];
}> {
  const rows: McpCapabilitiesPage['data'] = [];
  let humanOnlyActions: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await getCapabilitiesWithComplianceReads(capabilities, {
      pageSize: MCP_CAPABILITIES_DEFAULT_PAGE_SIZE,
      cursor,
    });
    if (humanOnlyActions.length === 0) {
      humanOnlyActions = page.human_only_actions;
    }
    rows.push(...page.data);
    cursor = page.meta.next_cursor ?? undefined;
  } while (cursor !== undefined);

  return {
    tools: appendWave2ReadCapabilities(rows, sessionRole),
    humanOnlyActions,
  };
}

export async function getCapabilitiesWithWave2Reads(
  capabilities: McpCapabilitiesService,
  input: { pageSize?: number; cursor?: string },
  sessionRole: string | null | undefined,
): Promise<McpCapabilitiesPage> {
  const pageSize = input.pageSize ?? MCP_CAPABILITIES_DEFAULT_PAGE_SIZE;
  const offset =
    input.cursor === undefined ? 0 : (decodeMcpCursor(input.cursor) ?? 0);
  const { tools, humanOnlyActions } = await loadFullCapabilityCatalogWithWave2(
    capabilities,
    sessionRole,
  );
  const nextOffset = offset + pageSize;
  return {
    data: tools.slice(offset, nextOffset),
    meta: {
      total: tools.length,
      page_size: pageSize,
      next_cursor:
        nextOffset < tools.length ? encodeMcpCursor(nextOffset) : null,
    },
    human_only_actions: humanOnlyActions,
  };
}
