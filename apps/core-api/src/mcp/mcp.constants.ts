import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { NOT_A_CATALOG_LINE_CODE } from '../parts-requisition/parts-requisition.helpers.js';

export const MCP_SERVER_IMPLEMENTATION = {
  name: 'auto-core-platform-mcp',
  version: '1.0.0',
} as const;

export const MCP_DEFAULT_PAGE = 1;
export const MCP_DEFAULT_PAGE_SIZE = 10;
export const MCP_MAX_PAGE_SIZE = 25;

/**
 * get_capabilities pages the catalog at MCP_MAX_PAGE_SIZE. The catalog holds more tools than
 * one page, so a default call returns the first 25 and `meta.next_cursor` leads to the rest.
 */
export const MCP_CAPABILITIES_DEFAULT_PAGE_SIZE = MCP_MAX_PAGE_SIZE;

/** Max serialized tool result bytes returned to the MCP client. */
export const MCP_TOOL_RESULT_MAX_BYTES = 32_768;

export const MCP_MAX_OPEN_SESSIONS = 200;

export const MCP_ACTION_PREFIX = 'mcp';

export const MCP_READ_TOOL_NAMES = [
  'search_customers',
  'get_customer',
  'search_vehicles',
  'get_vehicle',
  'get_vehicle_listing_status',
  'list_workshop_orders',
  'get_workshop_order',
  'search_parts',
  'get_stock_level',
  'get_vehicle_stock_age_report',
  'get_vehicle_stock_margin_report',
  'list_invoices',
  'get_invoice',
  'list_bays',
  'list_bins',
  'list_workshop_tasks',
  'list_workshop_slots',
  'list_available_loaners',
  'whoami',
  'get_capabilities',
  'list_audit_events',
  'get_entity_history',
  'get_agent_action',
  'list_agent_actions',
  'get_vehicle_history',
  'get_vehicle_context',
  'list_documents',
  'get_document_pdf',
  'get_tenant_settings',
  'list_sites',
  'get_legal_entity',
  'list_purchase_orders',
  'get_purchase_order',
  'list_vendors',
  'list_catalog_items',
  'get_catalog_item',
  'list_price_lists',
  'list_margin_rules',
  'get_workshop_kpi_report',
  'get_revenue_report',
  'list_pickerl_due',
  'get_nova_preview',
] as const;

export type McpReadToolName = (typeof MCP_READ_TOOL_NAMES)[number];

/** Read tools that show other users' activity. Only the roles in MCP_SUPERVISOR_ROLES may call them. */
export const MCP_SUPERVISOR_READ_TOOL_NAMES = [
  'list_audit_events',
  'get_entity_history',
  'get_agent_action',
  'list_agent_actions',
] as const;

export const MCP_WRITE_TOOL_NAMES = [
  'draft_workshop_order',
  'reserve_part',
  'release_reservation',
  'propose_line_item',
  'propose_registration_intake',
  'propose_workshop_booking',
  'propose_purchase_order',
  'propose_workshop_order_completion',
  'propose_invoice_draft_from_order',
  'propose_estimate_send',
  'request_workshop_media_upload',
  'propose_mechanic_finding',
  'generate_weekly_report_pdf',
] as const;

export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];

export const MCP_TOOL_NAMES = [
  ...MCP_READ_TOOL_NAMES,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Existing MCP write outcomes and errors that agent-facing docs may name. */
export const MCP_AGENT_FACING_CODES = {
  executedStatus: 'executed',
  needsApprovalStatus: 'needs_approval',
  refusedLogStatus: 'REFUSED',
  notPermitted: 'not_permitted',
  notCatalogLine: NOT_A_CATALOG_LINE_CODE,
  forbidden: ForbiddenException.name,
  forbiddenHttpStatus: HttpStatus.FORBIDDEN,
  invalidInput: ZodError.name,
  notFound: NotFoundException.name,
  conflict: ConflictException.name,
} as const;

/**
 * Capabilities that must never be exposed as MCP tools. Each value mirrors a
 * policy action type (or category) that the agent policy floor already keeps
 * HUMAN_ONLY or that is intentionally withheld from agent automation.
 */
export const MCP_NEVER_EXPOSED_ACTIONS = [
  'invoice.finalize',
  'invoice.cancel',
  'invoice.send',
  'credit_note.create',
  'credit_note.issue',
  'credit_note.finalize',
  'accounting_export.create',
  'accounting_export.submit',
  'customer.delete',
  'vehicle.delete',
  'workshop_order.delete',
  'tenant_member.role_change',
  'tenant_member.invite',
  'consent.update',
  'consent.revoke',
  'legal_entity.update',
  'tax_rate.update',
  'number_range.update',
  'payment.record',
  'fiscal_receipt.sign',
  'fiscal_receipt.cancel',
] as const;
