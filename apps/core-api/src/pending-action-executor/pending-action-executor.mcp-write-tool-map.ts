import type { McpWriteToolName } from '../mcp/mcp.constants.js';
import type { PendingActionType } from './pending-action-executor.types.js';

export const MCP_WRITE_TOOL_PENDING_ACTION_TYPES: Record<
  McpWriteToolName,
  PendingActionType
> = {
  draft_workshop_order: 'workshop_order.create',
  reserve_part: 'inventory.part_reserve',
  release_reservation: 'inventory.part_release',
  propose_line_item: 'workshop_order.propose_line',
  propose_registration_intake: 'registration_intake.apply',
  propose_workshop_booking: 'workshop.booking_package',
  propose_purchase_order: 'purchase_order.propose_draft',
  propose_workshop_order_completion: 'workshop_order.complete',
  propose_invoice_draft_from_order: 'invoice.create_draft_from_workshop_order',
  propose_estimate_send: 'workshop_estimate.send',
  request_workshop_media_upload: 'workshop.media_upload_slot',
  propose_mechanic_finding: 'workshop_order.propose_mechanic_finding',
  propose_customer_create: 'customer.create',
  propose_customer_update: 'customer.update',
  generate_weekly_report_pdf: 'report.generate_weekly_pdf',
};

export function resolveMcpWriteToolPendingActionType(
  tool: McpWriteToolName,
): PendingActionType {
  return MCP_WRITE_TOOL_PENDING_ACTION_TYPES[tool];
}
