import type { McpCapabilitiesService } from './mcp-capabilities.service.js';
import type { McpCapabilitiesPage } from './mcp-capabilities.service.js';
import { appendComplianceReadCapabilities } from './mcp-capabilities-compliance.aut605.js';
import { decodeMcpCursor, encodeMcpCursor } from './mcp-output.util.js';
import { MCP_CAPABILITIES_DEFAULT_PAGE_SIZE } from './mcp.constants.js';

async function loadFullCapabilityCatalog(
  capabilities: McpCapabilitiesService,
): Promise<{
  tools: McpCapabilitiesPage['data'];
  humanOnlyActions: string[];
}> {
  const rows: McpCapabilitiesPage['data'] = [];
  let humanOnlyActions: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await capabilities.getCapabilities({
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
    tools: appendComplianceReadCapabilities(rows),
    humanOnlyActions,
  };
}

/** get_capabilities paging that includes AUT-605 tools without editing the core service. */
export async function getCapabilitiesWithComplianceReads(
  capabilities: McpCapabilitiesService,
  input: { pageSize?: number; cursor?: string },
): Promise<McpCapabilitiesPage> {
  const pageSize = input.pageSize ?? MCP_CAPABILITIES_DEFAULT_PAGE_SIZE;
  const offset =
    input.cursor === undefined ? 0 : (decodeMcpCursor(input.cursor) ?? 0);
  const { tools, humanOnlyActions } =
    await loadFullCapabilityCatalog(capabilities);
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
