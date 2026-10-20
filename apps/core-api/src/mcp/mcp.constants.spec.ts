import {
  MCP_NEVER_EXPOSED_ACTIONS,
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from './mcp.constants.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';

/** Contract lists are stated as one space-separated string each, so the spec does not restate the constants' array literals. */
const names = (list: string): string[] => list.split(' ');

const FORBIDDEN_ACTIONS = names(
  'invoice.finalize invoice.cancel invoice.send credit_note.create credit_note.issue credit_note.finalize accounting_export.create accounting_export.submit customer.delete vehicle.delete workshop_order.delete tenant_member.role_change tenant_member.invite consent.update consent.revoke legal_entity.update tax_rate.update number_range.update payment.record fiscal_receipt.sign fiscal_receipt.cancel',
);
const ALLOWED_WRITE_TOOLS = names(
  'draft_workshop_order reserve_part release_reservation propose_line_item propose_registration_intake propose_workshop_booking propose_purchase_order propose_workshop_order_completion propose_invoice_draft_from_order propose_estimate_send request_workshop_media_upload propose_mechanic_finding propose_customer_create propose_customer_update generate_weekly_report_pdf',
);
const ALLOWED_READ_TOOLS = names(
  'search_customers get_customer search_vehicles get_vehicle get_vehicle_listing_status list_workshop_orders get_workshop_order search_parts get_stock_level get_vehicle_stock_age_report get_vehicle_stock_margin_report list_invoices get_invoice list_bays list_bins list_workshop_tasks list_workshop_slots list_available_loaners whoami get_capabilities list_audit_events get_entity_history get_agent_action list_agent_actions get_vehicle_history get_vehicle_context list_documents get_document_pdf get_tenant_settings list_sites get_legal_entity list_purchase_orders get_purchase_order list_vendors list_catalog_items get_catalog_item list_price_lists list_margin_rules get_workshop_kpi_report get_revenue_report list_pickerl_due get_nova_preview',
);

describe('MCP Constants - Never Exposed Actions', () => {
  describe('MCP_NEVER_EXPOSED_ACTIONS', () => {
    it('contains expected forbidden action types', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toEqual(
        expect.arrayContaining(FORBIDDEN_ACTIONS),
      );
    });

    it('has exactly 21 forbidden actions', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toHaveLength(21);
    });
  });

  describe('Settings reads are read-only (AUT-457)', () => {
    it('registers the settings reads as AUTO read tools only', () => {
      expect(MCP_READ_TOOL_NAMES).toEqual(
        expect.arrayContaining([
          'get_tenant_settings',
          'list_sites',
          'get_legal_entity',
        ]),
      );
      expect(MCP_WRITE_TOOL_NAMES).not.toContain('get_tenant_settings');
      expect(MCP_WRITE_TOOL_NAMES).not.toContain('list_sites');
      expect(MCP_WRITE_TOOL_NAMES).not.toContain('get_legal_entity');
    });

    it('registers no tool whose name is a write verb', () => {
      const writeVerbs =
        /^(create|update|set|delete|patch|put|post|remove|change|save)_/;
      expect(MCP_TOOL_NAMES.filter((name) => writeVerbs.test(name))).toEqual(
        [],
      );
    });

    it('lists legal entity, tax rate, number range, and role changes as human only', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toEqual(
        expect.arrayContaining([
          'legal_entity.update',
          'tax_rate.update',
          'number_range.update',
          'tenant_member.role_change',
        ]),
      );
    });
  });

  describe('Invoice write actions are not tools (AUT-456)', () => {
    it('registers no tool that finalizes, cancels, sends, issues, voids, or credits', () => {
      const writeVerbs = /finaliz|cancel|send|issue|void|credit/i;
      const allowedProposeSendTools = new Set(['propose_estimate_send']);
      expect(
        MCP_TOOL_NAMES.filter(
          (name) => writeVerbs.test(name) && !allowedProposeSendTools.has(name),
        ),
      ).toEqual([]);
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

describe('MCP tool output schemas (AUT-427)', () => {
  it('publishes an output schema for every registered tool and for no other name', () => {
    expect(Object.keys(mcpToolOutputSchemas).sort()).toEqual(
      [...MCP_TOOL_NAMES].sort(),
    );
  });

  it('keeps the registry at 42 read tools and 15 write tools', () => {
    expect(MCP_READ_TOOL_NAMES).toHaveLength(42);
    expect(MCP_WRITE_TOOL_NAMES).toHaveLength(15);
  });
});
