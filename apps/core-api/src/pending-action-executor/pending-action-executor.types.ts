import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import type { McpWriteToolResult } from '../mcp/mcp-write-pipeline.service.js';

export type PendingActionType =
  | 'workshop_order.create'
  | 'workshop.booking_package'
  | 'purchase_order.propose_draft'
  | 'workshop_task.reserve_part'
  | 'inventory.part_reserve'
  | 'workshop_task.release_reservation'
  | 'inventory.part_release'
  | 'workshop_order.propose_line'
  | 'workshop_order.add_line'
  | 'customer.create'
  | 'customer.update'
  | 'decision.import_row_match'
  | 'decision.document_sort'
  | 'registration_intake.apply'
  | 'workshop_order.mechanic_finding'
  | 'workshop_order.propose_mechanic_finding'
  | 'workshop.media_upload_slot'
  | 'workshop_order.complete'
  | 'invoice.create_draft_from_workshop_order'
  | 'workshop_estimate.send'
  | 'estimate.send_customer_message'
  | 'report.generate_weekly_pdf';

export type PendingActionExecutor = {
  actionType: PendingActionType;
  buildPolicyContext(input: unknown): Promise<AgentPolicyEvaluateContext>;
  buildExecutionContext?(input: unknown): Promise<Record<string, unknown>>;
  execute(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<unknown>;
  buildResultSummary(result: unknown): unknown;
  buildLogMetadata?(result: unknown): {
    entityType: string;
    entityId: string;
    reversible: boolean;
  };
  /** Side-effect-free MCP dry-run preview (skips rollback transaction execute). */
  preview?(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<unknown>;
  /** Builds the proposal payload the MCP write path stores and applies. */
  enrichInput?(input: unknown): Promise<unknown>;
  /** Masks the proposal payload for the tool result and the action log. */
  maskProposalPayload?(payload: unknown): unknown;
  /** Masks the raw tool arguments for the action log. */
  maskLoggedArgs?(args: unknown): unknown;
  /** When true, real execute runs before the agent-action log transaction. */
  executeOutsideTransaction?: boolean;
  refreshReplayResult?(result: McpWriteToolResult): Promise<McpWriteToolResult>;
};
