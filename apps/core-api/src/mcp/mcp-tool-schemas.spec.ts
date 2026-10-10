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

const VEHICLE_ID = '00000000-0000-4000-8000-000000000099';
const BAY_ID = '00000000-0000-4000-8000-000000000098';
const validDraft = {
  vehicle_id: VEHICLE_ID,
  bay_id: BAY_ID,
  scheduled_start_at: '2026-10-12T09:00:00.000Z',
  scheduled_end_at: '2026-10-12T10:00:00.000Z',
};

/** Every row must be rejected by its schema; the table keeps each rejected input next to its schema. */
const REJECTED_INPUTS: Array<[string, { parse: (input: unknown) => unknown }, unknown]> = [
  ['search_customers page size above 25', searchCustomersInputSchema, { page_size: 26 }],
  ['get_stock_level without an ID or SKU', getStockLevelInputSchema, {}],
  ['stock age page size above 25', getVehicleStockAgeReportInputSchema, { page_size: 26 }],
  ['margin report with a non-ISO date', getVehicleStockMarginReportInputSchema, { from: 'October', to: '2026-10-31' }],
  ['get_capabilities page size above 25', getCapabilitiesInputSchema, { pageSize: 26 }],
  ['get_capabilities page size of zero', getCapabilitiesInputSchema, { pageSize: 0 }],
  ['list_audit_events page size above 25', listAuditEventsInputSchema, { pageSize: 26 }],
  ['list_audit_events cursor that is not a cursor', listAuditEventsInputSchema, { cursor: 'bad cursor!' }],
  ['list_audit_events entity type with SQL', listAuditEventsInputSchema, { entity_type: 'Customer; DROP TABLE' }],
  ['list_audit_events non-UUID trace ID', listAuditEventsInputSchema, { trace_id: 'trace-1' }],
  ['list_agent_actions unregistered tool', listAgentActionsInputSchema, { tool: 'delete_customer' }],
  ['list_agent_actions unknown tier', listAgentActionsInputSchema, { tier: 'NOPE' }],
  ['list_agent_actions unknown status', listAgentActionsInputSchema, { status: 'DONE' }],
  ['get_agent_action without a trace ID', getAgentActionInputSchema, {}],
  ['get_entity_history without an entity ID', getEntityHistoryInputSchema, { entity_type: 'Customer' }],
  ['get_entity_history page size of zero', getEntityHistoryInputSchema, { entity_type: 'Customer', entity_id: 'cust-1', pageSize: 0 }],
  ['get_capabilities cursor that is not a cursor', getCapabilitiesInputSchema, { cursor: 'bad cursor!' }],
  ['get_capabilities cursor of another encoding', getCapabilitiesInputSchema, { cursor: Buffer.from('abc').toString('base64url') }],
  ['draft workshop order with status DRAFT', draftWorkshopOrderInputSchema, { ...validDraft, status: 'DRAFT' }],
  ['draft workshop order with status INTAKE', draftWorkshopOrderInputSchema, { ...validDraft, status: 'INTAKE' }],
];

describe('MCP tool input schemas', () => {
  it.each(REJECTED_INPUTS)('rejects %s', (_label, schema, input) => {
    expect(() => schema.parse(input)).toThrow();
  });

  it('validates search_customers paging bounds', () => {
    const largestPage = { page: 1, page_size: 25 };
    expect(searchCustomersInputSchema.parse(largestPage)).toEqual(largestPage);
  });

  it('validates get_customer uuid', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(getCustomerInputSchema.parse({ customer_id: id })).toEqual({
      customer_id: id,
    });
  });

  it('accepts a SKU for get_stock_level', () => {
    expect(getStockLevelInputSchema.parse({ sku: 'MPN-1' })).toEqual({
      sku: 'MPN-1',
    });
  });

  it('validates stock age report filters and page size', () => {
    expect(
      getVehicleStockAgeReportInputSchema.parse({
        inventory_role: 'USED',
        bucket: 'over_90',
        page_size: 25,
      }),
    ).toEqual({ inventory_role: 'USED', bucket: 'over_90', page_size: 25 });
  });

  it('validates ISO dates for the margin report', () => {
    expect(
      getVehicleStockMarginReportInputSchema.parse({
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('rejects unknown fields on MCP write tool schemas', () => {
    const scheduledDraft = { ...validDraft, status: 'SCHEDULED' as const };
    expect(draftWorkshopOrderInputSchema.parse(scheduledDraft)).toEqual(
      scheduledDraft,
    );
    expect(() =>
      draftWorkshopOrderInputSchema.parse({ ...scheduledDraft, dry_run: true }),
    ).toThrow(/unrecognized/i);

    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      const schema = mcpWriteToolInputSchemas[toolName];
      expect(() => schema.parse({ dry_run: true })).toThrow();
    }
  });

  it('accepts only SCHEDULED as the draft workshop order status', () => {
    expect(
      draftWorkshopOrderInputSchema.parse({ ...validDraft, status: 'SCHEDULED' }),
    ).toMatchObject({ status: 'SCHEDULED' });
  });

  it('accepts whoami with no input', () => {
    expect(whoamiInputSchema.parse({})).toEqual({});
  });

  it('accepts get_capabilities pageSize of 25', () => {
    expect(getCapabilitiesInputSchema.parse({ pageSize: 25 })).toEqual({
      pageSize: 25,
    });
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

  it('rejects a reversed range on audit events and agent actions', () => {
    expect(() =>
      listAuditEventsInputSchema.parse({ from: '2026-10-10', to: '2026-10-01' }),
    ).toThrow(/must not be after to/);
    expect(() =>
      listAgentActionsInputSchema.parse({ from: '2026-10-10', to: '2026-10-01' }),
    ).toThrow(/must not be after to/);
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
  });

  it('requires a trace ID for get_agent_action and an entity type and ID for get_entity_history', () => {
    const traceId = '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f';

    expect(getAgentActionInputSchema.parse({ trace_id: traceId })).toEqual({
      trace_id: traceId,
    });
  });

  it('accepts only cursors issued by encodeMcpCursor for get_capabilities', () => {
    const cursor = encodeMcpCursor(10);
    expect(getCapabilitiesInputSchema.parse({ cursor })).toEqual({ cursor });
  });
});
