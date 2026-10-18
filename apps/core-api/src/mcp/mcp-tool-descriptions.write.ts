import type { McpWriteToolName } from './mcp.constants.js';

const MCP_WRITE_DRY_RUN_HINT =
  ' Optional dry_run: true previews policy and effects without writing. | DE: Optional dry_run: true zeigt nur Vorschau ohne Schreiben.';

export const MCP_WRITE_TOOL_DESCRIPTIONS: Record<McpWriteToolName, string> = {
  draft_workshop_order: `Create a DRAFT/SCHEDULED workshop order (policy-checked, logged)${MCP_WRITE_DRY_RUN_HINT}`,
  reserve_part: `Reserve on-hand stock for a catalog-backed part line from a bin (the line needs a catalog_item_id; a free-text line fails with NOT_A_CATALOG_LINE); AUTO at or below policy amount_max (EUR 250 platform cap), PROPOSE above amount_max (reversible; counter-tool: release_reservation)${MCP_WRITE_DRY_RUN_HINT}`,
  release_reservation: `Release a parts reservation (counter-tool of reserve_part)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_line_item: `Propose a workshop task line item (PART, LABOR, or FEE; never executes; records a pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_registration_intake: `Propose applying a reviewed registration document intake (never executes; records a pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_workshop_booking: `Propose a scheduled workshop order with an optional reserved loaner booking and optional loaner_charge FEE line (never executes alone; records one pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_purchase_order: `Propose a DRAFT purchase order from verified local parts requisition demand (never sends externally; records one pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_workshop_order_completion: `Propose completing open workshop tasks on an order and moving it to a derived completed status when all tasks are done; optional ready-for-pickup email only when notify_customer is true and the action is applied (never finalizes invoices)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_invoice_draft_from_order: `Propose a DRAFT invoice from a COMPLETED workshop order (never finalizes, sends, or records payment; records one pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  propose_estimate_send: `Propose creating or revising a workshop estimate (KVA) and emailing the customer an online approval link (never sends without human apply; records one pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  request_workshop_media_upload: `Reserve a short-lived direct upload slot for workshop task media (jpeg, png, heic, or webp). Does not change workshop business state until a finding or other flow references the returned media_id${MCP_WRITE_DRY_RUN_HINT}`,
  propose_mechanic_finding: `Propose an additional mechanic finding with photos for advisor review (never sends customer messages; records one pending proposal)${MCP_WRITE_DRY_RUN_HINT}`,
  generate_weekly_report_pdf: `Render the internal weekly report PDF for one ISO calendar week (Monday through Sunday in the site timezone) and return a short-lived read link. Does not archive the PDF or send anything externally${MCP_WRITE_DRY_RUN_HINT}`,
};
