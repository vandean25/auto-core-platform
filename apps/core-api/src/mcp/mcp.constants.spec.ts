import { MCP_READ_TOOL_NAMES, MCP_WRITE_TOOL_NAMES, MCP_TOOL_NAMES, MCP_NEVER_EXPOSED_ACTIONS } from './mcp.constants.js';

describe('MCP Constants - Never Exposed Actions', () => {
  describe('MCP_NEVER_EXPOSED_ACTIONS', () => {
    it('contains expected forbidden action types', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('invoice.finalize');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('credit_note.issue');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('credit_note.finalize');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('accounting_export.create');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('accounting_export.submit');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('customer.delete');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('vehicle.delete');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('workshop_order.delete');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('tenant_member.role_change');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('tenant_member.invite');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('consent.update');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('consent.revoke');
      expect(MCP_NEVER_EXPOSED_ACTIONS).toContain('estimate.send_customer_message');
    });

    it('has exactly 13 forbidden actions', () => {
      expect(MCP_NEVER_EXPOSED_ACTIONS).toHaveLength(13);
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
      const allowedWriteTools = [
        'draft_workshop_order',
        'reserve_part',
        'release_reservation',
        'propose_line_item',
      ];
      expect(MCP_WRITE_TOOL_NAMES).toEqual(allowedWriteTools);
    });

    it('MCP_READ_TOOL_NAMES only contains allowed read tools', () => {
      const allowedReadTools = [
        'search_customers',
        'get_customer',
        'search_vehicles',
        'get_vehicle',
        'list_workshop_orders',
        'get_workshop_order',
        'search_parts',
        'get_stock_level',
        'get_vehicle_stock_age_report',
        'get_vehicle_stock_margin_report',
        'list_bays',
        'list_bins',
        'list_workshop_tasks',
        'whoami',
        'get_capabilities',
        'list_audit_events',
        'get_entity_history',
        'get_agent_action',
        'list_agent_actions',
      ];
      expect(MCP_READ_TOOL_NAMES).toEqual(allowedReadTools);
    });
  });
});
