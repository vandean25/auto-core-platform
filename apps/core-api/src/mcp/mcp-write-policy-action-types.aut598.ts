import type { McpWriteToolName } from './mcp.constants.js';

/** AUT-598 MCP write tools → agent policy action types (merged in capabilities). */
export const MCP_WRITE_POLICY_ACTION_TYPES_AUT598: Record<
  Extract<
    McpWriteToolName,
    'request_workshop_media_upload' | 'propose_mechanic_finding'
  >,
  string
> = {
  request_workshop_media_upload: 'workshop.media_upload_slot',
  propose_mechanic_finding: 'workshop_order.propose_mechanic_finding',
};
