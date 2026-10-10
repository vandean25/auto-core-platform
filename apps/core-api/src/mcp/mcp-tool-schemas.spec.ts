import { MCP_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import { encodeMcpCursor, encodeMcpKeysetCursor } from './mcp-output.util.js';
import {
  draftWorkshopOrderInputSchema,
  getAgentActionInputSchema,
  getCapabilitiesInputSchema,
  getCustomerInputSchema,
  getEntityHistoryInputSchema,
  getStockLevelInputSchema,
  listAgentActionsInputSchema,
  listAuditEventsInputSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  mcpWriteToolInputSchemas,
  searchCustomersInputSchema,
  whoamiInputSchema,
} from './mcp-tool-schemas.js';

describe('MCP tool input schemas', () => {
  it('validates search_customers paging bounds', () => {
    expect(
      searchCustomersInputSchema.parse({ page: 1, page_size: 25 }),
    ).toEqual({ page: 1, page_size: 25 });
    expect(() => searchCustomersInputSchema.parse({ page_size: 26 })).toThrow();
  });

  it('validates get_customer uuid', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(getCustomerInputSchema.parse({ customer_id: id })).toEqual({
      customer_id: id,
    });
  });

  it('requires catalog_item_id or sku for get_stock_level', () => {
    expect(() => getStockLevelInputSchema.parse({})).toThrow();
    expect(
      getStockLevelInputSchema.parse({ sku: 'MPN-1' }),
    ).toEqual({ sku: 'MPN-1' });
  });

  it('validates stock age report filters and page size', () => {
    expect(getVehicleStockAgeReportInputSchema.parse({
      inventory_role: 'USED', bucket: 'over_90', page_size: 25,
    })).toEqual({ inventory_role: 'USED', bucket: 'over_90', page_size: 25 });
    expect(() => getVehicleStockAgeReportInputSchema.parse({ page_size: 26 })).toThrow();
  });

  it('validates ISO dates for the margin report', () => {
    expect(getVehicleStockMarginReportInputSchema.parse({
      from: '2026-10-01', to: '2026-10-31',
    })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(() => getVehicleStockMarginReportInputSchema.parse({
      from: 'October', to: '2026-10-31',
    })).toThrow();
  });

  it('rejects unknown fields on MCP write tool schemas', () => {
    const vehicleId = '00000000-0000-4000-8000-000000000099';
    const validDraft = {
      vehicle_id: vehicleId,
      status: 'SCHEDULED' as const,
      bay_id: '00000000-0000-4000-8000-000000000098',
      scheduled_start_at: '2026-10-12T09:00:00.000Z',
      scheduled_end_at: '2026-10-12T10:00:00.000Z',
    };

    expect(draftWorkshopOrderInputSchema.parse(validDraft)).toEqual(validDraft);
    expect(() =>
      draftWorkshopOrderInputSchema.parse({ ...validDraft, dry_run: true }),
    ).toThrow(/unrecognized/i);

    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      const schema = mcpWriteToolInputSchemas[toolName];
      expect(() => schema.parse({ dry_run: true })).toThrow();
    }
  });

  it('accepts only SCHEDULED as the draft workshop order status', () => {
    const validDraft = {
      vehicle_id: '00000000-0000-4000-8000-000000000099',
      bay_id: '00000000-0000-4000-8000-000000000098',
      scheduled_start_at: '2026-10-12T09:00:00.000Z',
      scheduled_end_at: '2026-10-12T10:00:00.000Z',
    };

    expect(
      draftWorkshopOrderInputSchema.parse({ ...validDraft, status: 'SCHEDULED' }),
    ).toMatchObject({ status: 'SCHEDULED' });
    expect(() =>
      draftWorkshopOrderInputSchema.parse({ ...validDraft, status: 'DRAFT' }),
    ).toThrow();
    expect(() =>
      draftWorkshopOrderInputSchema.parse({ ...validDraft, status: 'INTAKE' }),
    ).toThrow();
  });

  it('accepts whoami with no input', () => {
    expect(whoamiInputSchema.parse({})).toEqual({});
  });

  it('bounds get_capabilities pageSize to 1 through 25', () => {
    expect(getCapabilitiesInputSchema.parse({ pageSize: 25 })).toEqual({
      pageSize: 25,
    });
    expect(() => getCapabilitiesInputSchema.parse({ pageSize: 26 })).toThrow();
    expect(() => getCapabilitiesInputSchema.parse({ pageSize: 0 })).toThrow();
  });

  it('validates list_audit_events filters, page size, and keyset cursor', () => {
    const cursor = encodeMcpKeysetCursor({
      at: '2026-10-10T08:00:00.000Z',
      id: '00000000-0000-4000-8000-0000000000a1',
    });

    expect(
      listAuditEventsInputSchema.parse({
        entity_type: 'Customer',
        entity_id: 'cust-1',
        actor: '00000000-0000-4000-8000-0000000000b1',
        action: 'UPDATE',
        from: '2026-10-01',
        to: '2026-10-31',
        trace_id: '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f',
        pageSize: 25,
        cursor,
      }),
    ).toMatchObject({ entity_type: 'Customer', pageSize: 25, cursor });
    expect(() => listAuditEventsInputSchema.parse({ pageSize: 26 })).toThrow();
    expect(() =>
      listAuditEventsInputSchema.parse({ cursor: 'bad cursor!' }),
    ).toThrow();
  });

  it('drops a tenant_id supplied in read arguments instead of using it', () => {
    expect(
      listAuditEventsInputSchema.parse({ tenant_id: 'tenant-b' }),
    ).not.toHaveProperty('tenant_id');
    expect(
      getEntityHistoryInputSchema.parse({
        entity_type: 'Customer',
        entity_id: 'cust-1',
        tenant_id: 'tenant-b',
      }),
    ).not.toHaveProperty('tenant_id');
  });

  it('rejects a reversed range, a malformed entity type, and a non-UUID trace ID', () => {
    expect(() =>
      listAuditEventsInputSchema.parse({ from: '2026-10-10', to: '2026-10-01' }),
    ).toThrow(/must not be after to/);
    expect(() =>
      listAgentActionsInputSchema.parse({ from: '2026-10-10', to: '2026-10-01' }),
    ).toThrow(/must not be after to/);
    expect(() =>
      listAuditEventsInputSchema.parse({ entity_type: 'Customer; DROP TABLE' }),
    ).toThrow();
    expect(() =>
      listAuditEventsInputSchema.parse({ trace_id: 'trace-1' }),
    ).toThrow();
  });

  it('accepts a same-day range because a bare to date includes its whole day', () => {
    expect(
      listAgentActionsInputSchema.parse({ from: '2026-10-10', to: '2026-10-10' }),
    ).toMatchObject({ from: '2026-10-10', to: '2026-10-10' });
  });

  it('accepts only registered tools and documented tiers and statuses as agent action filters', () => {
    expect(MCP_TOOL_NAMES).toContain('reserve_part');
    expect(
      listAgentActionsInputSchema.parse({
        agent: 'mcp:cursor',
        tool: 'reserve_part',
        tier: 'PROPOSE',
        status: 'PROPOSED',
      }),
    ).toMatchObject({ tool: 'reserve_part' });
    expect(() =>
      listAgentActionsInputSchema.parse({ tool: 'delete_customer' }),
    ).toThrow();
    expect(() => listAgentActionsInputSchema.parse({ tier: 'NOPE' })).toThrow();
    expect(() => listAgentActionsInputSchema.parse({ status: 'DONE' })).toThrow();
  });

  it('requires a trace ID for get_agent_action and an entity type and ID for get_entity_history', () => {
    const traceId = '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f';

    expect(getAgentActionInputSchema.parse({ trace_id: traceId })).toEqual({
      trace_id: traceId,
    });
    expect(() => getAgentActionInputSchema.parse({})).toThrow();
    expect(() =>
      getEntityHistoryInputSchema.parse({ entity_type: 'Customer' }),
    ).toThrow();
    expect(() =>
      getEntityHistoryInputSchema.parse({
        entity_type: 'Customer',
        entity_id: 'cust-1',
        pageSize: 0,
      }),
    ).toThrow();
  });

  it('accepts only cursors issued by encodeMcpCursor for get_capabilities', () => {
    const cursor = encodeMcpCursor(10);
    expect(getCapabilitiesInputSchema.parse({ cursor })).toEqual({ cursor });
    expect(() =>
      getCapabilitiesInputSchema.parse({ cursor: 'bad cursor!' }),
    ).toThrow();
    expect(() =>
      getCapabilitiesInputSchema.parse({
        cursor: Buffer.from('abc').toString('base64url'),
      }),
    ).toThrow();
  });
});
