import type { McpWriteToolName } from './mcp.constants.js';

/** AUT-596 MCP write tool → agent policy action type. */
export const MCP_WRITE_POLICY_ACTION_TYPES_AUT596: Record<
  Extract<McpWriteToolName, 'generate_weekly_report_pdf'>,
  string
> = {
  generate_weekly_report_pdf: 'report.generate_weekly_pdf',
};
