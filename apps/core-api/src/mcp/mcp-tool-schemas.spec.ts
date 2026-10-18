import { Prisma, CustomerType, InvoiceStatus, InvoiceTaxMode, PurchaseOrderStatus } from '@prisma/client';
import type { z } from 'zod';
import { MCP_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from './mcp.constants.js';
import {
  encodeMcpCursor,
  encodeMcpKeysetCursor,
  toMcpJsonObject,
} from './mcp-output.util.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { toMcpInvoiceDetail } from './mcp-invoice-read.mapper.js';
import {
  toMcpPurchaseOrderDetail,
  toMcpPurchaseOrderListRow,
} from './mcp-purchasing-read.mapper.js';
import { toMcpDocumentPdf, toMcpDocumentRow } from './mcp-document-read.mapper.js';
import {
  draftWorkshopOrderInputSchema,
  mcpWriteToolInputSchemas,
} from './mcp-tool-schemas.write.js';
import {
  getAgentActionInputSchema,
  getCapabilitiesInputSchema,
  getCustomerInputSchema,
  getEntityHistoryInputSchema,
  getStockLevelInputSchema,
  listAgentActionsInputSchema,
  listAuditEventsInputSchema,
  getNovaPreviewInputSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  getRevenueReportInputSchema,
  getWorkshopKpiReportInputSchema,
  listPickerlDueInputSchema,
  listWorkshopOrdersInputSchema,
  searchCustomersInputSchema,
  whoamiInputSchema,
} from './mcp-tool-schemas.js';

const VEHICLE_ID = '00000000-0000-4000-8000-000000000099';
const BAY_ID = '00000000-0000-4000-8000-000000000098';
const SITE_ID = '00000000-0000-4000-8000-000000000097';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-00000000000b';
const validDraft = {
  vehicle_id: VEHICLE_ID,
  bay_id: BAY_ID,
  scheduled_start_at: '2026-10-12T09:00:00.000Z',
  scheduled_end_at: '2026-10-12T10:00:00.000Z',
};

/** Every row must be rejected by its schema; the table keeps each rejected input next to its schema. */
const REJECTED_INPUTS: Array<[string, { parse: (input: unknown) => unknown }, unknown]> = [
  ['search_customers page size above 25', searchCustomersInputSchema, { pageSize: 26 }],
  ['get_stock_level without an ID or SKU', getStockLevelInputSchema, {}],
  ['stock age page size above 25', getVehicleStockAgeReportInputSchema, { pageSize: 26 }],
  ['stock age stock-in window with only from', getVehicleStockAgeReportInputSchema, { from: '2026-07-01' }],
  ['stock age stock-in window that ends before it starts', getVehicleStockAgeReportInputSchema, { from: '2026-07-31', to: '2026-07-01' }],
  ['stock age site that is not an ID', getVehicleStockAgeReportInputSchema, { site_id: 'site-a' }],
  ['stock age cursor that is not a cursor', getVehicleStockAgeReportInputSchema, { cursor: 'bad cursor!' }],
  ['margin report with a non-ISO date', getVehicleStockMarginReportInputSchema, { from: 'October', to: '2026-10-31' }],
  ['margin report without a period', getVehicleStockMarginReportInputSchema, { from: '2026-10-01' }],
  ['margin report that ends before it starts', getVehicleStockMarginReportInputSchema, { from: '2026-10-31', to: '2026-10-01' }],
  ['margin report page size above 25', getVehicleStockMarginReportInputSchema, { from: '2026-10-01', to: '2026-10-31', pageSize: 26 }],
  ['workshop KPI report without a period', getWorkshopKpiReportInputSchema, { from: '2026-10-01' }],
  ['workshop KPI report that ends before it starts', getWorkshopKpiReportInputSchema, { from: '2026-10-31', to: '2026-10-01' }],
  ['revenue report without a period', getRevenueReportInputSchema, { from: '2026-10-01' }],
  [
    'revenue report longer than 366 days',
    getRevenueReportInputSchema,
    { from: '2025-01-01', to: '2026-01-02' },
  ],
  ['Pickerl window of 45 days', listPickerlDueInputSchema, { window: 45 }],
  ['Pickerl page size above 25', listPickerlDueInputSchema, { pageSize: 26 }],
  ['Pickerl cursor that is not a cursor', listPickerlDueInputSchema, { cursor: 'bad cursor!' }],
  ['NoVA with a comma decimal', getNovaPreviewInputSchema, { vehicle_id: VEHICLE_ID, net_price_eur: '12000,00' }],
  ['NoVA with three decimal places', getNovaPreviewInputSchema, { vehicle_id: VEHICLE_ID, net_price_eur: '12000.005' }],
  ['NoVA with a negative price', getNovaPreviewInputSchema, { vehicle_id: VEHICLE_ID, net_price_eur: '-1.00' }],
  ['NoVA with a numeric price instead of a decimal string', getNovaPreviewInputSchema, { vehicle_id: VEHICLE_ID, net_price_eur: 12000 }],
  ['NoVA without a vehicle ID', getNovaPreviewInputSchema, { net_price_eur: '12000.00' }],
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
    const largestPage = { page: 1, pageSize: 25 };
    expect(searchCustomersInputSchema.parse(largestPage)).toEqual(largestPage);
  });

  it('validates list_workshop_orders estimate and date filters', () => {
    expect(
      listWorkshopOrdersInputSchema.parse({
        status: ['IN_PROGRESS'],
        estimate_status: 'SENT',
        sent_from: '2026-10-16',
        sent_to: '2026-10-16',
      }),
    ).toEqual({
      status: ['IN_PROGRESS'],
      estimate_status: 'SENT',
      sent_from: '2026-10-16',
      sent_to: '2026-10-16',
    });
    expect(() =>
      listWorkshopOrdersInputSchema.parse({ sent_from: '2026-10-16' }),
    ).toThrow();
  });

  it('drops the retired page_size name on offset list tools', () => {
    expect(searchCustomersInputSchema.parse({ page_size: 25 })).toEqual({});
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
        pageSize: 25,
      }),
    ).toEqual({ inventory_role: 'USED', bucket: 'over_90', pageSize: 25 });
  });

  it('drops the retired page_size name, so the default page size applies', () => {
    expect(getVehicleStockAgeReportInputSchema.parse({ page_size: 25 })).toEqual({});
  });

  it('validates the stock age stock-in window and site', () => {
    const input = {
      from: '2026-07-01',
      to: '2026-07-31',
      site_id: SITE_ID,
      stock_status: 'IN_STOCK',
    };
    expect(getVehicleStockAgeReportInputSchema.parse(input)).toEqual(input);
  });

  it('validates the workshop KPI period and site', () => {
    const input = { from: '2026-10-01', to: '2026-10-31', site_id: SITE_ID };
    expect(getWorkshopKpiReportInputSchema.parse(input)).toEqual(input);
  });

  it('accepts only the Pickerl windows of 30, 60, and 90 days, with 30 as the default', () => {
    expect(listPickerlDueInputSchema.parse({})).toEqual({});
    expect(listPickerlDueInputSchema.parse({ window: 90 })).toEqual({
      window: 90,
    });
  });

  it('accepts a NoVA net price as a EUR decimal string', () => {
    expect(
      getNovaPreviewInputSchema.parse({
        vehicle_id: VEHICLE_ID,
        net_price_eur: '12000.50',
      }),
    ).toEqual({ vehicle_id: VEHICLE_ID, net_price_eur: '12000.50' });
  });

  it('strips a tenant argument from the report reads, which take the tenant from the session', () => {
    expect(
      listPickerlDueInputSchema.parse({
        window: 60,
        tenant_id: OTHER_TENANT_ID,
      }),
    ).toEqual({ window: 60 });
    expect(
      getNovaPreviewInputSchema.parse({
        vehicle_id: VEHICLE_ID,
        net_price_eur: '1.00',
        tenant_id: OTHER_TENANT_ID,
      }),
    ).toEqual({ vehicle_id: VEHICLE_ID, net_price_eur: '1.00' });
  });

  it('validates ISO dates for the margin report', () => {
    expect(
      getVehicleStockMarginReportInputSchema.parse({
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('accepts dry_run on every MCP write tool input schema', () => {
    const scheduledDraft = { ...validDraft, status: 'SCHEDULED' as const };
    expect(
      draftWorkshopOrderInputSchema.parse({ ...scheduledDraft, dry_run: true }),
    ).toMatchObject({ dry_run: true });

    for (const toolName of MCP_WRITE_TOOL_NAMES) {
      const schema = mcpWriteToolInputSchemas[toolName];
      const parsed = schema.safeParse({ dry_run: true });
      if (parsed.success) {
        expect(parsed.data).toMatchObject({ dry_run: true });
        continue;
      }
      const rejectsDryRun = parsed.error.issues.some(
        (issue) =>
          issue.code === 'unrecognized_keys' &&
          'keys' in issue &&
          (issue.keys).includes('dry_run'),
      );
      expect(rejectsDryRun).toBe(false);
    }
  });

  it('rejects unknown fields on MCP write tool schemas', () => {
    const scheduledDraft = { ...validDraft, status: 'SCHEDULED' as const };
    expect(draftWorkshopOrderInputSchema.parse(scheduledDraft)).toEqual(
      scheduledDraft,
    );
    expect(() =>
      draftWorkshopOrderInputSchema.parse({
        ...scheduledDraft,
        unexpected_field: true,
      }),
    ).toThrow(/unrecognized/i);
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

describe('MCP tool output schemas (AUT-427)', () => {
  const truncatedResult = {
    __truncated__: true,
    originalBytes: 40_000,
    preview: '{"data":[{"id":"',
  };
  const emptyKeysetPage = {
    data: [],
    meta: { page_size: 10, next_cursor: null },
    truncated: false,
  };

  /** Asserts the value passes the schema, and reports the issues when it does not. */
  function expectValid(schema: z.ZodType, value: unknown) {
    const result = schema.safeParse(value);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  }

  function expectInvalid(schema: z.ZodType, value: unknown) {
    expect(schema.safeParse(value).success).toBe(false);
  }

  it('accepts a keyset page with its cursor and truncated flag', () => {
    expectValid(mcpToolOutputSchemas.list_invoices, emptyKeysetPage);
  });

  it('accepts list_workshop_orders offset meta with pageSize and pageCount', () => {
    expectValid(mcpToolOutputSchemas.list_workshop_orders, {
      data: [],
      meta: { total: 0, page: 1, pageSize: 10, pageCount: 0 },
    });
  });

  it('accepts the truncation marker from every tool, read and write', () => {
    for (const toolName of MCP_TOOL_NAMES) {
      expectValid(mcpToolOutputSchemas[toolName], truncatedResult);
    }
  });

  it('rejects a success body that lacks a required key', () => {
    expectInvalid(mcpToolOutputSchemas.list_invoices, { data: [] });
    expectInvalid(mcpToolOutputSchemas.get_stock_level, { sku: 'SKU-DEMO-1' });
  });

  it('rejects an amount written as a JSON number, because amounts are decimal strings', () => {
    expectInvalid(mcpToolOutputSchemas.list_invoices, {
      ...emptyKeysetPage,
      data: [
        {
          id: '7f0c6a4e-2a7b-4a53-9d0c-6a1e9a2b1c01',
          number: 'RE-2026-0001',
          status: 'ISSUED',
          customer: { id: 'c-1', name: 'Ada Lovelace' },
          issued_at: '2026-10-14T10:00:00.000Z',
          total_gross: 119,
          currency: 'EUR',
        },
      ],
    });
  });

  it('validates the invoice detail the mapper returns for a draft', () => {
    const detail = toMcpInvoiceDetail(
      {
        id: '7f0c6a4e-2a7b-4a53-9d0c-6a1e9a2b1c01',
        invoice_number: null,
        status: InvoiceStatus.DRAFT,
        tax_mode: InvoiceTaxMode.STANDARD,
        currency: 'EUR',
        date: new Date('2026-10-14T10:00:00.000Z'),
        due_date: new Date('2026-11-13T10:00:00.000Z'),
        total_net: new Prisma.Decimal('100'),
        total_tax: new Prisma.Decimal('19'),
        total_gross: new Prisma.Decimal('119'),
        global_discount_type: null,
        snapshot: null,
        workshop_order_id: null,
        sales_order_id: null,
        customer: {
          id: 'c-1',
          type: CustomerType.PRIVATE,
          company_name: null,
          first_name: 'Ada',
          last_name: 'Lovelace',
        },
        items: [
          {
            description: 'Oil service',
            quantity: new Prisma.Decimal('1'),
            unit_price: new Prisma.Decimal('100'),
            tax_rate: new Prisma.Decimal('19'),
            line_discount_type: null,
            line_discount_value: null,
          },
        ],
        credit_notes: [],
      },
      new Map(),
    );
    expectValid(mcpToolOutputSchemas.get_invoice, toMcpJsonObject(detail));
  });

  it('validates the purchase order detail and list row the mappers return', () => {
    const order = {
      id: '2b9d8f0a-6c1e-4f57-8a3e-0d5c7b9e1a02',
      order_number: 'PO-2026-0001',
      status: PurchaseOrderStatus.SENT,
      createdAt: new Date('2026-10-12T08:00:00.000Z'),
      vendor: { id: 'v-1', name: 'Demo Vendor' },
      items: [
        {
          id: 'i-1',
          quantity: new Prisma.Decimal('2'),
          quantity_received: new Prisma.Decimal('0'),
          unit_cost: new Prisma.Decimal('12.5'),
          catalog_item: { id: 'p-1', sku: 'FILTER-DEMO-01', name: 'Oil filter (demo)' },
        },
      ],
    };
    const detail = toMcpPurchaseOrderDetail(order, {
      movement_count: 0,
      last_received_at: null,
    });
    expectValid(mcpToolOutputSchemas.get_purchase_order, toMcpJsonObject(detail));
    expectValid(
      mcpToolOutputSchemas.list_purchase_orders,
      toMcpJsonObject({
        data: [toMcpPurchaseOrderListRow(order)],
        meta: { page_size: 10, next_cursor: null },
        truncated: false,
      }),
    );
  });

  it('validates a document row and a document PDF link from the document mappers', () => {
    const candidate = {
      type: 'invoice' as const,
      recordId: '7f0c6a4e-2a7b-4a53-9d0c-6a1e9a2b1c01',
      createdAt: new Date('2026-10-14T10:00:00.000Z'),
      name: 'invoice-RE-2026-0001.pdf',
    };
    expectValid(
      mcpToolOutputSchemas.list_documents,
      toMcpJsonObject({
        data: [toMcpDocumentRow(candidate)],
        meta: { page_size: 10, next_cursor: null },
        truncated: false,
      }),
    );
    expectValid(
      mcpToolOutputSchemas.get_document_pdf,
      toMcpJsonObject(
        toMcpDocumentPdf(candidate, {
          url: 'https://storage.example.invalid/signed',
          expiresAt: new Date('2026-10-14T10:15:00.000Z'),
        }),
      ),
    );
  });
});
