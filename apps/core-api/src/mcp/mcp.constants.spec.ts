import {
  MCP_NEVER_EXPOSED_ACTIONS,
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from './mcp.constants.js';

/** Contract lists are stated as one space-separated string each, so the spec does not restate the constants' array literals. */
const names = (list: string): string[] => list.split(' ');

const FORBIDDEN_ACTIONS = names(
  'invoice.finalize invoice.cancel invoice.send credit_note.create credit_note.issue credit_note.finalize accounting_export.create accounting_export.submit customer.delete vehicle.delete workshop_order.delete tenant_member.role_change tenant_member.invite consent.update consent.revoke estimate.send_customer_message',
);
const ALLOWED_WRITE_TOOLS = names(
  'draft_workshop_order reserve_part release_reservation propose_line_item',
);
const ALLOWED_READ_TOOLS = names(
  'search_customers get_customer search_vehicles get_vehicle list_workshop_orders get_workshop_order search_parts get_stock_level get_vehicle_stock_age_report get_vehicle_stock_margin_report list_invoices get_invoice list_bays list_bins list_workshop_tasks whoami get_capabilities list_audit_events get_entity_history get_agent_action list_agent_actions get_vehicle_history list_documents get_document_pdf',
);

describe('MCP Constants - Never Exposed Actions', () => {
  describe('MCP_NEVER_EXPOSED_ACTIONS', () => {
    it('contains expected forbidden action types', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toEqual(
        expect.arrayContaining(FORBIDDEN_ACTIONS),
      );
    });

    it('has exactly 16 forbidden actions', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toHaveLength(16);
    });
  });

  describe('Invoice write actions are not tools (AUT-456)', () => {
    it('registers no tool that finalizes, cancels, sends, issues, voids, or credits', () => {
      const writeVerbs = /finaliz|cancel|send|issue|void|credit/i;
      expect(MCP_TOOL_NAMES.filter((name) => writeVerbs.test(name))).toEqual(
        [],
      );
    });

    it('registers the invoice reads as AUTO read tools only', () => {
      expect(MCP_READ_TOOL_NAMES).toEqual(
        expect.arrayContaining(['list_invoices', 'get_invoice']),
      );
      expect(MCP_WRITE_TOOL_NAMES).not.toContain('list_invoices');
      expect(MCP_WRITE_TOOL_NAMES).not.toContain('get_invoice');
    });
  });

  describe('Tool lists never expose forbidden actions', () => {
    it('MCP_READ_TOOL_NAMES does not contain any forbidden action', () => {
      for (const forbidden of MCP_NEVER_EXPOSED_ACTIONS) {
        expect(MCP_READ_TOOL_NAMES).not.toContain(forbidden);
      }
    });

    it('MCP_WRITE_TOOL_NAMES does not contain any forbidden action', () => {
      for (const forbidden of MCP_NEVER_EXPOSED_ACTIONS) {
        expect(MCP_WRITE_TOOL_NAMES).not.toContain(forbidden);
      }
    });

    it('MCP_TOOL_NAMES does not contain any forbidden action', () => {
      for (const forbidden of MCP_NEVER_EXPOSED_ACTIONS) {
        expect(MCP_TOOL_NAMES).not.toContain(forbidden);
      }
    });

    it('MCP_WRITE_TOOL_NAMES only contains allowed write tools', () => {
      expect(MCP_WRITE_TOOL_NAMES).toEqual(ALLOWED_WRITE_TOOLS);
    });

    it('MCP_READ_TOOL_NAMES only contains allowed read tools', () => {
      expect(MCP_READ_TOOL_NAMES).toEqual(ALLOWED_READ_TOOLS);
    });
  });
});
