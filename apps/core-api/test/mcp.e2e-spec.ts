import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AgentActionLogService } from '../src/agent-action-log/agent-action-log.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_NEVER_EXPOSED_ACTIONS,
} from '../src/mcp/mcp.constants.js';
import { McpReadToolService } from '../src/mcp/mcp-read-tool.service.js';
import { McpSessionService } from '../src/mcp/mcp-session.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  seedTestEmployee,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
import { EmployeeRole, WorkshopMediaPurpose } from '@prisma/client';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';
import { PURCHASE_PROPOSE_DISCLAIMER } from '../src/purchase/purchase-propose-draft.service.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';

type ReadToolName = (typeof MCP_READ_TOOL_NAMES)[number];

type TenantFixtures = {
  searchToken: string;
  customerId: string;
  vehicleId: string;
  workshopOrderId: string;
  catalogItemId: string;
  sku: string;
  workshopTaskLineItemId: string;
  workshopTaskId: string;
  locationId: string;
  invoiceId: string;
  legalEntityId: string;
  siteId: string;
  vendorId: string;
  vendorName: string;
  vendorEmail: string;
  vendorAccountNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
};

type DraftVehicle = { customerId: string; vehicleId: string };

type MemberRole = 'ADMIN' | 'SALES' | 'TECH';

type ReadCall = { name: ReadToolName; arguments: Record<string, unknown> };

type McpSession = {
  client: Client;
  call: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<CallToolResult>;
  responseTraceIds: Array<string | null>;
};

/** The MCP client making a call: its bearer header, and the client name the agent log records. */
type McpCaller = { authHeader: string; clientName: string };

function caller(authHeader: string, clientName: string): McpCaller {
  return { authHeader, clientName };
}

/** One trace ID per read tool, in declaration order, so every read call can be found in the log by its trace. */
const TRACE_IDS = Object.fromEntries(
  MCP_READ_TOOL_NAMES.map((name, index) => [
    name,
    `00000000-0000-4000-8000-${(0x101 + index).toString(16).padStart(12, '0')}`,
  ]),
) as Record<ReadToolName, string>;

/** Tenant B probes the same read tools as tenant A, with unfiltered lists and a foreign entity ID. */
const TENANT_B_PROBE_ARGUMENTS: Partial<
  Record<ReadToolName, Record<string, unknown>>
> = {
  list_invoices: {},
  list_documents: {},
  list_purchase_orders: {},
  list_vendors: {},
  list_audit_events: {},
  get_entity_history: {
    entity_type: 'Customer',
    entity_id: '00000000-0000-4000-8000-0000000000ff',
  },
};

/** Read tools that must fail for tenant B, because their IDs belong to tenant A. */
const DETAIL_TOOLS_HIDDEN_FROM_OTHER_TENANT = [
  'get_customer',
  'get_vehicle',
  'get_vehicle_listing_status',
  'get_workshop_order',
  'get_stock_level',
  'get_invoice',
  'get_agent_action',
  'get_vehicle_history',
  'get_vehicle_context',
  'get_document_pdf',
  'get_legal_entity',
  'get_purchase_order',
  'get_catalog_item',
  'get_nova_preview',
];

describe('MCP server (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let previousMcpFlag: string | undefined;

  let tenantA: string;
  let tenantB: string;
  let adminHeaderA: string;
  let adminHeaderB: string;
  let salesHeaderA: string;
  let techHeaderA: string;
  let prismaA: PrismaService;
  let tenantAUserId: string;
  let fixtures: TenantFixtures;
  let workshopBayId: string;
  let pdfArchive: ReturnType<typeof createInMemoryPdfArchive>;
  const mockMechanicMediaStorage: Partial<MechanicMediaStorage> & {
    generateUploadPolicy: jest.Mock;
  } = {
    generateUploadPolicy: jest.fn(),
  };

  const mcpBaseUrl = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/mcp`;

  async function connectMcpClient(
    authHeader: string,
    clientName: string,
    traceId?: string,
  ): Promise<{
    client: Client;
    transport: StreamableHTTPClientTransport;
    responseTraceIds: Array<string | null>;
  }> {
    const headers: Record<string, string> = { Authorization: authHeader };
    if (traceId) {
      headers['X-Trace-Id'] = traceId;
    }
    const responseTraceIds: Array<string | null> = [];
    const transport = new StreamableHTTPClientTransport(new URL(mcpBaseUrl()), {
      requestInit: { headers },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        responseTraceIds.push(response.headers.get('X-Trace-Id'));
        return response;
      },
    });
    const client = new Client(
      { name: clientName, version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    return { client, transport, responseTraceIds };
  }

  /**
   * Ends the server session with a DELETE, then closes the client. The client's close() only aborts
   * the local request, so without the DELETE the server keeps the session until its idle sweep, and
   * the server refuses new sessions once MCP_MAX_OPEN_SESSIONS are open.
   */
  async function endMcpSession(
    transport: StreamableHTTPClientTransport,
  ): Promise<void> {
    try {
      if (transport.sessionId) {
        await transport.terminateSession();
      }
    } finally {
      await transport.close();
    }
  }

  /** Opens a session, runs the callback, and closes the session even when it throws. */
  async function withMcpSession<T>(
    authHeader: string,
    clientName: string,
    run: (session: McpSession) => Promise<T>,
    traceId?: string,
  ): Promise<T> {
    const { client, transport, responseTraceIds } = await connectMcpClient(
      authHeader,
      clientName,
      traceId,
    );
    const call = async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult;
    try {
      return await run({ client, call, responseTraceIds });
    } finally {
      await endMcpSession(transport);
    }
  }

  /** One tool call on its own session. */
  function callMcpTool(
    who: McpCaller,
    name: string,
    args: Record<string, unknown>,
    traceId?: string,
  ): Promise<CallToolResult> {
    return withMcpSession(
      who.authHeader,
      who.clientName,
      (session) => session.call(name, args),
      traceId,
    );
  }

  function toolPayloadText(result: CallToolResult): string {
    const textPart = result.content?.find(
      (entry) => entry.type === 'text' && 'text' in entry,
    );
    return typeof textPart?.text === 'string' ? textPart.text : '';
  }

  function parsePayload<T>(result: CallToolResult): T {
    return JSON.parse(toolPayloadText(result)) as T;
  }

  type CapabilityEntry = {
    tool: string;
    enabled: boolean;
    disabled_reason?: string;
  };
  type CapabilityPage = {
    data: CapabilityEntry[];
    meta: { next_cursor: string | null };
    human_only_actions: string[];
  };

  /**
   * Reads every get_capabilities page. The catalog holds more tools than one default page,
   * so a check on a write tool has to follow `meta.next_cursor`.
   */
  async function readAllCapabilities(
    callPage: (args: Record<string, unknown>) => Promise<CallToolResult>,
  ): Promise<CapabilityPage> {
    const pages: CapabilityPage[] = [];
    let cursor: string | null = null;
    do {
      const result = await callPage(cursor === null ? {} : { cursor });
      expect(result.isError).not.toBe(true);
      const page = parsePayload<CapabilityPage>(result);
      pages.push(page);
      cursor = page.meta.next_cursor;
    } while (cursor !== null);
    return {
      data: pages.flatMap((page) => page.data),
      meta: { next_cursor: null },
      human_only_actions: pages[0].human_only_actions,
    };
  }

  function stockAvailability(payload: string): number {
    return (JSON.parse(payload) as { quantity_available: number })
      .quantity_available;
  }

  async function readStockAvailability(
    clientName: string,
    traceId: string,
  ): Promise<number> {
    const result = await callMcpTool(
      caller(adminHeaderA, clientName),
      'get_stock_level',
      { sku: fixtures.sku },
      traceId,
    );
    expect(result.isError).not.toBe(true);
    return stockAvailability(toolPayloadText(result));
  }

  function assertPayloadExcludesTenantAIds(payload: string): void {
    expect(payload).not.toContain(fixtures.customerId);
    expect(payload).not.toContain(fixtures.vehicleId);
    expect(payload).not.toContain(fixtures.workshopOrderId);
    expect(payload).not.toContain(fixtures.catalogItemId);
    expect(payload).not.toContain(fixtures.legalEntityId);
    expect(payload).not.toContain(fixtures.siteId);
  }

  /** Runs a Prisma query with the tenant context active while the query is awaited. */
  function inTenant<T>(tenantId: string, query: () => Promise<T>): Promise<T> {
    return runWithTenantContext(tenantId, async () => await query());
  }

  /** Draft invoice with one line of quantity 1 at 20% tax, on the given site. */
  async function createDraftInvoice(input: {
    customerId: string;
    siteId: string;
    description: string;
    workshopOrderId?: string;
    date?: Date;
    unitPrice?: number;
  }): Promise<{ id: string }> {
    const net = input.unitPrice ?? 100;
    const tax = Number((net * 0.2).toFixed(2));
    return prismaA.invoice.create({
      data: {
        tenant_id: tenantA,
        customer_id: input.customerId,
        site_id: input.siteId,
        workshop_order_id: input.workshopOrderId ?? null,
        status: 'DRAFT',
        date: input.date ?? new Date(),
        due_date: new Date('2026-12-31T00:00:00.000Z'),
        currency: 'EUR',
        total_net: net,
        total_tax: tax,
        total_gross: net + tax,
        items: {
          create: [
            {
              tenant_id: tenantA,
              description: input.description,
              quantity: 1,
              unit_price: net,
              tax_rate: 20,
              line_total: net,
            },
          ],
        },
      },
      select: { id: true },
    });
  }

  /** Intake order with its own staging tote. The Prisma client passed in decides the tenant. */
  async function createIntakeOrder(
    db: PrismaService,
    input: {
      label: string;
      siteId: string;
      customerId: string;
      vehicleId: string;
    },
  ): Promise<{ id: string }> {
    const staging = await db.storageLocation.create({
      data: {
        site_id: input.siteId,
        code: `${input.label}-STAGING-${Date.now()}`,
        name: `${input.label} staging`,
        type: 'staging_tote',
      },
    });
    return db.workshopOrder.create({
      data: {
        order_number: `${input.label}-${Date.now()}`,
        customer_id: input.customerId,
        vehicle_id: input.vehicleId,
        site_id: input.siteId,
        staging_location_id: staging.id,
        odometer: 1000,
        fuel_level: 50,
        status: 'INTAKE',
      },
      select: { id: true },
    });
  }

  /** A PART line on a workshop task; the Prisma client passed in decides the tenant. */
  function createPartLine(
    db: PrismaService,
    workshopTaskId: string,
    part: {
      item_no: string;
      description: string;
      unit_price: number;
      catalog_item_id?: string;
    },
  ) {
    return db.workshopTaskLineItem.create({
      data: {
        workshop_task_id: workshopTaskId,
        type: 'PART',
        part_execution_status: 'PENDING_PICK',
        quantity: 1,
        ...part,
      },
    });
  }

  async function seedTenantAFixtures(): Promise<TenantFixtures> {
    const siteId = await resolveTestMainSiteId(prisma, tenantA);
    const searchToken = `McpE2e${Date.now()}`;
    const customer = await prismaA.customer.create({
      data: {
        first_name: 'Mcp',
        last_name: searchToken,
        email: `mcp-${Date.now()}@example.com`,
      },
    });
    const stagingLocation = await prismaA.storageLocation.create({
      data: {
        site_id: siteId,
        code: `MCP-TOTE-${searchToken}`,
        name: 'MCP test tote',
        type: 'staging_tote',
      },
    });
    const vehicle = await prismaA.vehicle.create({
      data: {
        make: 'Test',
        model: 'Mcp',
        year: 2020,
        vin: `VIN-${searchToken}`,
        customer_id: customer.id,
        co2_wltp_g_km: 120,
      },
    });
    const stockPurchase = await prismaA.vehiclePurchase.create({
      data: {
        tenant_id: tenantA,
        site_id: siteId,
        purchase_number: `VP-${searchToken}`,
        status: 'RECEIVED',
        seller_type: 'VENDOR',
        vehicle_id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        purchase_price: 5000,
        received_at: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await prismaA.vehicleListing.create({
      data: {
        tenant_id: tenantA,
        site_id: siteId,
        vehicle_id: vehicle.id,
        stock_purchase_id: stockPurchase.id,
        listing_ref: `L${randomUUID().replace(/-/g, '')}`,
        content_sha256: `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`,
        channels: {
          create: [
            {
              platform: 'MOBILE_DE',
              serializer_profile: 'MOBILE_DE_REFERENCE_V1',
              mapping_version: '1',
            },
          ],
        },
      },
    });
    const workshopOrder = await prismaA.workshopOrder.create({
      data: {
        order_number: `WO-${searchToken}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        site_id: siteId,
        staging_location_id: stagingLocation.id,
        odometer: 1000,
        fuel_level: 50,
        status: 'INTAKE',
        // A generated job card, so the document reads have a PDF to list and link.
        pdf_storage_bucket: 'e2e-pdf-archive',
        pdf_storage_key: `job-cards/${searchToken}.pdf`,
        pdf_generated_at: new Date('2026-10-02T09:00:00.000Z'),
      },
    });
    const sku = `SKU-${searchToken}`;
    const catalogItem = await prismaA.catalogItem.create({
      data: {
        sku,
        name: searchToken,
        cost_price: 1,
        retail_price: 2,
      },
    });
    const task = await prismaA.workshopTask.create({
      data: {
        tenant_id: tenantA,
        workshop_order_id: workshopOrder.id,
        title: 'Reservation fixture task',
        status: 'NOT_STARTED',
      },
    });
    const lineItem = await createPartLine(prismaA, task.id, {
      item_no: catalogItem.sku,
      description: catalogItem.name,
      unit_price: 2,
      catalog_item_id: catalogItem.id,
    });
    const location = await prismaA.storageLocation.create({
      data: {
        site_id: siteId,
        code: `MCP-${searchToken}`,
        name: 'MCP test bin',
        type: 'bin',
      },
    });
    await prismaA.inventoryStock.create({
      data: {
        catalog_item_id: catalogItem.id,
        site_id: siteId,
        location_id: location.id,
        quantity_on_hand: 3,
      },
    });
    const invoice = await createDraftInvoice({
      customerId: customer.id,
      workshopOrderId: workshopOrder.id,
      siteId,
      description: 'Ölwechsel inkl. Filter',
    });
    const mainSite = await prismaA.site.findFirstOrThrow({
      where: { id: siteId },
      select: { legal_entity_id: true },
    });
    const vendor = await prismaA.vendor.create({
      data: {
        tenant_id: tenantA,
        name: `Musterlieferant ${searchToken}`,
        email: `orders-${searchToken}@example.com`,
        account_number: `BANK-${searchToken}`,
      },
    });
    const purchaseOrder = await prismaA.purchaseOrder.create({
      data: {
        tenant_id: tenantA,
        site_id: siteId,
        vendor_id: vendor.id,
        status: 'SENT',
        order_number: `PO-${searchToken}`,
        items: {
          create: [
            {
              tenant_id: tenantA,
              catalog_item_id: catalogItem.id,
              quantity: 4,
              unit_cost: 12.5,
            },
          ],
        },
      },
    });
    return {
      searchToken,
      customerId: customer.id,
      vehicleId: vehicle.id,
      workshopOrderId: workshopOrder.id,
      catalogItemId: catalogItem.id,
      sku,
      workshopTaskLineItemId: lineItem.id,
      workshopTaskId: task.id,
      locationId: location.id,
      invoiceId: invoice.id,
      legalEntityId: mainSite.legal_entity_id,
      siteId,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorEmail: vendor.email,
      vendorAccountNumber: vendor.account_number,
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderNumber: purchaseOrder.order_number,
    };
  }

  async function putPolicyRule(
    actionType: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await request(app.getHttpServer())
      .put(`/api/agent-policy/rules/${actionType}`)
      .set('Authorization', adminHeaderA)
      .send(body)
      .expect(200);
  }

  async function setPolicyTier(
    actionType: string,
    tier: 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY',
    conditions?: { amount_max?: number | null },
  ): Promise<void> {
    await putPolicyRule(actionType, { tier, enabled: true, conditions });
  }

  async function setMemberRole(role: MemberRole): Promise<void> {
    await inTenant(tenantA, () =>
      prisma.tenantMember.update({
        where: {
          tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
        },
        data: { role },
      }),
    );
  }

  /** Runs the body as the tenant A user on the given role, then restores ADMIN. */
  async function asRole<T>(
    role: MemberRole,
    body: () => Promise<T>,
  ): Promise<T> {
    await setMemberRole(role);
    try {
      return await body();
    } finally {
      await setMemberRole('ADMIN');
    }
  }

  async function createDraftVehicle(prefix: string): Promise<DraftVehicle> {
    const customer = await prismaA.customer.create({
      data: {
        first_name: 'MCP',
        last_name: `${prefix}-${Date.now()}`,
        email: `${prefix}-${Date.now()}@example.com`,
      },
    });
    const vehicle = await prismaA.vehicle.create({
      data: {
        make: 'Test',
        model: prefix,
        year: 2022,
        vin: `VIN-${prefix}-${Date.now()}`,
        customer_id: customer.id,
      },
    });
    return { customerId: customer.id, vehicleId: vehicle.id };
  }

  function scheduledBooking(startHourUtc = 10): {
    bay_id: string;
    scheduled_start_at: string;
    scheduled_end_at: string;
  } {
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    while (start.getUTCDay() === 0 || start.getUTCDay() === 6) {
      start.setUTCDate(start.getUTCDate() + 1);
    }
    start.setUTCHours(startHourUtc, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      bay_id: workshopBayId,
      scheduled_start_at: start.toISOString(),
      scheduled_end_at: end.toISOString(),
    };
  }

  /** The customer and vehicle IDs that every draft_workshop_order call carries. */
  function vehicleRefs(vehicle: DraftVehicle): {
    customer_id: string;
    vehicle_id: string;
  } {
    return { customer_id: vehicle.customerId, vehicle_id: vehicle.vehicleId };
  }

  /** The valid draft_workshop_order arguments that most scenarios start from. */
  function draftOrderArgs(
    vehicle: DraftVehicle,
    startHourUtc?: number,
  ): Record<string, unknown> {
    return {
      customer_id: vehicle.customerId,
      vehicle_id: vehicle.vehicleId,
      purpose: 'CUSTOMER_REPAIR',
      status: 'SCHEDULED',
      ...scheduledBooking(startHourUtc),
      odometer: 1000,
      fuel_level: 50,
    };
  }

  /** An open task on the order (the fixture order by default), with its line-item version. */
  function createOpenTask(
    title: string,
    workshopOrderId = fixtures.workshopOrderId,
  ) {
    return prismaA.workshopTask.create({
      data: {
        tenant_id: tenantA,
        workshop_order_id: workshopOrderId,
        title,
        status: 'NOT_STARTED',
      },
      select: { id: true, line_items_version: true },
    });
  }

  function findActionLog(traceId: string, actionType: string) {
    return prismaA.agentActionLog.findFirst({
      where: { trace_id: traceId, action_type: actionType },
    });
  }

  async function expectActionLogRow(
    traceId: string,
    actionType: string,
    fields: { status?: string; tier?: string },
  ): Promise<void> {
    expect(
      await prismaA.agentActionLog.findFirst({
        where: { trace_id: traceId, action_type: actionType, ...fields },
      }),
    ).toBeTruthy();
  }

  function applyProposal(proposalId: string, authHeader: string) {
    return request(app.getHttpServer())
      .post(`/api/agent-proposals/${proposalId}/apply`)
      .set('Authorization', authHeader);
  }

  /** The agent-actions endpoint must show the PROPOSED line-item row for the trace. */
  async function expectProposalTrace(traceId: string): Promise<void> {
    const traceDetail = await request(app.getHttpServer())
      .get(`/api/agent-actions/${traceId}`)
      .set('Authorization', adminHeaderA)
      .expect(200);
    expect(traceDetail.body.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          traceId,
          actionType: 'mcp.propose_line_item',
          status: 'PROPOSED',
        }),
      ]),
    );
  }

  /** Every read tool with the arguments tenant A uses, against its own fixtures. */
  function readToolCallsForTenantA(): ReadCall[] {
    return [
      { name: 'search_customers', arguments: { search: fixtures.searchToken } },
      { name: 'get_customer', arguments: { customer_id: fixtures.customerId } },
      { name: 'search_vehicles', arguments: { search: fixtures.searchToken } },
      { name: 'get_vehicle', arguments: { vehicle_id: fixtures.vehicleId } },
      {
        name: 'get_vehicle_listing_status',
        arguments: { vehicle_id: fixtures.vehicleId },
      },
      {
        name: 'list_workshop_orders',
        arguments: { customer_id: fixtures.customerId },
      },
      {
        name: 'get_workshop_order',
        arguments: { workshop_order_id: fixtures.workshopOrderId },
      },
      { name: 'search_parts', arguments: { query: fixtures.searchToken } },
      { name: 'get_stock_level', arguments: { sku: fixtures.sku } },
      { name: 'get_vehicle_stock_age_report', arguments: {} },
      {
        name: 'get_vehicle_stock_margin_report',
        arguments: { from: '2026-10-01', to: '2026-10-31' },
      },
      {
        name: 'list_invoices',
        arguments: { customer_id: fixtures.customerId },
      },
      { name: 'get_invoice', arguments: { invoice_id: fixtures.invoiceId } },
      {
        name: 'get_workshop_kpi_report',
        arguments: { from: '2026-10-01', to: '2026-10-31' },
      },
      {
        name: 'get_revenue_report',
        arguments: { from: '2026-10-01', to: '2026-10-31' },
      },
      { name: 'list_pickerl_due', arguments: {} },
      {
        name: 'get_nova_preview',
        arguments: {
          vehicle_id: fixtures.vehicleId,
          net_price_eur: '12000.00',
        },
      },
      { name: 'list_bays', arguments: {} },
      { name: 'list_bins', arguments: {} },
      { name: 'list_workshop_tasks', arguments: {} },
      {
        name: 'list_workshop_slots',
        arguments: {
          from: '2026-10-01T08:00:00.000Z',
          to: '2026-10-02T08:00:00.000Z',
          duration_minutes: 60,
        },
      },
      {
        name: 'list_available_loaners',
        arguments: {
          from: '2026-10-01T08:00:00.000Z',
          to: '2026-10-02T08:00:00.000Z',
        },
      },
      { name: 'whoami', arguments: {} },
      { name: 'get_capabilities', arguments: {} },
      {
        name: 'list_audit_events',
        arguments: { entity_type: 'Customer', entity_id: fixtures.customerId },
      },
      {
        name: 'get_entity_history',
        arguments: { entity_type: 'Customer', entity_id: fixtures.customerId },
      },
      {
        name: 'get_agent_action',
        arguments: { trace_id: TRACE_IDS.search_customers },
      },
      { name: 'list_agent_actions', arguments: {} },
      {
        name: 'get_vehicle_history',
        arguments: { vehicle_id: fixtures.vehicleId },
      },
      {
        name: 'get_vehicle_context',
        arguments: { vehicle_id: fixtures.vehicleId, sections: ['identity'] },
      },
      {
        name: 'list_documents',
        arguments: { entity_type: 'customer', entity_id: fixtures.customerId },
      },
      {
        name: 'get_document_pdf',
        arguments: { id: `workshop_order:${fixtures.workshopOrderId}` },
      },
      { name: 'get_tenant_settings', arguments: {} },
      { name: 'list_sites', arguments: {} },
      {
        name: 'get_legal_entity',
        arguments: { legal_entity_id: fixtures.legalEntityId },
      },
      {
        name: 'list_purchase_orders',
        arguments: { vendor_id: fixtures.vendorId },
      },
      {
        name: 'get_purchase_order',
        arguments: { id: fixtures.purchaseOrderId },
      },
      { name: 'list_vendors', arguments: {} },
      { name: 'list_catalog_items', arguments: { pageSize: 5 } },
      { name: 'get_catalog_item', arguments: { id: fixtures.catalogItemId } },
      { name: 'list_price_lists', arguments: {} },
      { name: 'list_margin_rules', arguments: {} },
    ];
  }

  beforeAll(async () => {
    jest.setTimeout(120000);
    previousMcpFlag = process.env.MCP_SERVER_ENABLED;
    process.env.MCP_SERVER_ENABLED = 'true';
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';

    // Read links are signed by an in-memory store, so the suite needs no GCS credentials.
    pdfArchive = createInMemoryPdfArchive();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(pdfArchive)
      .overrideProvider(MechanicMediaStorage)
      .useValue(mockMechanicMediaStorage)
      .overrideProvider(McpSessionService)
      .useClass(McpSessionService)
      .overrideProvider(McpReadToolService)
      .useClass(McpReadToolService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.listen(0);

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    const tenantResA = await createTestTenant(prisma, 'mcp-a');
    const tenantResB = await createTestTenant(prisma, 'mcp-b');
    tenantA = tenantResA.tenantId;
    tenantB = tenantResB.tenantId;
    prismaA = createTenantAwarePrisma(prisma, tenantA);

    adminHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'ADMIN',
    })}`;
    adminHeaderB = `Bearer ${createTestAuthToken(authService, tenantResB, {
      role: 'ADMIN',
    })}`;
    salesHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'SALES',
    })}`;
    techHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'TECH',
    })}`;

    const tenantAUser = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantResA.firebaseUid },
      select: { id: true },
    });
    tenantAUserId = tenantAUser.id;

    fixtures = await seedTenantAFixtures();
    const siteId = await resolveTestMainSiteId(prisma, tenantA);
    const bay = await prismaA.bay.create({
      data: {
        name: `MCP test bay ${Date.now()}`,
        is_active: true,
        sort_order: 1,
        site_id: siteId,
      },
    });
    workshopBayId = bay.id;
  });

  afterAll(async () => {
    if (previousMcpFlag === undefined) {
      delete process.env.MCP_SERVER_ENABLED;
    } else {
      process.env.MCP_SERVER_ENABLED = previousMcpFlag;
    }
    await cleanupTestTenantGraph(prisma, tenantA);
    await cleanupTestTenantGraph(prisma, tenantB);
    await teardownTestApp(app, prisma);
  });

  it('returns 404 when MCP_SERVER_ENABLED is false (no Authorization)', async () => {
    process.env.MCP_SERVER_ENABLED = 'false';
    await request(app.getHttpServer()).post('/api/mcp').send({}).expect(404);
    process.env.MCP_SERVER_ENABLED = 'true';
  });

  it('returns 401 when MCP is enabled but Authorization is missing', async () => {
    await request(app.getHttpServer()).post('/api/mcp').send({}).expect(401);
  });

  it('rejects TECH role like other back-office APIs', async () => {
    await asRole('TECH', () =>
      request(app.getHttpServer())
        .post('/api/mcp')
        .set('Authorization', techHeaderA)
        .send({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} })
        .expect(403),
    );
  });

  it('allows SALES (ADVISOR) to initialize', async () => {
    await asRole('SALES', async () => {
      const { transport } = await connectMcpClient(
        salesHeaderA,
        'e2e-sales-advisor',
      );
      await endMcpSession(transport);
    });
  });

  it('rejects cross-tenant session reuse with 404', async () => {
    const { transport } = await connectMcpClient(
      adminHeaderA,
      'e2e-session-owner-a',
    );
    const sessionId = transport.sessionId;
    expect(sessionId).toBeTruthy();

    // The session stays open for the cross-tenant request, so the 404 proves the owner check.
    try {
      await request(app.getHttpServer())
        .post('/api/mcp')
        .set('Authorization', adminHeaderB)
        .set('mcp-session-id', sessionId!)
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
        .expect(404);
    } finally {
      await endMcpSession(transport);
    }
  });

  it('lists every registered tool, read and write', async () => {
    const { client, transport } = await connectMcpClient(
      adminHeaderA,
      'e2e-list-tools',
    );
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    expect(toolNames.sort()).toEqual([...MCP_TOOL_NAMES].sort());
    // Ensure none of the never exposed actions are present
    for (const neverExposed of MCP_NEVER_EXPOSED_ACTIONS) {
      expect(toolNames).not.toContain(neverExposed);
    }
    // Every tool publishes an object output schema, which the SDK checks against each successful result.
    for (const tool of tools.tools) {
      expect(tool.outputSchema).toMatchObject({ type: 'object' });
    }
    await endMcpSession(transport);
  });

  it('calls each read tool and records agent action logs for tenant A', async () => {
    const clientName = 'e2e-all-tools';
    const toolCalls = readToolCallsForTenantA();
    expect(toolCalls.map((call) => call.name).sort()).toEqual(
      [...MCP_READ_TOOL_NAMES].sort(),
    );

    for (const call of toolCalls) {
      const traceId = TRACE_IDS[call.name];
      const result = await callMcpTool(
        caller(adminHeaderA, clientName),
        call.name,
        call.arguments,
        traceId,
      );
      expect(result.isError).not.toBe(true);

      const log = await findActionLog(traceId, `mcp.${call.name}`);
      expect(log).toBeTruthy();
      expect(log?.agent_id).toBe(`mcp:${clientName}`);
      expect(log?.tier).toBe('AUTO');
    }
  });

  it.each(['list_bays', 'list_bins', 'list_workshop_tasks'])(
    'returns empty data for %s on tenant B',
    async (toolName) => {
      const result = await callMcpTool(
        caller(adminHeaderB, `e2e-empty-${toolName}`),
        toolName,
        {},
      );
      expect(result.isError).not.toBe(true);
      expect(parsePayload(result)).toMatchObject({
        data: [],
        meta: { total: 0, page: 1, page_size: 10 },
      });
    },
  );

  it('returns active-site bays, bins, and actionable workshop task context', async () => {
    await withMcpSession(adminHeaderA, 'e2e-new-mcp-lists', async (session) => {
      const [bayResult, binResult, taskResult] = await Promise.all(
        ['list_bays', 'list_bins', 'list_workshop_tasks'].map((name) =>
          session.call(name, {}),
        ),
      );
      const bays = parsePayload<{
        data: Array<{ id: string }>;
        meta: { total: number };
      }>(bayResult);
      const bins = parsePayload<{
        data: Array<{ id: string; type: string }>;
        meta: { total: number };
      }>(binResult);
      const tasks = parsePayload<{
        data: Array<{
          id: string;
          workshop_order_id: string;
          line_items_version: number;
          line_items: Array<{ id: string; catalog_item_id: string | null }>;
        }>;
        meta: { total: number };
      }>(taskResult);

      expect(bayResult?.isError).not.toBe(true);
      expect(bins.data.map((bin) => bin.type)).toContain('bin');
      expect(bays.data.map((bay) => bay.id)).toContain(workshopBayId);
      expect(bins.data.map((bin) => bin.id)).toContain(fixtures.locationId);
      expect(tasks.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: fixtures.workshopTaskId,
            workshop_order_id: fixtures.workshopOrderId,
            line_items_version: expect.any(Number),
            line_items: expect.arrayContaining([
              expect.objectContaining({
                id: fixtures.workshopTaskLineItemId,
                catalog_item_id: fixtures.catalogItemId,
              }),
            ]),
          }),
        ]),
      );
      expect(bays.meta.total).toBeGreaterThan(0);
      expect(bins.meta.total).toBeGreaterThan(0);
      expect(tasks.meta.total).toBeGreaterThan(0);
    });
  });

  it('isolates tenant A data for every read tool with tenant B token', async () => {
    const calls: ReadCall[] = readToolCallsForTenantA().map((call) => ({
      ...call,
      arguments: TENANT_B_PROBE_ARGUMENTS[call.name] ?? call.arguments,
    }));
    expect(calls.map((call) => call.name).sort()).toEqual(
      [...MCP_READ_TOOL_NAMES].sort(),
    );

    await withMcpSession(
      adminHeaderB,
      'e2e-tenant-b-isolation',
      async (session) => {
        for (const call of calls) {
          const result = await session.call(call.name, call.arguments);
          const payload = toolPayloadText(result);
          if (DETAIL_TOOLS_HIDDEN_FROM_OTHER_TENANT.includes(call.name)) {
            expect(result.isError).toBe(true);
            continue;
          }
          expect(result.isError).not.toBe(true);
          assertPayloadExcludesTenantAIds(payload);
        }
      },
    );
  });

  it('whoami and get_capabilities for tenant B never show tenant A identity', async () => {
    await withMcpSession(
      adminHeaderB,
      'e2e-tenant-b-identity',
      async (session) => {
        const whoami = await session.call('whoami', {});
        expect(parsePayload(whoami)).toMatchObject({
          tenant: { id: tenantB },
        });
        expect(toolPayloadText(whoami)).not.toContain(tenantA);

        const capabilities = await session.call('get_capabilities', {});
        expect(toolPayloadText(capabilities)).not.toContain(tenantA);
      },
    );
  });

  it('whoami reports the agent caller, the session tenant, and the decision mode', async () => {
    await withMcpSession(adminHeaderA, 'e2e-whoami', async (session) => {
      const result = await session.call('whoami', {});

      expect(result.isError).not.toBe(true);
      expect(parsePayload(result)).toMatchObject({
        caller: { id: 'mcp:e2e-whoami', name: 'e2e-whoami', type: 'agent' },
        tenant: { id: tenantA },
        mode: expect.stringMatching(/^(shadow|live)$/),
      });
    });
  });

  it('get_capabilities reports a write rule switched Off as disabled with a reason', async () => {
    await setPolicyTier('inventory.part_reserve', 'AUTO', { amount_max: 250 });
    await putPolicyRule('workshop_order.create', {
      tier: 'AUTO',
      enabled: false,
    });

    await withMcpSession(adminHeaderA, 'e2e-capabilities', async (session) => {
      const page = await readAllCapabilities((args) =>
        session.call('get_capabilities', args),
      );
      const byTool = new Map(page.data.map((entry) => [entry.tool, entry]));
      expect(byTool.get('draft_workshop_order')).toMatchObject({
        enabled: false,
        disabled_reason: 'policy_disabled',
        tier: 'AUTO',
      });
      expect(byTool.get('reserve_part')).toMatchObject({
        enabled: true,
        tier: 'AUTO',
      });
      expect(byTool.get('reserve_part')).not.toHaveProperty('disabled_reason');
      expect(page.human_only_actions).toEqual(
        expect.arrayContaining([...MCP_NEVER_EXPOSED_ACTIONS]),
      );
    });
  });

  // Write tool e2e cases

  /** Proposes one line item on the task and checks the PROPOSED outcome that every propose_line_item case shares. */
  async function proposeLineItem(input: {
    clientName: string;
    traceId?: string;
    task: { id: string; line_items_version: number };
    itemNo: string;
    description: string;
  }): Promise<{ status: string; trace_id: string }> {
    return withMcpSession(
      adminHeaderA,
      input.clientName,
      async ({ call, responseTraceIds }) => {
        const result = await call('propose_line_item', {
          workshop_order_id: fixtures.workshopOrderId,
          workshop_task_id: input.task.id,
          expected_line_items_version: input.task.line_items_version,
          line_item: {
            type: 'PART',
            item_no: input.itemNo,
            description: input.description,
            quantity: 1,
            unit_price_cents: 100,
          },
        });

        expect(result.isError).not.toBe(true);
        const payload = parsePayload<{ status: string; trace_id: string }>(
          result,
        );
        expect(payload.status).toBe('needs_approval');
        // Requests on one MCP session can complete in any order, so the tool's
        // response is one of the echoed headers, not necessarily the last.
        expect(responseTraceIds).toContain(payload.trace_id);

        const log = await findActionLog(
          payload.trace_id,
          'mcp.propose_line_item',
        );
        expect(log?.status).toBe('PROPOSED');

        await expectProposalTrace(payload.trace_id);
        return payload;
      },
      input.traceId,
    );
  }

  it('propose_line_item PROPOSE → needs_approval with a pending ID and no line item row', async () => {
    await setPolicyTier('workshop_order.propose_line', 'PROPOSE');
    // Arrange: create a workshop task for the workshop order
    const task = await createOpenTask('Test Task');

    const payload = await proposeLineItem({
      clientName: 'e2e-propose-line-item',
      traceId: '00000000-0000-4000-8000-000000000200', // traceId for propose_line_item
      task,
      itemNo: 'TEST-ITEM',
      description: 'Test line item',
    });
    expect(payload.trace_id).toBe('00000000-0000-4000-8000-000000000200');

    // Ensure no line item row was created (dry run is rolled back)
    expect(
      await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: task.id },
      }),
    ).toBe(0);

    // Check for PROPOSED agent action log
    const log = await findActionLog(payload.trace_id, 'mcp.propose_line_item');
    expect(log).toBeTruthy();
    expect(log?.tier).toBe('PROPOSE');
  });

  it('returns one generated trace ID for PROPOSE when X-Trace-Id is absent', async () => {
    await setPolicyTier('workshop_order.propose_line', 'PROPOSE');
    const task = await createOpenTask('Generated Trace Test Task');

    const payload = await proposeLineItem({
      clientName: 'e2e-propose-line-item-generated-trace',
      task,
      itemNo: 'TEST-ITEM-GENERATED-TRACE',
      description: 'Generated trace test line item',
    });
    expect(payload.trace_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('applies a proposed MCP workshop order at the site where it was simulated', async () => {
    await setPolicyTier('workshop_order.create', 'PROPOSE');
    const draftVehicle = await createDraftVehicle('draft-propose');
    const siteId = await resolveTestMainSiteId(prisma, tenantA);
    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-draft-workshop-order-propose'),
      'draft_workshop_order',
      draftOrderArgs(draftVehicle, 13),
      '00000000-0000-4000-8000-000000000216',
    );
    const payload = parsePayload<{ status: string; pending_action_id: string }>(
      result,
    );
    expect(payload.status).toBe('needs_approval');
    expect(payload.pending_action_id).toBeTruthy();
    expect(
      await prismaA.workshopOrder.count({
        where: { vehicle_id: draftVehicle.vehicleId },
      }),
    ).toBe(0);

    const applied = await applyProposal(
      payload.pending_action_id,
      adminHeaderA,
    ).expect(200);
    expect(applied.body.status).toBe('EXECUTED');
    expect(
      await prismaA.workshopOrder.findFirst({
        where: {
          tenant_id: tenantA,
          site_id: siteId,
          vehicle_id: draftVehicle.vehicleId,
        },
      }),
    ).toBeTruthy();
  });

  it('applies a pending action once, enforces tenant and supervisor access, and reports batch partial failure', async () => {
    await setPolicyTier('workshop_order.propose_line', 'PROPOSE');

    const submitPendingLine = async (title: string) => {
      const task = await createOpenTask(title);
      const response = await request(app.getHttpServer())
        .post('/api/agent-proposals/submit')
        .set('Authorization', adminHeaderA)
        .send({
          action_type: 'workshop_order.propose_line',
          payload_json: {
            workshop_order_id: fixtures.workshopOrderId,
            workshop_task_id: task.id,
            expected_line_items_version: task.line_items_version,
            line_item: {
              type: 'PART',
              item_no: `FABRICATED-${title}`,
              description: 'Fabricated pending-action test part',
              quantity: 1,
              unit_price_cents: 100,
            },
          },
        })
        .expect(201);
      expect(response.body.status).toBe('PENDING');
      const lineCount = await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: task.id },
      });
      expect(lineCount).toBe(0);
      return { taskId: task.id, proposal: response.body };
    };

    const pending = await submitPendingLine('Pending Apply E2E');
    await asRole('TECH', () =>
      applyProposal(pending.proposal.id, techHeaderA).expect(403),
    );
    await applyProposal(pending.proposal.id, adminHeaderB).expect(404);

    const concurrentApply = await Promise.all([
      applyProposal(pending.proposal.id, adminHeaderA),
      applyProposal(pending.proposal.id, adminHeaderA),
    ]);
    expect(concurrentApply.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(concurrentApply.map((response) => response.body.status)).toEqual([
      'EXECUTED',
      'EXECUTED',
    ]);
    expect(
      await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: pending.taskId },
      }),
    ).toBe(1);

    const batchPending = await submitPendingLine('Pending Batch E2E');
    const batchResponse = await request(app.getHttpServer())
      .post('/api/agent-proposals/batch-apply')
      .set('Authorization', adminHeaderA)
      .send({
        ids: [batchPending.proposal.id, '99999999-9999-4999-8999-999999999999'],
      })
      .expect(200);
    expect(batchResponse.body.results).toMatchObject([
      { id: batchPending.proposal.id, status: 'applied' },
      { id: '99999999-9999-4999-8999-999999999999', status: 'failed' },
    ]);
    expect(
      await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: batchPending.taskId },
      }),
    ).toBe(1);

    const appliedLogs = await prismaA.agentActionLog.count({
      where: {
        trace_id: pending.proposal.trace_id,
        action_type: 'workshop_order.propose_line',
        status: 'EXECUTED',
      },
    });
    expect(appliedLogs).toBe(1);
  });

  it('draft_workshop_order AUTO → creates a scheduled order + EXECUTED log with traceId', async () => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const draftVehicle = await createDraftVehicle('draft-auto');

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-draft-workshop-order'),
      'draft_workshop_order',
      { ...draftOrderArgs(draftVehicle, 12), notes: 'MCP draft test' },
      '00000000-0000-4000-8000-000000000201',
    );

    expect(result.isError).not.toBe(true);
    const executedResult = parsePayload<{
      status: string;
      result: { id: string };
    }>(result);
    expect(executedResult.status).toBe('executed');

    // Retrieve the created order from the database
    const orders = await prismaA.workshopOrder.findMany({
      where: {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        notes: 'MCP draft test',
      },
      select: { id: true, status: true },
    });
    expect(orders.length).toBe(1);
    const order = orders[0];
    expect(order.id).toBe(executedResult.result.id);
    expect(order.status).toBe('SCHEDULED');

    // Check for EXECUTED agent action log
    const log = await findActionLog(
      '00000000-0000-4000-8000-000000000201',
      'mcp.draft_workshop_order',
    );
    expect(log).toBeTruthy();
    expect(log?.tier).toBe('AUTO');
    expect(log?.status).toBe('EXECUTED');
    expect(log?.entity_type).toBe('WorkshopOrder');
    expect(log?.entity_id).toBe(order.id);
    expect(log?.reversible).toBe(true);
  });

  it('AUT-529: replays an AUTO draft_workshop_order with the same command_id', async () => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const draftVehicle = await createDraftVehicle('draft-idempotent-auto');
    const commandId = '51500000-0000-4000-8000-000000000529';
    const traceId = '00000000-0000-4000-8000-000000000529';
    const notes = `MCP AUT-529 auto replay ${Date.now()}`;

    const first = await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-auto'),
      'draft_workshop_order',
      {
        ...draftOrderArgs(draftVehicle, 20),
        notes,
        command_id: commandId,
      },
      traceId,
    );
    expect(first.isError).not.toBe(true);
    const firstPayload = parsePayload<{
      status: string;
      result: { id: string };
      replayed?: boolean;
    }>(first);
    expect(firstPayload.status).toBe('executed');
    expect(firstPayload.replayed).toBeUndefined();

    const second = await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-auto-replay'),
      'draft_workshop_order',
      {
        ...draftOrderArgs(draftVehicle, 20),
        notes,
        command_id: commandId,
      },
      '00000000-0000-4000-8000-00000000052a',
    );
    expect(second.isError).not.toBe(true);
    const secondPayload = parsePayload<{
      status: string;
      result: { id: string };
      replayed?: boolean;
      trace_id: string;
    }>(second);
    expect(secondPayload.replayed).toBe(true);
    expect(secondPayload.result.id).toBe(firstPayload.result.id);
    expect(secondPayload.trace_id).toBe(traceId);

    const orders = await prismaA.workshopOrder.count({
      where: {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        notes,
      },
    });
    expect(orders).toBe(1);
  });

  it('AUT-529: replays propose_line_item with the same command_id', async () => {
    await setPolicyTier('workshop_order.propose_line', 'PROPOSE');
    const task = await createOpenTask('AUT-529 propose replay');
    const commandId = '51500000-0000-4000-8000-00000000052b';
    const traceId = '00000000-0000-4000-8000-00000000052b';

    const args = {
      workshop_order_id: fixtures.workshopOrderId,
      workshop_task_id: task.id,
      expected_line_items_version: task.line_items_version,
      command_id: commandId,
      line_item: {
        type: 'PART',
        item_no: 'AUT529',
        description: 'Idempotent propose line',
        quantity: 1,
        unit_price_cents: 100,
      },
    };

    const first = await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-propose'),
      'propose_line_item',
      args,
      traceId,
    );
    const firstPayload = parsePayload<{
      status: string;
      pending_action_id: string;
      replayed?: boolean;
    }>(first);
    expect(firstPayload.status).toBe('needs_approval');

    const second = await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-propose-replay'),
      'propose_line_item',
      args,
      '00000000-0000-4000-8000-00000000052c',
    );
    const secondPayload = parsePayload<{
      status: string;
      pending_action_id: string;
      replayed?: boolean;
      trace_id: string;
    }>(second);
    expect(secondPayload.replayed).toBe(true);
    expect(secondPayload.pending_action_id).toBe(
      firstPayload.pending_action_id,
    );
    expect(secondPayload.trace_id).toBe(traceId);

    expect(
      await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: task.id },
      }),
    ).toBe(0);
  });

  it('AUT-529: returns MCP_COMMAND_IDEMPOTENCY_CONFLICT when the active site differs', async () => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const draftVehicle = await createDraftVehicle('draft-idempotent-site');
    const commandId = '51500000-0000-4000-8000-00000000052f';

    await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-site-a'),
      'draft_workshop_order',
      {
        ...draftOrderArgs(draftVehicle, 21),
        notes: 'site-bound command',
        command_id: commandId,
      },
      '00000000-0000-4000-8000-00000000052f',
    );

    const mainSite = await prismaA.site.findFirstOrThrow({
      where: { id: fixtures.siteId },
      select: { legal_entity_id: true },
    });
    const otherSite = await prismaA.site.create({
      data: {
        legal_entity_id: mainSite.legal_entity_id,
        code: `MCP-IDEM-SITE-${Date.now()}`,
        name: 'MCP idempotency other site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
      },
    });
    await prismaA.siteMembership.create({
      data: {
        tenant_id: tenantA,
        user_id: tenantAUserId,
        site_id: otherSite.id,
        is_active: true,
      },
    });
    await prismaA.user.update({
      where: { id: tenantAUserId },
      data: { active_site_id: otherSite.id },
    });

    try {
      const conflict = await callMcpTool(
        caller(adminHeaderA, 'e2e-aut529-site-b'),
        'draft_workshop_order',
        {
          ...draftOrderArgs(draftVehicle, 21),
          notes: 'site-bound command',
          command_id: commandId,
        },
        '00000000-0000-4000-8000-000000000530',
      );
      expect(conflict.isError).toBe(true);
      expect(toolPayloadText(conflict)).toContain(
        'MCP_COMMAND_IDEMPOTENCY_CONFLICT',
      );
    } finally {
      await prismaA.user.update({
        where: { id: tenantAUserId },
        data: { active_site_id: fixtures.siteId },
      });
    }
  });

  it('AUT-529: rejects the same command_id with different arguments', async () => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const draftVehicle = await createDraftVehicle('draft-idempotent-conflict');
    const commandId = '51500000-0000-4000-8000-00000000052d';

    await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-conflict-a'),
      'draft_workshop_order',
      {
        ...draftOrderArgs(draftVehicle, 22),
        notes: 'first body',
        command_id: commandId,
      },
      '00000000-0000-4000-8000-00000000052d',
    );

    const conflict = await callMcpTool(
      caller(adminHeaderA, 'e2e-aut529-conflict-b'),
      'draft_workshop_order',
      {
        ...draftOrderArgs(draftVehicle, 22),
        notes: 'different body',
        command_id: commandId,
      },
      '00000000-0000-4000-8000-00000000052e',
    );
    expect(conflict.isError).toBe(true);
    expect(toolPayloadText(conflict)).toContain(
      'MCP_COMMAND_IDEMPOTENCY_CONFLICT',
    );
  });

  it('AUT-511: rolls back an AUTO draft when the EXECUTED agent action log insert fails', async () => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const draftVehicle = await createDraftVehicle('draft-atomic-rollback');
    const notes = `MCP AUT-511 rollback ${Date.now()}`;
    const traceId = '00000000-0000-4000-8000-000000000511';

    const agentActionLog = app.get(AgentActionLogService);
    const realRecordInTransaction =
      agentActionLog.recordInTransaction.bind(agentActionLog);
    const recordSpy = jest
      .spyOn(agentActionLog, 'recordInTransaction')
      .mockImplementation(async (input, tx, work, metadata) => {
        const inputSummary = input.inputSummary as {
          tool?: string;
          args?: { notes?: string };
        };
        if (
          input.status === 'EXECUTED' &&
          inputSummary.tool === 'draft_workshop_order' &&
          inputSummary.args?.notes === notes
        ) {
          if (work) {
            await work();
          }
          throw new Error('simulated EXECUTED log insert failure');
        }
        return realRecordInTransaction(input, tx, work, metadata);
      });

    try {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-auto-atomic-rollback'),
        'draft_workshop_order',
        { ...draftOrderArgs(draftVehicle), notes },
        traceId,
      );

      expect(result.isError).toBe(true);
      expect(toolPayloadText(result)).toContain(
        'simulated EXECUTED log insert failure',
      );

      const orders = await prismaA.workshopOrder.count({
        where: {
          customer_id: draftVehicle.customerId,
          vehicle_id: draftVehicle.vehicleId,
          notes,
        },
      });
      expect(orders).toBe(0);

      const executedLogs = await prismaA.agentActionLog.count({
        where: {
          trace_id: traceId,
          action_type: 'mcp.draft_workshop_order',
          status: 'EXECUTED',
        },
      });
      expect(executedLogs).toBe(0);
    } finally {
      recordSpy.mockRestore();
    }
  });

  it('disabled write policy refuses without creating an order and records a REFUSED log', async () => {
    await putPolicyRule('workshop_order.create', {
      tier: 'AUTO',
      enabled: false,
    });
    const draftVehicle = await createDraftVehicle('draft-human');

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-human-only-refuse'),
      'draft_workshop_order',
      { ...draftOrderArgs(draftVehicle), notes: 'MCP human-only test' },
      '00000000-0000-4000-8000-000000000202',
    );

    expect(result.isError).toBe(true);
    expect(toolPayloadText(result)).toContain('not_permitted');
    const orders = await prismaA.workshopOrder.count({
      where: {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        notes: 'MCP human-only test',
      },
    });
    expect(orders).toBe(0);

    const log = await findActionLog(
      '00000000-0000-4000-8000-000000000202',
      'mcp.draft_workshop_order',
    );
    expect(log).toBeTruthy();
    expect(log?.tier).toBe('HUMAN_ONLY');
    expect(log?.status).toBe('REFUSED');
  });

  /** Refused drafts create no order and leave one FAILED NOT_EVALUATED row on their trace. */
  it.each<{
    title: string;
    clientName: string;
    traceId: string;
    /** Orders on the vehicle after the refused call. The fixture vehicle keeps its seeded order. */
    expectedOrders: number;
    /** Prefix for a new tenant A vehicle to draft against. Without it, the fixture vehicle is used. */
    newVehicle?: string;
    args: (vehicle: DraftVehicle) => Record<string, unknown>;
    payloadPattern?: RegExp;
  }>([
    {
      title:
        'rejects an active INTAKE status for draft_workshop_order without creating an order',
      clientName: 'e2e-draft-active-status-rejected',
      traceId: '00000000-0000-4000-8000-000000000213',
      expectedOrders: 1,
      args: (vehicle) => ({ vehicle_id: vehicle.vehicleId, status: 'INTAKE' }),
    },
    {
      title: 'requires an explicit SCHEDULED status for draft_workshop_order',
      clientName: 'e2e-draft-workshop-order-missing-status',
      traceId: '00000000-0000-4000-8000-000000000214',
      expectedOrders: 0,
      newVehicle: 'draft-missing-status',
      args: (vehicle) => ({
        ...vehicleRefs(vehicle),
        odometer: 1000,
        fuel_level: 50,
        notes: 'MCP missing status test',
      }),
    },
    {
      title:
        'rejects dry_run on draft_workshop_order without creating an order',
      clientName: 'e2e-draft-workshop-order-dry-run-rejected',
      traceId: '00000000-0000-4000-8000-000000000215',
      expectedOrders: 0,
      newVehicle: 'draft-dry-run-rejected',
      args: (vehicle) => ({
        ...vehicleRefs(vehicle),
        status: 'SCHEDULED',
        ...scheduledBooking(14),
        odometer: 1000,
        fuel_level: 50,
        notes: 'MCP dry_run rejected test',
        dry_run: true,
      }),
      payloadPattern: /validation|unrecognized|invalid/i,
    },
    {
      title:
        'logs a DRAFT status for draft_workshop_order as FAILED NOT_EVALUATED, never PROPOSE',
      clientName: 'e2e-draft-workshop-order-status-draft-rejected',
      traceId: '00000000-0000-4000-8000-000000000217',
      expectedOrders: 0,
      newVehicle: 'draft-status-draft-rejected',
      args: (vehicle) => ({
        ...vehicleRefs(vehicle),
        status: 'DRAFT',
        ...scheduledBooking(14),
        notes: 'MCP DRAFT status rejected test',
      }),
      payloadPattern: /validation|invalid/i,
    },
  ])('$title', async (row) => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const vehicle: DraftVehicle = row.newVehicle
      ? await createDraftVehicle(row.newVehicle)
      : { customerId: fixtures.customerId, vehicleId: fixtures.vehicleId };
    const result = await callMcpTool(
      caller(adminHeaderA, row.clientName),
      'draft_workshop_order',
      row.args(vehicle),
      row.traceId,
    );

    expect(result.isError).toBe(true);
    if (row.payloadPattern) {
      expect(toolPayloadText(result)).toMatch(row.payloadPattern);
    }
    expect(
      await prismaA.workshopOrder.count({
        where: { vehicle_id: vehicle.vehicleId },
      }),
    ).toBe(row.expectedOrders);
    const failures = await prismaA.agentActionLog.findMany({
      where: {
        trace_id: row.traceId,
        action_type: 'mcp.draft_workshop_order',
      },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      status: 'FAILED',
      tier: 'NOT_EVALUATED',
    });
  });

  it('reserve_part then release_reservation round-trip restores state', async () => {
    await setPolicyTier('inventory.part_reserve', 'AUTO');
    await setPolicyTier('inventory.part_release', 'AUTO', { amount_max: 1 });

    const initialStock = await readStockAvailability(
      'e2e-initial-stock',
      '00000000-0000-4000-8000-000000000206',
    );

    const reserveResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-reserve-part'),
      'reserve_part',
      {
        workshop_task_line_item_id: fixtures.workshopTaskLineItemId,
        quantity: 1,
        location_id: fixtures.locationId,
      },
      '00000000-0000-4000-8000-000000000207',
    );
    expect(reserveResult.isError).not.toBe(true);

    // Extract reservation ID from agent action log (since the tool returns it in the result summary)
    const reserveLog = await findActionLog(
      '00000000-0000-4000-8000-000000000207',
      'mcp.reserve_part',
    );
    expect(reserveLog).toBeTruthy();
    expect(reserveLog?.entity_type).toBe('PartsReservation');
    expect(reserveLog?.reversible).toBe(true);
    const reservationId = (
      reserveLog?.result_summary_json as { reservation_id: string }
    )?.reservation_id;
    expect(reservationId).toBeDefined();
    if (!reservationId) {
      throw new Error('reserve_part did not log a reservation id');
    }
    const openReservation = await prismaA.partsReservation.findFirst({
      where: { id: reservationId },
      select: { status: true, quantity: true },
    });
    expect(openReservation?.status).toBe('OPEN');
    expect(openReservation?.quantity.toNumber()).toBe(1);

    // Check stock after reserve: should be initialStock - 1
    const stockAfterReserve = await readStockAvailability(
      'e2e-stock-after-reserve',
      '00000000-0000-4000-8000-000000000208',
    );
    expect(stockAfterReserve).toBe(initialStock - 1);

    // Release reservation: proposed, because the release policy is not yet AUTO for this amount
    const releaseArgs = {
      reservation_id: reservationId,
      return_location_id: fixtures.locationId,
    };
    const releaseResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-release-reservation'),
      'release_reservation',
      releaseArgs,
      '00000000-0000-4000-8000-000000000209',
    );
    expect(releaseResult.isError).not.toBe(true);
    const proposedRelease = parsePayload<{ status: string; trace_id: string }>(
      releaseResult,
    );
    expect(proposedRelease.status).toBe('needs_approval');
    const reservationAfterProposedRelease =
      await prismaA.partsReservation.findFirst({
        where: { id: reservationId },
        select: { status: true },
      });
    expect(reservationAfterProposedRelease?.status).toBe('OPEN');

    await setPolicyTier('inventory.part_release', 'AUTO');
    const approvedReleaseResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-release-reservation-approved'),
      'release_reservation',
      releaseArgs,
      '00000000-0000-4000-8000-000000000215',
    );
    expect(approvedReleaseResult.isError).not.toBe(true);

    // Check stock after release: should be initialStock
    const stockAfterRelease = await readStockAvailability(
      'e2e-stock-after-release',
      '00000000-0000-4000-8000-000000000210',
    );
    expect(stockAfterRelease).toBe(initialStock);
    const releasedReservation = await prismaA.partsReservation.findFirst({
      where: { id: reservationId },
      select: { status: true, quantity: true },
    });
    expect(releasedReservation?.status).toBe('CANCELLED');
    expect(releasedReservation?.quantity.toNumber()).toBe(1);

    // Check agent action logs for EXECUTED
    const reserveLogAfter = await findActionLog(
      '00000000-0000-4000-8000-000000000207',
      'mcp.reserve_part',
    );
    expect(reserveLogAfter?.status).toBe('EXECUTED');
    const releaseLog = await findActionLog(
      proposedRelease.trace_id,
      'mcp.release_reservation',
    );
    expect(releaseLog).toBeTruthy();
    expect(releaseLog?.status).toBe('PROPOSED');
    const approvedReleaseLog = await findActionLog(
      '00000000-0000-4000-8000-000000000215',
      'mcp.release_reservation',
    );
    expect(approvedReleaseLog?.status).toBe('EXECUTED');
  });

  it('search_parts and get_stock_level expose catalog and bin ids for reserve_part (AUT-428)', async () => {
    const searchResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-stock-ids-search'),
      'search_parts',
      { query: fixtures.searchToken },
      '00000000-0000-4000-8000-000000000428',
    );
    expect(searchResult.isError).not.toBe(true);
    const search = parsePayload<{
      data: Array<{
        catalog_item_id: string;
        bin_id: string | null;
      }>;
    }>(searchResult);
    const hit = search.data.find(
      (row) => row.catalog_item_id === fixtures.catalogItemId,
    );
    expect(hit?.bin_id).toBe(fixtures.locationId);

    const catalogSearchResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-stock-ids-catalog-search'),
      'search_parts',
      {
        query: fixtures.searchToken,
        workshop_order_id: fixtures.workshopOrderId,
      },
      '00000000-0000-4000-8000-00000000042c',
    );
    expect(catalogSearchResult.isError).not.toBe(true);
    const catalogSearch = parsePayload<{
      parts: Array<{
        catalog_item_id: string | null;
        bin_id: string | null;
      }>;
    }>(catalogSearchResult);
    const catalogHit = catalogSearch.parts.find(
      (part) => part.catalog_item_id === fixtures.catalogItemId,
    );
    expect(catalogHit?.bin_id).toBe(fixtures.locationId);

    const levelResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-stock-ids-level'),
      'get_stock_level',
      { sku: fixtures.sku },
      '00000000-0000-4000-8000-000000000429',
    );
    expect(levelResult.isError).not.toBe(true);
    const level = parsePayload<{
      catalog_item_id: string;
      bin_id: string | null;
      bins: Array<{ location_id: string }>;
    }>(levelResult);
    expect(level.catalog_item_id).toBe(fixtures.catalogItemId);
    expect(level.bin_id).toBe(fixtures.locationId);
    expect(
      level.bins.some((bin) => bin.location_id === fixtures.locationId),
    ).toBe(true);

    await setPolicyTier('inventory.part_reserve', 'AUTO');
    const line = await createReservableLine();
    const reserveResult = await callMcpTool(
      caller(adminHeaderA, 'e2e-stock-ids-reserve'),
      'reserve_part',
      {
        workshop_task_line_item_id: line.id,
        quantity: 1,
        location_id: fixtures.locationId,
      },
      '00000000-0000-4000-8000-00000000042a',
    );
    expect(reserveResult.isError).not.toBe(true);
  });

  /**
   * AUT-426: a write preview runs in a rollback, so the id of a row it creates is not the id the
   * committed write returns. Each test checks that the preview id is provisional, that it is not a
   * row, and that the caller's committed id is a different row.
   */
  type WouldChangeEntry = {
    entity: string;
    id: string;
    op: string;
    provisional: boolean;
  };

  function previewCreatedRow(
    wouldChange: WouldChangeEntry[],
    entity: string,
  ): WouldChangeEntry {
    const entry = wouldChange.find(
      (item) => item.entity === entity && item.op === 'create',
    );
    if (!entry) {
      throw new Error(`would_change has no created ${entity} row`);
    }
    return entry;
  }

  /**
   * A fresh part line on the fixture task. The round-trip test releases the fixture line's only
   * reservation, which cancels that line, so the reserve cases below cannot reuse it.
   */
  function createReservableLine() {
    return createPartLine(prismaA, fixtures.workshopTaskId, {
      item_no: fixtures.sku,
      description: 'Provisional preview part',
      unit_price: 2,
      catalog_item_id: fixtures.catalogItemId,
    });
  }

  it('draft_workshop_order AUTO: the preview order id is provisional, and result.id is the committed order', async () => {
    await setPolicyTier('workshop_order.create', 'AUTO');
    const draftVehicle = await createDraftVehicle('draft-provisional-auto');

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-draft-provisional-auto'),
      'draft_workshop_order',
      {
        ...draftOrderArgs(draftVehicle, 15),
        notes: 'MCP provisional auto test',
      },
      '00000000-0000-4000-8000-000000000218',
    );
    const executed = parsePayload<{
      status: string;
      would_change: WouldChangeEntry[];
      result: { id: string };
    }>(result);
    expect(executed.status).toBe('executed');

    const previewOrder = previewCreatedRow(
      executed.would_change,
      'WorkshopOrder',
    );
    expect(previewOrder.provisional).toBe(true);
    expect(
      await prismaA.workshopOrder.findFirst({ where: { id: previewOrder.id } }),
    ).toBeNull();
    expect(executed.result.id).not.toBe(previewOrder.id);
    expect(
      await prismaA.workshopOrder.findFirst({
        where: { id: executed.result.id, notes: 'MCP provisional auto test' },
      }),
    ).toBeTruthy();
  });

  it('draft_workshop_order PROPOSE: the proposal is provisional, and approval commits an order with a different id', async () => {
    await setPolicyTier('workshop_order.create', 'PROPOSE');
    const draftVehicle = await createDraftVehicle('draft-provisional-propose');

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-draft-provisional-propose'),
      'draft_workshop_order',
      draftOrderArgs(draftVehicle, 16),
      '00000000-0000-4000-8000-000000000219',
    );
    const proposed = parsePayload<{
      status: string;
      pending_action_id: string;
      would_change: WouldChangeEntry[];
      proposal: { provisional: boolean };
    }>(result);
    expect(proposed.status).toBe('needs_approval');
    expect(proposed.proposal.provisional).toBe(true);
    const previewOrder = previewCreatedRow(
      proposed.would_change,
      'WorkshopOrder',
    );
    expect(previewOrder.provisional).toBe(true);

    await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

    const committed = await prismaA.workshopOrder.findFirst({
      where: { vehicle_id: draftVehicle.vehicleId },
      select: { id: true },
    });
    expect(committed).toBeTruthy();
    expect(committed?.id).not.toBe(previewOrder.id);
    expect(
      await prismaA.workshopOrder.findFirst({ where: { id: previewOrder.id } }),
    ).toBeNull();
  });

  it('reserve_part AUTO: the preview reservation id is provisional, and result.id is the committed reservation', async () => {
    await setPolicyTier('inventory.part_reserve', 'AUTO');
    const line = await createReservableLine();

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-reserve-provisional-auto'),
      'reserve_part',
      {
        workshop_task_line_item_id: line.id,
        quantity: 1,
        location_id: fixtures.locationId,
      },
      '00000000-0000-4000-8000-000000000220',
    );
    const executed = parsePayload<{
      status: string;
      would_change: WouldChangeEntry[];
      result: { id: string };
    }>(result);
    expect(executed.status).toBe('executed');

    const previewReservation = previewCreatedRow(
      executed.would_change,
      'PartsReservation',
    );
    expect(previewReservation.provisional).toBe(true);
    expect(
      await prismaA.partsReservation.findFirst({
        where: { id: previewReservation.id },
      }),
    ).toBeNull();
    expect(executed.result.id).not.toBe(previewReservation.id);
    expect(
      await prismaA.partsReservation.findFirst({
        where: { id: executed.result.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'OPEN' });
  });

  it('reserve_part PROPOSE: the proposal is provisional, and approval commits a reservation with a different id', async () => {
    await setPolicyTier('inventory.part_reserve', 'PROPOSE');
    const line = await createReservableLine();

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-reserve-provisional-propose'),
      'reserve_part',
      {
        workshop_task_line_item_id: line.id,
        quantity: 1,
        location_id: fixtures.locationId,
      },
      '00000000-0000-4000-8000-000000000221',
    );
    const proposed = parsePayload<{
      status: string;
      pending_action_id: string;
      would_change: WouldChangeEntry[];
      proposal: { provisional: boolean };
    }>(result);
    expect(proposed.status).toBe('needs_approval');
    expect(proposed.proposal.provisional).toBe(true);
    const previewReservation = previewCreatedRow(
      proposed.would_change,
      'PartsReservation',
    );
    expect(previewReservation.provisional).toBe(true);
    await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

    const committed = await prismaA.partsReservation.findMany({
      where: { workshop_task_line_item_id: line.id },
      select: { id: true },
    });
    expect(committed).toHaveLength(1);
    expect(committed[0].id).not.toBe(previewReservation.id);
    expect(
      await prismaA.partsReservation.findFirst({
        where: { id: previewReservation.id },
      }),
    ).toBeNull();
  });

  it('reserve_part rejects a free-text PART line with NOT_A_CATALOG_LINE and reserves nothing', async () => {
    await setPolicyTier('inventory.part_reserve', 'AUTO');
    const freeTextLine = await createPartLine(
      prismaA,
      fixtures.workshopTaskId,
      {
        item_no: 'FREE-TEXT-DEMO',
        description: 'Free-text demo part',
        unit_price: 2,
      },
    );
    const stockBefore = await readStockAvailability(
      'e2e-free-text-stock-before',
      '00000000-0000-4000-8000-000000000220',
    );

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-reserve-free-text-line'),
      'reserve_part',
      {
        workshop_task_line_item_id: freeTextLine.id,
        quantity: 1,
        location_id: fixtures.locationId,
      },
      '00000000-0000-4000-8000-000000000221',
    );

    expect(result.isError).toBe(true);
    const text = toolPayloadText(result);
    expect(text).toContain('NOT_A_CATALOG_LINE');
    expect(text).toContain('catalog-backed part line');
    expect(text).not.toMatch(/site/i);
    expect(
      await prismaA.partsReservation.count({
        where: { workshop_task_line_item_id: freeTextLine.id },
      }),
    ).toBe(0);
    expect(
      await readStockAvailability(
        'e2e-free-text-stock-after',
        '00000000-0000-4000-8000-000000000222',
      ),
    ).toBe(stockBefore);
    await expectActionLogRow(
      '00000000-0000-4000-8000-000000000221',
      'mcp.reserve_part',
      { status: 'FAILED' },
    );
  });

  it('reserve_part keeps the active-site error for catalog and free-text lines at another site', async () => {
    await setPolicyTier('inventory.part_reserve', 'AUTO');
    const mainSite = await prismaA.site.findFirstOrThrow({
      where: { id: fixtures.siteId },
      select: { legal_entity_id: true },
    });
    const otherSite = await prismaA.site.create({
      data: {
        legal_entity_id: mainSite.legal_entity_id,
        code: `MCP-RESERVE-OTHER-${Date.now()}`,
        name: 'MCP reserve other site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
      },
    });
    const otherSiteOrder = await createIntakeOrder(prismaA, {
      label: 'MCP-RESERVE-OTHER',
      siteId: otherSite.id,
      customerId: fixtures.customerId,
      vehicleId: fixtures.vehicleId,
    });
    const otherSiteTask = await createOpenTask(
      'Other site reserve task',
      otherSiteOrder.id,
    );
    const catalogLine = await createPartLine(prismaA, otherSiteTask.id, {
      item_no: fixtures.sku,
      description: 'Other site catalog line',
      unit_price: 2,
      catalog_item_id: fixtures.catalogItemId,
    });
    const freeTextLine = await createPartLine(prismaA, otherSiteTask.id, {
      item_no: 'OTHER-SITE-FREE-TEXT',
      description: 'Other site free-text line',
      unit_price: 2,
    });

    const lines = [
      { line: catalogLine, traceId: '00000000-0000-4000-8000-000000000223' },
      { line: freeTextLine, traceId: '00000000-0000-4000-8000-000000000224' },
    ];
    for (const { line, traceId } of lines) {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-reserve-other-site-line'),
        'reserve_part',
        {
          workshop_task_line_item_id: line.id,
          quantity: 1,
          location_id: fixtures.locationId,
        },
        traceId,
      );

      expect(result.isError).toBe(true);
      const text = toolPayloadText(result);
      expect(text).toContain(
        'Workshop task line is not available in the active site.',
      );
      expect(text).not.toContain('NOT_A_CATALOG_LINE');
      expect(
        await prismaA.partsReservation.count({
          where: { workshop_task_line_item_id: line.id },
        }),
      ).toBe(0);
    }
  });

  it('cross-tenant: tenant A token cannot use tenant B vehicle/line/reservation IDs', async () => {
    await setPolicyTier('inventory.part_reserve', 'AUTO');
    await setPolicyTier('inventory.part_release', 'AUTO');
    const prismaB = createTenantAwarePrisma(prisma, tenantB);
    const tenantBCustomer = await prismaB.customer.create({
      data: {
        first_name: 'Cross',
        last_name: `Tenant-${Date.now()}`,
        email: `cross-${Date.now()}@example.com`,
      },
    });
    const tenantBVehicle = await prismaB.vehicle.create({
      data: {
        make: 'Test',
        model: 'CrossTenant',
        year: 2021,
        vin: `CROSS-TENANT-${Date.now()}`,
        customer_id: tenantBCustomer.id,
      },
    });
    const tenantBOrder = await createIntakeOrder(prismaB, {
      label: 'CROSS-TENANT',
      siteId: await resolveTestMainSiteId(prisma, tenantB),
      customerId: tenantBCustomer.id,
      vehicleId: tenantBVehicle.id,
    });
    const tenantBTask = await prismaB.workshopTask.create({
      data: { workshop_order_id: tenantBOrder.id, title: 'Foreign task' },
    });
    const tenantBLine = await createPartLine(prismaB, tenantBTask.id, {
      item_no: 'FOREIGN-PART',
      description: 'Foreign part',
      unit_price: 1,
    });
    const tenantBReservation = await prismaB.partsReservation.create({
      data: {
        tenant_id: tenantB,
        workshop_task_line_item_id: tenantBLine.id,
        kind: 'ON_HAND',
        quantity: 1,
      },
    });

    // Now try to use this vehicle ID with tenant A token in a write tool (e.g., draft_workshop_order)
    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-cross-tenant-vehicle'),
      'draft_workshop_order',
      draftOrderArgs({
        customerId: tenantBCustomer.id,
        vehicleId: tenantBVehicle.id,
      }),
      '00000000-0000-4000-8000-000000000211',
    );

    // Assert: the tool should fail (not found or forbidden) because the vehicle does not belong to tenant A
    expect(result.isError).toBe(true);
    // Ensure no workshop order was created in tenant A with this vehicle
    expect(
      await prismaA.workshopOrder.count({
        where: { vehicle_id: tenantBVehicle.id },
      }),
    ).toBe(0);

    await withMcpSession(
      adminHeaderA,
      'e2e-cross-tenant-write-ids',
      async (session) => {
        const reserveResult = await session.call('reserve_part', {
          workshop_task_line_item_id: tenantBLine.id,
          quantity: 1,
          location_id: fixtures.locationId,
        });
        expect(reserveResult.isError).toBe(true);
        const releaseResult = await session.call('release_reservation', {
          reservation_id: tenantBReservation.id,
        });
        expect(releaseResult.isError).toBe(true);
      },
      '00000000-0000-4000-8000-000000000214',
    );
    expect(
      await prismaB.partsReservation.findFirst({
        where: { tenant_id: tenantB, id: tenantBReservation.id },
        select: { status: true },
      }),
    ).toMatchObject({ status: 'OPEN' });
  });

  it('propose_line_item cannot access a task at another site in the same tenant', async () => {
    await setPolicyTier('workshop_order.propose_line', 'PROPOSE');
    const mainSite = await prismaA.site.findFirstOrThrow({
      where: { id: await resolveTestMainSiteId(prisma, tenantA) },
      select: { legal_entity_id: true },
    });
    const otherSite = await prismaA.site.create({
      data: {
        legal_entity_id: mainSite.legal_entity_id,
        code: `MCP-OTHER-${Date.now()}`,
        name: 'MCP other site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
      },
    });
    const otherSiteOrder = await createIntakeOrder(prismaA, {
      label: 'MCP-OTHER',
      siteId: otherSite.id,
      customerId: fixtures.customerId,
      vehicleId: fixtures.vehicleId,
    });
    const otherSiteTask = await createOpenTask(
      'Other site task',
      otherSiteOrder.id,
    );

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-cross-site-proposal'),
      'propose_line_item',
      {
        workshop_order_id: otherSiteOrder.id,
        workshop_task_id: otherSiteTask.id,
        expected_line_items_version: 0,
        line_item: {
          type: 'LABOR',
          item_no: 'SITE-ISOLATION',
          description: 'Site isolation check',
          quantity: 1,
          unit_price_cents: 1000,
        },
      },
      '00000000-0000-4000-8000-000000000212',
    );

    expect(result.isError).toBe(true);
    expect(
      await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: otherSiteTask.id },
      }),
    ).toBe(0);
    await expectActionLogRow(
      '00000000-0000-4000-8000-000000000212',
      'mcp.propose_line_item',
      { status: 'FAILED' },
    );
  });

  it('TECH role rejected on write tools', async () => {
    const fixtureVehicle = {
      customerId: fixtures.customerId,
      vehicleId: fixtures.vehicleId,
    };
    await asRole('TECH', async () => {
      const ordersBefore = await prismaA.workshopOrder.count({
        where: {
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
        },
      });
      await request(app.getHttpServer())
        .post('/api/mcp')
        .set('Authorization', techHeaderA)
        .send({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 1,
          params: {
            name: 'draft_workshop_order',
            arguments: draftOrderArgs(fixtureVehicle),
          },
        })
        .expect(403);
      const ordersAfter = await prismaA.workshopOrder.count({
        where: {
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
        },
      });
      expect(ordersAfter).toBe(ordersBefore);
    });
  });

  describe('audit and agent action reads', () => {
    const traceA = '00000000-0000-4000-8000-000000000901';
    const traceB = '00000000-0000-4000-8000-000000000902';
    const probeEntityType = 'E2EPagingProbe';
    let auditRowA: string;
    let auditRowB: string;
    let agentRowA: string;
    let agentRowB: string;
    let probeNewerId: string;
    let probeOlderId: string;

    function rowIds(result: CallToolResult): string[] {
      return parsePayload<{ data: Array<{ id: string }> }>(result).data.map(
        (row) => row.id,
      );
    }

    async function idOf(
      tenantId: string,
      create: () => Promise<{ id: string }>,
    ): Promise<string> {
      return (await inTenant(tenantId, create)).id;
    }

    /** Probe rows share one entity, so keyset paging orders them by occurred_at alone. */
    function createProbeRow(occurredAt: string): Promise<string> {
      return idOf(tenantA, () =>
        prisma.auditLog.create({
          data: {
            tenant_id: tenantA,
            entity_type: probeEntityType,
            entity_id: 'probe-1',
            action: 'UPDATE',
            actor_type: 'USER',
            occurred_at: new Date(occurredAt),
          },
        }),
      );
    }

    function createPagingAgentRow(
      agent: string,
      traceId: string,
      createdAt: string,
    ): Promise<{ id: string }> {
      return inTenant(tenantA, () =>
        prisma.agentActionLog.create({
          data: {
            tenant_id: tenantA,
            trace_id: traceId,
            actor_type: 'AGENT',
            agent_id: agent,
            action_type: 'mcp.search_customers',
            tier: 'AUTO',
            status: 'EXECUTED',
            input_summary_json: { tool: 'search_customers', args: {} },
            created_at: new Date(createdAt),
          },
        }),
      );
    }

    /** Pages through two rows one page at a time: the newer row with a next cursor, then the older row with none. */
    async function expectKeysetPaging(
      who: McpCaller,
      name: string,
      args: Record<string, unknown>,
      [newerId, olderId]: [string, string],
    ): Promise<void> {
      const expectedPages: Array<{ id: string; nextCursor: unknown }> = [
        { id: newerId, nextCursor: expect.any(String) },
        { id: olderId, nextCursor: null },
      ];
      let cursor: string | null = null;
      for (const expected of expectedPages) {
        const result = await callMcpTool(who, name, {
          ...args,
          pageSize: 1,
          ...(cursor ? { cursor } : {}),
        });
        const page = parsePayload<{ meta: { next_cursor: string | null } }>(
          result,
        );
        expect(rowIds(result)).toEqual([expected.id]);
        expect(page.meta.next_cursor).toEqual(expected.nextCursor);
        cursor = page.meta.next_cursor;
      }
    }

    /** A customer UPDATE audit row for the tenant. The actor is set only when a user made the change. */
    function createCustomerUpdate(input: {
      tenantId: string;
      entityId: string;
      requestId: string;
      before: Record<string, string>;
      after: Record<string, string>;
      actorUserId?: string;
    }): Promise<string> {
      return idOf(input.tenantId, () =>
        prisma.auditLog.create({
          data: {
            tenant_id: input.tenantId,
            entity_type: 'Customer',
            entity_id: input.entityId,
            action: 'UPDATE',
            actor_user_id: input.actorUserId,
            actor_type: 'USER',
            request_id: input.requestId,
            before: input.before,
            after: input.after,
          },
        }),
      );
    }

    /** A search agent action row for the tenant, as the MCP handler logs it. */
    function createSearchAgentRow(input: {
      tenantId: string;
      traceId: string;
      onBehalfOfUserId?: string;
    }): Promise<string> {
      return idOf(input.tenantId, () =>
        prisma.agentActionLog.create({
          data: {
            tenant_id: input.tenantId,
            trace_id: input.traceId,
            actor_type: 'AGENT',
            agent_id: 'mcp:e2e-audit-a',
            on_behalf_of_user_id: input.onBehalfOfUserId,
            action_type: 'mcp.search_customers',
            tier: 'AUTO',
            status: 'EXECUTED',
            input_summary_json: {
              tool: 'search_customers',
              args: { search: 'Erika' },
            },
          },
        }),
      );
    }

    beforeAll(async () => {
      auditRowA = await createCustomerUpdate({
        tenantId: tenantA,
        entityId: fixtures.customerId,
        requestId: traceA,
        actorUserId: tenantAUserId,
        before: {
          email: 'john.doe@example.com',
          phone: '+43 660 1234567',
          address: 'Musterstraße 12, 1010 Wien',
          notes: 'Call john.doe@example.com',
        },
        after: {
          email: 'erika@example.org',
          phone: '+43 660 7654321',
          address: 'Hauptplatz 1, 4020 Linz',
          notes: 'Call erika@example.org',
        },
      });
      auditRowB = await createCustomerUpdate({
        tenantId: tenantB,
        entityId: 'cust-b-1',
        requestId: traceB,
        before: { email: 'other@example.net' },
        after: { email: 'other2@example.net' },
      });
      agentRowA = await createSearchAgentRow({
        tenantId: tenantA,
        traceId: traceA,
        onBehalfOfUserId: tenantAUserId,
      });
      agentRowB = await createSearchAgentRow({
        tenantId: tenantB,
        traceId: traceB,
      });
      probeNewerId = await createProbeRow('2026-10-10T08:01:00.000Z');
      probeOlderId = await createProbeRow('2026-10-10T08:00:00.000Z');
    });

    it('lists audit events for the session tenant only', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-audit-list'),
        'list_audit_events',
        { entity_type: 'Customer', entity_id: fixtures.customerId },
      );

      expect(result.isError).not.toBe(true);
      const ids = rowIds(result);
      expect(ids).toContain(auditRowA);
      expect(ids).not.toContain(auditRowB);
      const owners = await inTenant(tenantA, () =>
        prisma.auditLog.findMany({
          where: { id: { in: ids } },
          select: { tenant_id: true },
        }),
      );
      expect(owners.every((owner) => owner.tenant_id === tenantA)).toBe(true);
    });

    it('masks contact values in entity history before they leave the server', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-audit-history'),
        'get_entity_history',
        { entity_type: 'Customer', entity_id: fixtures.customerId },
      );

      expect(result.isError).not.toBe(true);
      const text = toolPayloadText(result);
      expect(text).toContain('j***@example.com');
      expect(text).toContain('e***@example.org');
      expect(text).toContain('+** *** *****67');
      expect(text).toContain('"from":"***"');
      expect(text).not.toMatch(
        /john\.doe@example\.com|erika@example\.org|1234567|7654321|Musterstra/,
      );
    });

    it('keeps tenant B out of tenant A history and shows only its own rows', async () => {
      const otherTenantView = await callMcpTool(
        caller(adminHeaderB, 'e2e-audit-cross'),
        'get_entity_history',
        { entity_type: 'Customer', entity_id: fixtures.customerId },
      );
      expect(otherTenantView.isError).not.toBe(true);
      expect(toolPayloadText(otherTenantView)).not.toContain(auditRowA);
      expect(toolPayloadText(otherTenantView)).not.toMatch(/j\*\*\*@example/);

      const ownView = await callMcpTool(
        caller(adminHeaderB, 'e2e-audit-cross'),
        'get_entity_history',
        { entity_type: 'Customer', entity_id: 'cust-b-1' },
      );
      expect(toolPayloadText(ownView)).toContain(auditRowB);
      expect(toolPayloadText(ownView)).toContain('o***@example.net');
    });

    it('treats a trace from another tenant as not found', async () => {
      const result = await callMcpTool(
        caller(adminHeaderB, 'e2e-audit-cross'),
        'get_agent_action',
        { trace_id: traceA },
      );

      expect(result.isError).toBe(true);
    });

    it('returns the log rows and correlated audit entries for an own trace', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-audit-trace'),
        'get_agent_action',
        { trace_id: traceA },
      );

      expect(result.isError).not.toBe(true);
      const payload = parsePayload<{
        data: Array<{ id: string; tool: string | null }>;
        audit_entries: Array<{ id: string }>;
        audit_truncated: boolean;
        truncated: boolean;
      }>(result);
      expect(payload.data.map((row) => row.id)).toEqual([agentRowA]);
      expect(payload.data[0].tool).toBe('search_customers');
      expect(payload.audit_entries.map((entry) => entry.id)).toEqual([
        auditRowA,
      ]);
      expect(payload).toMatchObject({
        audit_truncated: false,
        truncated: false,
      });
    });

    it('filters agent actions by tool and never returns another tenant rows', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-audit-filter'),
        'list_agent_actions',
        { agent: 'mcp:e2e-audit-a', tool: 'search_customers' },
      );

      expect(result.isError).not.toBe(true);
      const ids = rowIds(result);
      expect(ids).toEqual([agentRowA]);
      expect(ids).not.toContain(agentRowB);
    });

    it('pages agent action rows with a keyset cursor until the last row', async () => {
      const agent = 'mcp:e2e-agent-page';
      const newer = await createPagingAgentRow(
        agent,
        '00000000-0000-4000-8000-000000000911',
        '2026-10-10T08:01:00.000Z',
      );
      const older = await createPagingAgentRow(
        agent,
        '00000000-0000-4000-8000-000000000912',
        '2026-10-10T08:00:00.000Z',
      );

      await expectKeysetPaging(
        caller(adminHeaderA, 'e2e-agent-page-read'),
        'list_agent_actions',
        { agent, tool: 'search_customers' },
        [newer.id, older.id],
      );
    });

    it('lists the supervisor-only reads as disabled in get_capabilities for SALES callers', async () => {
      await asRole('SALES', async () => {
        const page = await readAllCapabilities((args) =>
          callMcpTool(
            caller(salesHeaderA, 'e2e-caps-sales'),
            'get_capabilities',
            args,
          ),
        );
        const byTool = new Map(page.data.map((entry) => [entry.tool, entry]));
        expect(byTool.get('get_agent_action')).toMatchObject({
          enabled: false,
          disabled_reason: 'role_not_permitted',
        });
        expect(byTool.get('get_customer')).toMatchObject({ enabled: true });
      });
    });

    it('pages audit events with a keyset cursor until the last row', async () => {
      await expectKeysetPaging(
        caller(adminHeaderA, 'e2e-audit-page'),
        'list_audit_events',
        { entity_type: probeEntityType },
        [probeNewerId, probeOlderId],
      );
    });

    it('refuses SALES callers from every audit and agent action read', async () => {
      const reads: Array<[string, Record<string, unknown>]> = [
        ['list_audit_events', {}],
        [
          'get_entity_history',
          { entity_type: 'Customer', entity_id: fixtures.customerId },
        ],
        ['get_agent_action', { trace_id: traceA }],
        ['list_agent_actions', {}],
      ];

      await asRole('SALES', async () => {
        for (const [name, args] of reads) {
          const result = await callMcpTool(
            caller(salesHeaderA, 'e2e-audit-sales'),
            name,
            args,
          );
          expect(result.isError).toBe(true);
        }
      });
    });
  });

  describe('report reads (AUT-461)', () => {
    const PERIOD = { from: '2026-10-01', to: '2026-10-31' };
    type PickerlRow = {
      vehicle: { id: string };
      customer_name: string | null;
      status: string;
      due_date: string | null;
    };
    type PickerlPage = {
      data: PickerlRow[];
      meta: { total: number; page_size: number; next_cursor: string | null };
    };
    let overdueVehicleId: string;

    beforeAll(async () => {
      // A sticker that expired in January 2020 makes this vehicle overdue on the Pickerl list.
      // The engine reports UNKNOWN without a first registration date, so one is set.
      const vehicle = await createDraftVehicle('pickerl-overdue');
      overdueVehicleId = vehicle.vehicleId;
      await prismaA.vehicle.update({
        where: { id: overdueVehicleId },
        data: { first_registration_date: new Date('2015-03-01T00:00:00.000Z') },
      });
      await prismaA.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantA,
          vehicle_id: overdueVehicleId,
          inspection_type: 'PICKERL_57A',
          inspected_on: new Date('2020-01-15T00:00:00.000Z'),
          plaketten_valid_until_year: 2020,
          plaketten_valid_until_month: 1,
        },
      });
    });

    /** Whether a call fails, either as a tool error result or as a thrown error. */
    async function callFails(
      who: McpCaller,
      name: string,
      args: Record<string, unknown>,
    ): Promise<boolean> {
      try {
        return (await callMcpTool(who, name, args)).isError === true;
      } catch {
        return true;
      }
    }

    /** Every Pickerl row of the caller's tenant, followed through the opaque cursor. */
    function allPickerlRows(who: McpCaller): Promise<PickerlRow[]> {
      return withMcpSession(who.authHeader, who.clientName, async (session) => {
        const rows: PickerlRow[] = [];
        let cursor: string | undefined;
        do {
          const page = parsePayload<PickerlPage>(
            await session.call('list_pickerl_due', {
              pageSize: 25,
              ...(cursor ? { cursor } : {}),
            }),
          );
          rows.push(...page.data);
          cursor = page.meta.next_cursor ?? undefined;
        } while (cursor !== undefined && rows.length < 500);
        return rows;
      });
    }

    const MCP_PAGING_TOOL_NAMES = [
      'search_customers',
      'search_vehicles',
      'list_workshop_orders',
      'search_parts',
      'list_bays',
      'list_bins',
      'list_workshop_tasks',
      'get_capabilities',
      'list_sites',
      'list_audit_events',
      'get_entity_history',
      'get_agent_action',
      'list_agent_actions',
      'list_invoices',
      'list_documents',
      'list_purchase_orders',
      'list_vendors',
      'list_catalog_items',
      'list_price_lists',
      'list_margin_rules',
      'get_vehicle_stock_age_report',
      'get_vehicle_stock_margin_report',
      'list_pickerl_due',
      'list_workshop_slots',
      'list_available_loaners',
      'get_vehicle_context',
    ] as const;

    it('advertises pageSize and not page_size on every paging MCP tool (tools/list)', async () => {
      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-pagesize-schemas',
      );
      const tools = new Map(
        (await client.listTools()).tools.map((tool) => [tool.name, tool]),
      );
      await endMcpSession(transport);

      for (const name of MCP_PAGING_TOOL_NAMES) {
        const properties = tools.get(name)?.inputSchema.properties ?? {};
        expect(properties).toHaveProperty('pageSize');
        expect(properties).not.toHaveProperty('page_size');
        expect(properties.pageSize).toMatchObject({ maximum: 25 });
      }
    });

    it('pages search_customers when called with pageSize', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-search-customers-pagesize'),
        'search_customers',
        { search: fixtures.searchToken, pageSize: 1 },
      );
      expect(result.isError).not.toBe(true);
      const payload = parsePayload<{
        data: unknown[];
        meta: { page_size: number };
      }>(result);
      expect(payload.data.length).toBeLessThanOrEqual(1);
      expect(payload.meta.page_size).toBe(1);
    });

    it('returns the workshop KPI totals for the active site and period', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-kpi-own'),
        'get_workshop_kpi_report',
        PERIOD,
      );

      expect(result.isError).not.toBe(true);
      expect(parsePayload(result)).toMatchObject({
        site_id: fixtures.siteId,
        period: { from: PERIOD.from, to: PERIOD.to },
        parts_turnover: expect.any(Object),
      });
    });

    it('returns revenue report totals for the active site and period', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-revenue-own'),
        'get_revenue_report',
        PERIOD,
      );

      expect(result.isError).not.toBe(true);
      expect(parsePayload(result)).toMatchObject({
        site_id: fixtures.siteId,
        period: {
          from: PERIOD.from,
          to: PERIOD.to,
          timezone: expect.any(String),
        },
        totals: {
          net: expect.stringMatching(/^\d+\.\d{2}$/),
          vat: expect.stringMatching(/^\d+\.\d{2}$/),
          gross: expect.stringMatching(/^\d+\.\d{2}$/),
        },
        by_source: expect.any(Array),
        by_revenue_group: expect.any(Array),
        invoice_count: expect.any(Number),
      });
    });

    it('lists the overdue Pickerl vehicle of the session tenant with its due date and customer name', async () => {
      const rows = await allPickerlRows(
        caller(adminHeaderA, 'e2e-pickerl-own'),
      );

      expect(
        rows.find((row) => row.vehicle.id === overdueVehicleId),
      ).toMatchObject({
        status: 'OVERDUE',
        due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        customer_name: expect.any(String),
      });
    });

    it('never lists another tenant vehicles on the Pickerl list', async () => {
      const rows = await allPickerlRows(
        caller(adminHeaderB, 'e2e-pickerl-other'),
      );
      const ids = rows.map((row) => row.vehicle.id);

      expect(ids).not.toContain(overdueVehicleId);
      expect(ids).not.toContain(fixtures.vehicleId);
    });

    it('previews NoVA for an own vehicle with EUR strings and the Steuerberater note', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-nova-own'),
        'get_nova_preview',
        { vehicle_id: fixtures.vehicleId, net_price_eur: '12000.00' },
      );

      expect(result.isError).not.toBe(true);
      expect(parsePayload(result)).toMatchObject({
        vehicle_id: fixtures.vehicleId,
        net_price_eur: '12000.00',
        nova_eur: expect.stringMatching(/^\d+\.\d{2}$/),
        note: expect.stringContaining('Steuerberater'),
      });
    });

    it('does not preview NoVA for a vehicle of another tenant', async () => {
      expect(
        await callFails(
          caller(adminHeaderB, 'e2e-nova-cross'),
          'get_nova_preview',
          {
            vehicle_id: fixtures.vehicleId,
            net_price_eur: '12000.00',
          },
        ),
      ).toBe(true);
    });

    it('refuses another tenant site on the KPI and stock reports', async () => {
      const who = caller(adminHeaderB, 'e2e-site-cross');

      expect(
        await callFails(who, 'get_workshop_kpi_report', {
          ...PERIOD,
          site_id: fixtures.siteId,
        }),
      ).toBe(true);
      expect(
        await callFails(who, 'get_revenue_report', {
          ...PERIOD,
          site_id: fixtures.siteId,
        }),
      ).toBe(true);
      expect(
        await callFails(who, 'get_vehicle_stock_age_report', {
          site_id: fixtures.siteId,
        }),
      ).toBe(true);
      expect(
        await callFails(who, 'get_vehicle_stock_margin_report', {
          ...PERIOD,
          site_id: fixtures.siteId,
        }),
      ).toBe(true);
    });

    it('caps the paged report reads at 25 rows', async () => {
      const who = caller(adminHeaderA, 'e2e-report-cap');

      expect(await callFails(who, 'list_pickerl_due', { pageSize: 26 })).toBe(
        true,
      );
      expect(
        await callFails(who, 'get_vehicle_stock_age_report', { pageSize: 26 }),
      ).toBe(true);
      expect(
        await callFails(who, 'get_vehicle_stock_margin_report', {
          ...PERIOD,
          pageSize: 26,
        }),
      ).toBe(true);
    });
  });

  describe('invoice reads (AUT-456)', () => {
    type InvoiceListPayload = {
      data: Array<{
        id: string;
        status: string;
        total_gross: string;
        customer: { name: string };
      }>;
      meta: { page_size: number; next_cursor: string | null };
      truncated: boolean;
    };

    let olderInvoiceId: string;
    let oldestInvoiceId: string;

    function readInvoiceTool(
      authHeader: string,
      name: string,
      args: Record<string, unknown>,
    ): Promise<CallToolResult> {
      return callMcpTool(caller(authHeader, 'e2e-invoice-reads'), name, args);
    }

    /** A schema-rejected call is either an error result or a protocol error. */
    async function invoiceCallFails(
      authHeader: string,
      name: string,
      args: Record<string, unknown>,
    ): Promise<boolean> {
      try {
        return (await readInvoiceTool(authHeader, name, args)).isError === true;
      } catch {
        return true;
      }
    }

    function listedInvoiceIds(result: CallToolResult): string[] {
      return parsePayload<InvoiceListPayload>(result).data.map((row) => row.id);
    }

    beforeAll(async () => {
      const siteId = await resolveTestMainSiteId(prisma, tenantA);
      const older = await createDraftInvoice({
        customerId: fixtures.customerId,
        siteId,
        description: 'Reifen wechseln',
        date: new Date('2024-03-10T00:00:00.000Z'),
        unitPrice: 50,
      });
      const oldest = await createDraftInvoice({
        customerId: fixtures.customerId,
        siteId,
        description: 'Inspektion',
        date: new Date('2024-03-05T00:00:00.000Z'),
        unitPrice: 75,
      });
      olderInvoiceId = older.id;
      oldestInvoiceId = oldest.id;
    });

    it('lists a customer invoices newest first with name and gross total', async () => {
      const result = await readInvoiceTool(adminHeaderA, 'list_invoices', {
        customer_id: fixtures.customerId,
      });

      expect(result.isError).not.toBe(true);
      expect(listedInvoiceIds(result)).toEqual([
        fixtures.invoiceId,
        olderInvoiceId,
        oldestInvoiceId,
      ]);
      const payload = parsePayload<InvoiceListPayload>(result);
      expect(payload.data[0]).toMatchObject({
        status: 'DRAFT',
        total_gross: '120.00',
        customer: { name: `Mcp ${fixtures.searchToken}` },
      });
    });

    it('returns lines, totals, and the workshop order link for an own invoice', async () => {
      const result = await readInvoiceTool(adminHeaderA, 'get_invoice', {
        invoice_id: fixtures.invoiceId,
      });

      expect(result.isError).not.toBe(true);
      const payload = toolPayloadText(result);
      expect(JSON.parse(payload)).toMatchObject({
        id: fixtures.invoiceId,
        amount_source: 'stored',
        seller: null,
        totals: { net: '100.00', tax: '20.00', gross: '120.00' },
        lines: [
          {
            description: 'Ölwechsel inkl. Filter',
            quantity: '1.000',
            unit_net: '100.00',
            tax_rate: '20.00',
            net: '100.00',
            gross: '120.00',
          },
        ],
        workshop_order: {
          id: fixtures.workshopOrderId,
          order_number: `WO-${fixtures.searchToken}`,
        },
        customer: {
          id: fixtures.customerId,
          name: `Mcp ${fixtures.searchToken}`,
        },
      });
      expect(payload).not.toContain('@');
    });

    it('filters by order link, status, and number', async () => {
      const byOrder = await readInvoiceTool(adminHeaderA, 'list_invoices', {
        order_id: fixtures.workshopOrderId,
      });
      const paid = await readInvoiceTool(adminHeaderA, 'list_invoices', {
        customer_id: fixtures.customerId,
        status: 'PAID',
      });
      // Drafts have no invoice number until they are finalized.
      const byNumber = await readInvoiceTool(adminHeaderA, 'list_invoices', {
        customer_id: fixtures.customerId,
        number: 'RE-2026',
      });

      expect(listedInvoiceIds(byOrder)).toEqual([fixtures.invoiceId]);
      expect(listedInvoiceIds(paid)).toEqual([]);
      expect(listedInvoiceIds(byNumber)).toEqual([]);
    });

    it('filters by an inclusive UTC issue-date range', async () => {
      const result = await readInvoiceTool(adminHeaderA, 'list_invoices', {
        customer_id: fixtures.customerId,
        from: '2024-03-10',
        to: '2024-03-10',
      });

      expect(listedInvoiceIds(result)).toEqual([olderInvoiceId]);
    });

    it('pages with a keyset cursor until the last row', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await readInvoiceTool(adminHeaderA, 'list_invoices', {
          customer_id: fixtures.customerId,
          pageSize: 1,
          ...(cursor ? { cursor } : {}),
        });
        const payload = parsePayload<InvoiceListPayload>(result);
        expect(payload.data).toHaveLength(1);
        expect(payload.truncated).toBe(false);
        seen.push(...payload.data.map((row) => row.id));
        cursor = payload.meta.next_cursor ?? undefined;
      } while (cursor);

      expect(seen).toEqual([
        fixtures.invoiceId,
        olderInvoiceId,
        oldestInvoiceId,
      ]);
    });

    it('keeps tenant A invoices away from tenant B', async () => {
      const detail = await readInvoiceTool(adminHeaderB, 'get_invoice', {
        invoice_id: fixtures.invoiceId,
      });
      const list = await readInvoiceTool(adminHeaderB, 'list_invoices', {
        customer_id: fixtures.customerId,
      });

      expect(detail.isError).toBe(true);
      expect(listedInvoiceIds(list)).toEqual([]);
      expect(toolPayloadText(list)).not.toContain(fixtures.invoiceId);
    });

    it('lets SALES read invoices and rejects bad filters before any read', async () => {
      const salesList = await readInvoiceTool(
        salesHeaderA,
        'list_invoices',
        {},
      );

      expect(salesList.isError).not.toBe(true);
      expect(
        await invoiceCallFails(adminHeaderA, 'list_invoices', { pageSize: 26 }),
      ).toBe(true);
      expect(
        await invoiceCallFails(adminHeaderA, 'list_invoices', {
          from: '2026-10-10',
          to: '2026-10-01',
        }),
      ).toBe(true);
    });
  });

  describe('customer, vehicle history, and document reads (AUT-459)', () => {
    type OrderRow = {
      id: string;
      kind: string;
      number: string;
      status: string;
      vehicle: { id: string } | null;
      date: string;
      total_gross: string | null;
    };
    type DocumentRow = {
      id: string;
      type: string;
      name: string;
      created_at: string;
      entity: { type: string; id: string };
    };
    type DocumentPage = {
      data: DocumentRow[];
      meta: { page_size: number; next_cursor: string | null };
      truncated: boolean;
    };

    /** Trace IDs for the calls whose log rows this block checks. */
    const AUT459_TRACE_IDS = {
      documentLink: '00000000-0000-4000-8000-0000000004a1',
    };

    let historyToken: string;
    let historyCustomerId: string;
    let historyVehicleId: string;
    let historyWorkshopOrderId: string;
    let historySalesOrderId: string;
    let historyInvoiceId: string;
    let historyInvoiceNumber: string;
    let historyInvoiceArchiveKey: string;
    let historyOtherSiteId: string;
    let historyOtherSiteOrderId: string;
    let historyMainSiteClaimId: string;
    let historyOtherSiteClaimId: string;
    let otherTenantCustomerId: string;
    let otherTenantVehicleId: string;
    let otherTenantDocumentId: string;

    function historyCall(
      name: string,
      args: Record<string, unknown>,
      traceId?: string,
    ): Promise<CallToolResult> {
      return callMcpTool(
        caller(adminHeaderA, 'e2e-history-reads'),
        name,
        args,
        traceId,
      );
    }

    /** A schema-rejected call is either an error result or a protocol error. */
    async function historyCallFails(
      name: string,
      args: Record<string, unknown>,
    ): Promise<boolean> {
      try {
        return (await historyCall(name, args)).isError === true;
      } catch {
        return true;
      }
    }

    /** The error text of a history call that must fail; empty when the call succeeds. */
    async function historyCallErrorText(
      name: string,
      args: Record<string, unknown>,
    ): Promise<string> {
      try {
        const result = await historyCall(name, args);
        return result.isError === true ? toolPayloadText(result) : '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    afterAll(async () => {
      // Each delete is guarded: an undefined id would match every row of the tenant.
      if (historySalesOrderId) {
        // The shared tenant cleanup does not remove sales orders, and they block the customer delete.
        await prismaA.salesOrder.deleteMany({
          where: { id: historySalesOrderId },
        });
      }
      if (historyOtherSiteOrderId) {
        await prismaA.warrantyClaim.deleteMany({
          where: { workshop_order_id: historyOtherSiteOrderId },
        });
        await prismaA.workshopOrder.deleteMany({
          where: { id: historyOtherSiteOrderId },
        });
      }
      if (historyWorkshopOrderId) {
        await prismaA.warrantyClaim.deleteMany({
          where: { workshop_order_id: historyWorkshopOrderId },
        });
      }
      if (historyOtherSiteId) {
        await prismaA.site.deleteMany({ where: { id: historyOtherSiteId } });
      }
    });

    beforeAll(async () => {
      const siteId = await resolveTestMainSiteId(prisma, tenantA);
      historyToken = `History${Date.now()}`;

      const customer = await prismaA.customer.create({
        data: {
          first_name: 'History',
          last_name: historyToken,
          email: `history-${Date.now()}@example.com`,
        },
      });
      const vehicle = await prismaA.vehicle.create({
        data: {
          make: 'Test',
          model: 'History',
          year: 2019,
          vin: `VIN-${historyToken}`,
          plate: `HX-${Date.now()}`,
          customer_id: customer.id,
        },
      });
      await prismaA.vehicleInspectionRecord.create({
        data: {
          vehicle_id: vehicle.id,
          inspection_type: 'PICKERL_57A',
          inspected_on: new Date('2026-03-01T00:00:00.000Z'),
          plaketten_valid_until_year: 2028,
          plaketten_valid_until_month: 3,
          station_name: 'Pruefstelle Test',
        },
      });
      const workshopOrder = await prismaA.workshopOrder.create({
        data: {
          order_number: `WO-${historyToken}`,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          site_id: siteId,
          odometer: 2000,
          fuel_level: 60,
          status: 'INTAKE',
          pdf_storage_bucket: 'e2e-pdf-archive',
          pdf_storage_key: `job-cards/${historyToken}.pdf`,
          pdf_generated_at: new Date('2026-10-02T09:00:00.000Z'),
        },
        select: { id: true },
      });
      historyInvoiceNumber = `RE-${historyToken}`;
      historyInvoiceArchiveKey = `invoices/archive/${historyToken}.pdf`;
      const invoice = await prismaA.invoice.create({
        data: {
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          workshop_order_id: workshopOrder.id,
          site_id: siteId,
          status: 'FINALIZED',
          invoice_number: historyInvoiceNumber,
          date: new Date('2026-10-01T09:00:00.000Z'),
          due_date: new Date('2026-12-31T00:00:00.000Z'),
          currency: 'EUR',
          total_net: 200,
          total_tax: 40,
          total_gross: 240,
          pdf_archive_bucket: 'e2e-pdf-archive',
          pdf_archive_key: historyInvoiceArchiveKey,
          pdf_archive_generation: '1',
          pdf_archive_sha256: 'a'.repeat(64),
          pdf_generated_at: new Date('2026-10-01T09:00:00.000Z'),
        },
        select: { id: true },
      });
      // Created after the work order, so the sales order is the newest order.
      const salesOrder = await prismaA.salesOrder.create({
        data: {
          order_number: `SO-${historyToken}`,
          customer_id: customer.id,
          site_id: siteId,
          status: 'DRAFT',
          total_amount: 100,
        },
        select: { id: true },
      });

      // Another tenant's customer, vehicle, and job card, to probe isolation.
      const prismaB = createTenantAwarePrisma(prisma, tenantB);
      const siteIdB = await resolveTestMainSiteId(prisma, tenantB);
      const customerB = await prismaB.customer.create({
        data: {
          first_name: 'Other',
          last_name: `Tenant${historyToken}`,
          email: `other-tenant-${Date.now()}@example.com`,
        },
      });
      const vehicleB = await prismaB.vehicle.create({
        data: {
          make: 'Test',
          model: 'Other',
          year: 2018,
          vin: `VIN-B-${historyToken}`,
          customer_id: customerB.id,
        },
      });
      const orderB = await prismaB.workshopOrder.create({
        data: {
          order_number: `WO-B-${historyToken}`,
          customer_id: customerB.id,
          vehicle_id: vehicleB.id,
          site_id: siteIdB,
          odometer: 500,
          fuel_level: 40,
          status: 'INTAKE',
          pdf_storage_bucket: 'e2e-pdf-archive',
          pdf_storage_key: `job-cards/b-${historyToken}.pdf`,
          pdf_generated_at: new Date('2026-10-03T09:00:00.000Z'),
        },
        select: { id: true },
      });

      // The same customer and vehicle, with a job card at a second site of this tenant.
      const mainSite = await prismaA.site.findFirstOrThrow({
        where: { id: siteId, tenant_id: tenantA },
        select: { legal_entity_id: true },
      });
      const otherSite = await prismaA.site.create({
        data: {
          tenant_id: tenantA,
          legal_entity_id: mainSite.legal_entity_id,
          code: `E2E-OTHER-${Date.now()}`,
          name: 'E2E other site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        },
      });
      historyOtherSiteId = otherSite.id;
      const otherSiteOrder = await prismaA.workshopOrder.create({
        data: {
          order_number: `WO-OTHER-${historyToken}`,
          customer_id: customer.id,
          vehicle_id: vehicle.id,
          site_id: otherSite.id,
          odometer: 2000,
          fuel_level: 40,
          status: 'INTAKE',
          pdf_storage_bucket: 'e2e-pdf-archive',
          pdf_storage_key: `job-cards/other-${historyToken}.pdf`,
          pdf_generated_at: new Date('2026-10-04T09:00:00.000Z'),
        },
        select: { id: true },
      });
      historyOtherSiteOrderId = otherSiteOrder.id;

      const mainSiteClaim = await prismaA.warrantyClaim.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: workshopOrder.id,
          type: 'GEWAEHRLEISTUNG',
        },
        select: { id: true },
      });
      const otherSiteClaim = await prismaA.warrantyClaim.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: otherSiteOrder.id,
          type: 'GEWAEHRLEISTUNG',
        },
        select: { id: true },
      });
      historyMainSiteClaimId = mainSiteClaim.id;
      historyOtherSiteClaimId = otherSiteClaim.id;

      historyCustomerId = customer.id;
      historyVehicleId = vehicle.id;
      historyWorkshopOrderId = workshopOrder.id;
      historySalesOrderId = salesOrder.id;
      historyInvoiceId = invoice.id;
      otherTenantCustomerId = customerB.id;
      otherTenantVehicleId = vehicleB.id;
      otherTenantDocumentId = `workshop_order:${orderB.id}`;
    });

    it.each<[string, () => Record<string, unknown>, string[]]>([
      [
        'get_vehicle_history',
        () => ({ vehicle_id: historyVehicleId }),
        ['vehicle', 'pickerl_due', 'orders', 'inspections', 'documents'],
      ],
      [
        'list_documents',
        () => ({ entity_type: 'customer', entity_id: historyCustomerId }),
        ['data', 'meta', 'truncated'],
      ],
      [
        'get_document_pdf',
        () => ({ id: `invoice:${historyInvoiceId}` }),
        ['id', 'type', 'name', 'created_at', 'entity', 'content_type', 'link'],
      ],
      [
        'get_customer',
        () => ({ customer_id: historyCustomerId }),
        ['vehicles', 'orders', 'email', 'first_name'],
      ],
    ])('returns the documented shape from %s', async (toolName, args, keys) => {
      const result = await historyCall(toolName, args());

      expect(result.isError).not.toBe(true);
      expect(
        Object.keys(parsePayload<Record<string, unknown>>(result)),
      ).toEqual(expect.arrayContaining(keys));
    });

    it.each<[string, () => Record<string, unknown>]>([
      ['list_documents', () => ({ pageSize: 26 })],
      ['list_documents', () => ({ entity_type: 'vehicle' })],
      ['list_documents', () => ({ cursor: 'not-a-cursor' })],
      ['get_document_pdf', () => ({ id: 'invoice:123' })],
      ['get_vehicle_history', () => ({ vehicle_id: 'not-a-uuid' })],
      [
        'get_customer',
        () => ({ customer_id: historyCustomerId, orders_page_size: 26 }),
      ],
    ])(
      'rejects an invalid %s call before any lookup',
      async (toolName, args) => {
        expect(await historyCallFails(toolName, args())).toBe(true);
      },
    );

    it('lists the customer orders newest first, with the gross total of the linked invoice', async () => {
      const payload = parsePayload<{
        vehicles: Array<{ id: string }>;
        orders: { data: OrderRow[] };
        workshop_orders?: unknown;
        sales_orders?: unknown;
        invoices?: unknown;
      }>(await historyCall('get_customer', { customer_id: historyCustomerId }));

      expect(payload.vehicles.map((vehicle) => vehicle.id)).toEqual([
        historyVehicleId,
      ]);
      expect(payload.orders.data).toEqual([
        expect.objectContaining({
          id: historySalesOrderId,
          kind: 'sales_order',
          total_gross: null,
          vehicle: null,
        }),
        expect.objectContaining({
          id: historyWorkshopOrderId,
          kind: 'workshop_order',
          total_gross: '240.00',
          vehicle: expect.objectContaining({ id: historyVehicleId }),
        }),
      ]);
      expect(payload).not.toHaveProperty('workshop_orders');
      expect(payload).not.toHaveProperty('sales_orders');
      expect(payload).not.toHaveProperty('invoices');
    });

    it('returns the vehicle orders, Pickerl status, inspection, and documents', async () => {
      const payload = parsePayload<{
        vehicle: { id: string };
        pickerl_due: { last_inspected_on: string | null };
        orders: { data: OrderRow[] };
        inspections: {
          data: Array<Record<string, unknown>>;
          meta: { total: number };
        };
        documents: DocumentPage;
      }>(
        await historyCall('get_vehicle_history', {
          vehicle_id: historyVehicleId,
        }),
      );

      expect(payload.vehicle.id).toBe(historyVehicleId);
      expect(payload.pickerl_due.last_inspected_on).toBe('2026-03-01');
      expect(payload.orders.data.map((order) => order.id)).toEqual([
        historyWorkshopOrderId,
      ]);
      expect(payload.inspections.meta).toEqual({ total: 1 });
      expect(payload.inspections.data).toEqual([
        expect.objectContaining({
          inspection_type: 'PICKERL_57A',
          inspected_on: '2026-03-01',
          plaketten_valid_until: '2028-03',
          station_name: 'Pruefstelle Test',
        }),
      ]);
      expect(payload.documents.data.map((document) => document.id)).toEqual([
        `workshop_order:${historyWorkshopOrderId}`,
        `invoice:${historyInvoiceId}`,
      ]);
    });

    it('lists documents newest first and pages them across both sources without repeats', async () => {
      const filter = {
        entity_type: 'customer',
        entity_id: historyCustomerId,
      };
      const everything = parsePayload<DocumentPage>(
        await historyCall('list_documents', filter),
      );
      const firstPage = parsePayload<DocumentPage>(
        await historyCall('list_documents', { ...filter, pageSize: 1 }),
      );
      const secondPage = parsePayload<DocumentPage>(
        await historyCall('list_documents', {
          ...filter,
          pageSize: 1,
          cursor: firstPage.meta.next_cursor ?? undefined,
        }),
      );

      expect(everything.data.map((document) => document.id)).toEqual([
        `workshop_order:${historyWorkshopOrderId}`,
        `invoice:${historyInvoiceId}`,
      ]);
      expect(firstPage.data.map((document) => document.id)).toEqual([
        `workshop_order:${historyWorkshopOrderId}`,
      ]);
      expect(firstPage.meta.next_cursor).not.toBeNull();
      expect(secondPage.data.map((document) => document.id)).toEqual([
        `invoice:${historyInvoiceId}`,
      ]);
      expect(secondPage.meta.next_cursor).toBeNull();
    });

    it('returns metadata and a read link that expires within 15 minutes, with no PDF bytes', async () => {
      const result = await historyCall(
        'get_document_pdf',
        { id: `invoice:${historyInvoiceId}` },
        AUT459_TRACE_IDS.documentLink,
      );

      expect(result.isError).not.toBe(true);
      expect(toolPayloadText(result)).not.toContain('%PDF');
      const payload = parsePayload<{
        id: string;
        type: string;
        name: string;
        content_type: string;
        entity: { type: string; id: string };
        link: { url: string; expires_at: string };
      }>(result);
      expect(payload).toMatchObject({
        id: `invoice:${historyInvoiceId}`,
        type: 'invoice',
        name: `invoice-${historyInvoiceNumber}.pdf`,
        content_type: 'application/pdf',
        entity: { type: 'invoice', id: historyInvoiceId },
      });
      expect(payload.link.url).toMatch(/^https:\/\/storage\.example\.test\//);
      const expiresInMs = Date.parse(payload.link.expires_at) - Date.now();
      expect(expiresInMs).toBeGreaterThan(0);
      expect(expiresInMs).toBeLessThanOrEqual(15 * 60 * 1000);
      // The immutable archive is signed, for at most 15 minutes.
      expect(pdfArchive.signedReads.at(-1)).toMatchObject({
        bucket: 'e2e-pdf-archive',
        key: historyInvoiceArchiveKey,
        filename: `invoice-${historyInvoiceNumber}.pdf`,
        ttlSeconds: 900,
      });
    });

    it('logs the link generation with the document and expiry, and never the URL', async () => {
      const row = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: AUT459_TRACE_IDS.documentLink,
          action_type: 'mcp.get_document_pdf',
        },
      });

      expect(row).toBeTruthy();
      expect(row?.tier).toBe('AUTO');
      const summary = JSON.stringify(row?.result_summary_json ?? null);
      expect(summary).toContain(`invoice:${historyInvoiceId}`);
      expect(summary).toContain('link_expires_at');
      expect(summary).not.toContain('X-Goog-Signature');
      expect(summary).not.toContain('storage.example.test');
    });

    it('does not reveal a document or order at another site of the same tenant', async () => {
      const documentId = `workshop_order:${historyOtherSiteOrderId}`;
      expect(
        await historyCallErrorText('get_document_pdf', { id: documentId }),
      ).toContain(`Document with ID ${documentId} not found`);

      const listed = parsePayload<DocumentPage>(
        await historyCall('list_documents', {
          entity_type: 'customer',
          entity_id: historyCustomerId,
        }),
      );
      expect(listed.data.map((row) => row.id)).not.toContain(documentId);

      const detail = parsePayload<{ orders: { data: OrderRow[] } }>(
        await historyCall('get_customer', { customer_id: historyCustomerId }),
      );
      expect(detail.orders.data.map((row) => row.id)).not.toContain(
        historyOtherSiteOrderId,
      );

      const vehicleContext = parsePayload<{
        sections: {
          open_workshop?: {
            state: string;
            data?: Array<{ id: string }>;
            meta?: { total: number };
          };
          documents?: {
            state: string;
            data?: Array<{ id: string }>;
            meta?: { total: number };
          };
          warranty_claims?: {
            state: string;
            data?: Array<{ id: string }>;
            meta?: { total: number };
          };
          warranty_periods?: {
            state: string;
            data?: unknown[];
            meta?: { total: number };
          };
        };
      }>(
        await historyCall('get_vehicle_context', {
          vehicle_id: historyVehicleId,
          sections: [
            'open_workshop',
            'documents',
            'warranty_claims',
            'warranty_periods',
          ],
        }),
      );
      const openIds =
        vehicleContext.sections.open_workshop?.state === 'ok'
          ? (vehicleContext.sections.open_workshop.data ?? []).map((row) => row.id)
          : [];
      expect(openIds).not.toContain(historyOtherSiteOrderId);
      expect(vehicleContext.sections.open_workshop?.meta?.total ?? 0).toBe(
        openIds.length,
      );
      const documentIds =
        vehicleContext.sections.documents?.state === 'ok'
          ? (vehicleContext.sections.documents.data ?? []).map((row) => row.id)
          : [];
      expect(documentIds).not.toContain(documentId);

      const claims = vehicleContext.sections.warranty_claims;
      expect(claims?.state).toBe('ok');
      if (claims?.state === 'ok') {
        expect(claims.meta?.total).toBe(1);
        expect(claims.data?.map((row) => row.id)).toEqual([
          historyMainSiteClaimId,
        ]);
        expect(claims.data?.map((row) => row.id)).not.toContain(
          historyOtherSiteClaimId,
        );
      }
      expect(vehicleContext.sections.warranty_periods?.meta?.total ?? 0).toBe(
        vehicleContext.sections.warranty_periods?.state === 'ok'
          ? (vehicleContext.sections.warranty_periods.data?.length ?? 0)
          : 0,
      );
    });

    it('does not reveal another tenant document, customer, or vehicle', async () => {
      expect(
        await historyCallErrorText('get_document_pdf', {
          id: otherTenantDocumentId,
        }),
      ).toContain(`Document with ID ${otherTenantDocumentId} not found`);
      expect(
        await historyCallErrorText('get_vehicle_history', {
          vehicle_id: otherTenantVehicleId,
        }),
      ).toContain(`Vehicle with ID ${otherTenantVehicleId} not found`);
      expect(
        await historyCallErrorText('get_vehicle_context', {
          vehicle_id: otherTenantVehicleId,
        }),
      ).toContain(`Vehicle with ID ${otherTenantVehicleId} not found`);

      const listed = parsePayload<DocumentPage>(
        await historyCall('list_documents', {
          entity_type: 'customer',
          entity_id: otherTenantCustomerId,
        }),
      );
      expect(listed.data).toEqual([]);

      const reverse = await withMcpSession(
        adminHeaderB,
        'e2e-history-tenant-b',
        (session) =>
          session.call('get_document_pdf', {
            id: `invoice:${historyInvoiceId}`,
          }),
      );
      expect(reverse.isError).toBe(true);
    });
  });

  describe('settings reads (AUT-457)', () => {
    /** Fictional bank and voice values, written for this suite only. */
    const BANK_IBAN = 'AT611904300234573201';
    const VOICE_PROJECT = 'e2e-settings-voice-project';
    const VOICE_SERVICE_ACCOUNT = 'e2e-settings-encrypted-service-account';

    let tenantBSiteId: string;
    let tenantBLegalEntityId: string;
    let tenantBLegalEntityName: string;
    let secondSiteId: string;

    beforeAll(async () => {
      await inTenant(tenantA, async () => {
        await prisma.legalEntity.update({
          where: { id: fixtures.legalEntityId },
          data: {
            iban: BANK_IBAN,
            bic: 'TESTATWW',
            bank_name: 'Testbank Wien',
          },
        });
        await prisma.voiceTranslationSettings.upsert({
          where: { tenant_id: tenantA },
          update: {
            google_project_id: VOICE_PROJECT,
            google_service_account_encrypted: VOICE_SERVICE_ACCOUNT,
          },
          create: {
            tenant_id: tenantA,
            google_project_id: VOICE_PROJECT,
            google_service_account_encrypted: VOICE_SERVICE_ACCOUNT,
          },
        });
      });

      // A second active site, so list_sites has more than one page to walk.
      const second = await inTenant(tenantA, () =>
        prisma.site.create({
          data: {
            legal_entity_id: fixtures.legalEntityId,
            code: 'E2E-2',
            name: 'Zweigstelle E2E',
          },
        }),
      );
      secondSiteId = second.id;

      tenantBSiteId = await resolveTestMainSiteId(prisma, tenantB);
      const site = await inTenant(tenantB, () =>
        prisma.site.findFirstOrThrow({
          where: { id: tenantBSiteId },
          select: { legal_entity: { select: { id: true, name: true } } },
        }),
      );
      tenantBLegalEntityId = site.legal_entity.id;
      tenantBLegalEntityName = site.legal_entity.name;
    });

    // The tenant graph cleanup does not cover voice settings, so remove the row before it runs.
    afterAll(async () => {
      await inTenant(tenantA, () =>
        prisma.voiceTranslationSettings.deleteMany({
          where: { tenant_id: tenantA },
        }),
      );
    });

    const settingsCall = (name: string, args: Record<string, unknown> = {}) =>
      callMcpTool(caller(adminHeaderA, 'e2e-settings-reads'), name, args);

    it.each<[string, Record<string, unknown>, string[]]>([
      [
        'get_tenant_settings',
        {},
        [
          'currency',
          'active_site_timezone',
          'feature_flags',
          'document_branding',
        ],
      ],
      ['list_sites', {}, ['data', 'meta']],
      [
        'get_legal_entity',
        {},
        [
          'id',
          'seller',
          'bank',
          'payment_terms',
          'seller_readiness',
          'accounting_profile',
          'tax_rates',
          'number_ranges',
        ],
      ],
    ])('returns the documented shape from %s', async (toolName, args, keys) => {
      const result = await settingsCall(toolName, args);

      expect(result.isError).not.toBe(true);
      expect(
        Object.keys(parsePayload<Record<string, unknown>>(result)),
      ).toEqual(expect.arrayContaining(keys));
    });

    it('reports the currency, the decision apply mode, and the active site timezone', async () => {
      const settings = parsePayload<{
        currency: string;
        active_site_timezone: string | null;
        feature_flags: { decision_apply_mode: string };
      }>(await settingsCall('get_tenant_settings'));

      expect(settings.currency).toBe('EUR');
      expect(settings.feature_flags.decision_apply_mode).toMatch(
        /^(shadow|live)$/,
      );
      expect(settings.active_site_timezone).toEqual(expect.any(String));
    });

    it('reports voice translation as configured without returning its secret material', async () => {
      const result = await settingsCall('get_tenant_settings');

      expect(
        parsePayload<{
          feature_flags: { voice_translation: { configured: boolean } };
        }>(result).feature_flags.voice_translation.configured,
      ).toBe(true);
      expect(toolPayloadText(result)).not.toContain(VOICE_PROJECT);
      expect(toolPayloadText(result)).not.toContain(VOICE_SERVICE_ACCOUNT);
    });

    it('masks the bank identifiers of the active legal entity to their last four characters', async () => {
      const result = await settingsCall('get_legal_entity');

      expect(
        parsePayload<{ bank: Record<string, string> }>(result).bank,
      ).toEqual({
        iban: '****3201',
        bic: '****ATWW',
        bank_name: '****Wien',
      });
      expect(toolPayloadText(result)).not.toContain(BANK_IBAN);
    });

    it('lists only the session tenant sites, with an address summary and an active flag', async () => {
      const page = parsePayload<{
        data: { id: string; active: boolean; address_summary: string | null }[];
      }>(await settingsCall('list_sites', { pageSize: 25 }));
      const ids = page.data.map((row) => row.id);

      expect(ids).toContain(fixtures.siteId);
      expect(ids).not.toContain(tenantBSiteId);
      expect(page.data.every((row) => typeof row.active === 'boolean')).toBe(
        true,
      );
    });

    it('pages list_sites with pageSize and an opaque cursor, without gaps or repeats', async () => {
      const everySite = parsePayload<{ data: { id: string }[] }>(
        await settingsCall('list_sites', { pageSize: 25 }),
      ).data.map((row) => row.id);
      expect(everySite).toEqual(
        expect.arrayContaining([fixtures.siteId, secondSiteId]),
      );
      expect(everySite.length).toBeGreaterThanOrEqual(2);

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = parsePayload<{
          data: { id: string }[];
          meta: { next_cursor: string | null };
        }>(await settingsCall('list_sites', { pageSize: 1, cursor }));
        expect(page.data).toHaveLength(1);
        seen.push(page.data[0].id);
        cursor = page.meta.next_cursor ?? undefined;
      } while (cursor !== undefined && seen.length <= everySite.length);

      expect(seen).toEqual(everySite);
    });

    it.each<[string, Record<string, unknown>]>([
      ['list_sites', { pageSize: 26 }],
      ['list_sites', { cursor: 'not a cursor!' }],
      ['get_legal_entity', { legal_entity_id: 'not-a-uuid' }],
    ])('rejects an invalid %s call: %j', async (toolName, args) => {
      const result = await settingsCall(toolName, args);

      expect(result.isError).toBe(true);
    });

    it('returns an error for a legal entity of another tenant', async () => {
      const result = await settingsCall('get_legal_entity', {
        legal_entity_id: tenantBLegalEntityId,
      });

      expect(result.isError).toBe(true);
      expect(toolPayloadText(result)).not.toContain(tenantBLegalEntityName);
    });

    it('shows tenant B none of the settings of tenant A', async () => {
      const result = await withMcpSession(
        adminHeaderB,
        'e2e-settings-tenant-b',
        (session) => session.call('get_tenant_settings', {}),
      );
      const payload = toolPayloadText(result);

      expect(result.isError).not.toBe(true);
      expect(payload).not.toContain(VOICE_PROJECT);
      expect(payload).not.toContain(BANK_IBAN);
      expect(payload).not.toContain(fixtures.legalEntityId);
    });
  });

  describe('purchasing reads (AUT-458)', () => {
    type PurchasingPage = {
      data: Array<{ id: string } & Record<string, unknown>>;
      meta: { page_size: number; next_cursor: string | null };
      truncated: boolean;
    };

    type PurchaseOrderDetail = {
      id: string;
      status: string;
      currency: string;
      vendor: { id: string; name: string };
      totals: { net: string };
      lines: Array<{
        part: { id: string; sku: string; name: string };
        quantity_ordered: string;
        quantity_received: string;
        unit_cost_net: string;
        line_net: string;
      }>;
      lines_total: number;
      lines_truncated: boolean;
      receipts: { movement_count: number; last_received_at: string | null };
    };

    /** Orders and vendors this block adds, dated in 2024 so the date window excludes the seeded order. */
    const DATE_WINDOW = { from: '2024-03-01', to: '2024-03-31' };
    let partBId: string;
    let olderVendorId: string;
    let oldestVendorId: string;
    let partialOrderId: string;
    let completedOrderId: string;

    function purchasingCall(
      name: string,
      args: Record<string, unknown>,
    ): Promise<CallToolResult> {
      return callMcpTool(
        caller(adminHeaderA, 'e2e-purchasing-reads'),
        name,
        args,
      );
    }

    /** A schema-rejected call is either an error result or a protocol error. */
    async function purchasingCallFails(
      name: string,
      args: Record<string, unknown>,
    ): Promise<boolean> {
      try {
        return (await purchasingCall(name, args)).isError === true;
      } catch {
        return true;
      }
    }

    /** Follows meta.next_cursor one page at a time and returns every row ID in order. */
    async function walkPages(
      name: string,
      args: Record<string, unknown>,
      pageSize: number,
    ): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const result = await purchasingCall(name, {
          ...args,
          pageSize,
          ...(cursor ? { cursor } : {}),
        });
        expect(result.isError).not.toBe(true);
        const body = parsePayload<PurchasingPage>(result);
        ids.push(...body.data.map((row) => row.id));
        cursor = body.meta.next_cursor ?? undefined;
        if (!cursor) {
          return ids;
        }
      }
      throw new Error('purchasing pages did not end within 20 pages');
    }

    beforeAll(async () => {
      const siteId = await resolveTestMainSiteId(prisma, tenantA);
      const token = fixtures.searchToken;
      const partB = await prismaA.catalogItem.create({
        data: {
          sku: `SKU-${token}-B`,
          name: `${token} B`,
          cost_price: 1,
          retail_price: 2,
        },
      });
      partBId = partB.id;
      const older = await prismaA.vendor.create({
        data: {
          tenant_id: tenantA,
          name: `Musterlieferant Nord ${token}`,
          email: `nord-${token}@example.com`,
          account_number: `NORD-${token}`,
          createdAt: new Date('2024-03-10T00:00:00.000Z'),
        },
      });
      const oldest = await prismaA.vendor.create({
        data: {
          tenant_id: tenantA,
          name: `Musterlieferant Alt ${token}`,
          email: `alt-${token}@example.com`,
          account_number: `ALT-${token}`,
          createdAt: new Date('2024-03-05T00:00:00.000Z'),
        },
      });
      olderVendorId = older.id;
      oldestVendorId = oldest.id;

      // 1.5 x 3.33 is 4.995 and rounds half-up to 5.00 on the line; the order total is 5.30.
      const partial = await prismaA.purchaseOrder.create({
        data: {
          tenant_id: tenantA,
          site_id: siteId,
          vendor_id: older.id,
          status: 'PARTIAL',
          order_number: `PO-${token}-B`,
          createdAt: new Date('2024-03-10T08:00:00.000Z'),
          items: {
            create: [
              {
                tenant_id: tenantA,
                catalog_item_id: fixtures.catalogItemId,
                quantity: 1.5,
                unit_cost: 3.33,
                createdAt: new Date('2024-03-10T08:00:00.000Z'),
              },
              {
                tenant_id: tenantA,
                catalog_item_id: partB.id,
                quantity: 3,
                unit_cost: 0.1,
                createdAt: new Date('2024-03-10T08:01:00.000Z'),
              },
            ],
          },
        },
      });
      partialOrderId = partial.id;

      const completed = await prismaA.purchaseOrder.create({
        data: {
          tenant_id: tenantA,
          site_id: siteId,
          vendor_id: oldest.id,
          status: 'COMPLETED',
          order_number: `PO-${token}-C`,
          createdAt: new Date('2024-03-05T08:00:00.000Z'),
          items: {
            create: [
              {
                tenant_id: tenantA,
                catalog_item_id: fixtures.catalogItemId,
                quantity: 2,
                quantity_received: 2,
                unit_cost: 7,
                createdAt: new Date('2024-03-05T08:00:00.000Z'),
              },
            ],
          },
        },
      });
      completedOrderId = completed.id;
      // One goods-receipt movement, keyed by the order number as the receipt service writes it.
      await prismaA.inventoryTransaction.create({
        data: {
          tenant_id: tenantA,
          site_id: siteId,
          item_id: fixtures.catalogItemId,
          location_id: fixtures.locationId,
          quantity: 2,
          type: 'PURCHASE_RECEIPT',
          reference_id: completed.order_number,
          cost_basis: 7,
          createdAt: new Date('2024-03-06T10:00:00.000Z'),
        },
      });
    });

    it('lists purchase orders for a vendor with compact rows and net EUR totals', async () => {
      const result = await purchasingCall('list_purchase_orders', {
        vendor_id: fixtures.vendorId,
      });

      expect(result.isError).not.toBe(true);
      expect(parsePayload<PurchasingPage>(result).data).toEqual([
        {
          id: fixtures.purchaseOrderId,
          number: fixtures.purchaseOrderNumber,
          status: 'SENT',
          vendor: { id: fixtures.vendorId, name: fixtures.vendorName },
          ordered_at: expect.any(String),
          total_net: '50.00',
        },
      ]);
    });

    it('filters by status, vendor, part, and an inclusive order date window', async () => {
      const idsFor = async (args: Record<string, unknown>) =>
        parsePayload<PurchasingPage>(
          await purchasingCall('list_purchase_orders', args),
        ).data.map((row) => row.id);

      expect(await idsFor({ status: 'COMPLETED' })).toEqual([completedOrderId]);
      expect(await idsFor({ vendor_id: olderVendorId })).toEqual([
        partialOrderId,
      ]);
      expect(await idsFor({ part_id: partBId })).toEqual([partialOrderId]);
      expect(await idsFor({ part_id: fixtures.catalogItemId })).toEqual([
        fixtures.purchaseOrderId,
        partialOrderId,
        completedOrderId,
      ]);
      expect(await idsFor(DATE_WINDOW)).toEqual([
        partialOrderId,
        completedOrderId,
      ]);
      expect(await idsFor({ from: '2024-03-06', to: '2024-03-31' })).toEqual([
        partialOrderId,
      ]);
      // Both bounds are inclusive: an order created on the bound day is listed.
      expect(await idsFor({ to: '2024-03-10' })).toEqual([
        partialOrderId,
        completedOrderId,
      ]);
      expect(await idsFor({ from: '2024-03-10', to: '2024-03-10' })).toEqual([
        partialOrderId,
      ]);
    });

    it('pages purchase orders newest first with a keyset cursor', async () => {
      expect(await walkPages('list_purchase_orders', DATE_WINDOW, 1)).toEqual([
        partialOrderId,
        completedOrderId,
      ]);
    });

    it('returns one order with lines, net amounts, vendor, and an empty receipt summary', async () => {
      const result = await purchasingCall('get_purchase_order', {
        id: partialOrderId,
      });

      expect(result.isError).not.toBe(true);
      const detail = parsePayload<PurchaseOrderDetail>(result);
      expect(detail).toMatchObject({
        id: partialOrderId,
        status: 'PARTIAL',
        currency: 'EUR',
        vendor: { id: olderVendorId, name: expect.any(String) },
        totals: { net: '5.30' },
        lines_total: 2,
        lines_truncated: false,
        receipts: { movement_count: 0, last_received_at: null },
      });
      expect(detail.lines).toEqual([
        {
          id: expect.any(String),
          part: {
            id: fixtures.catalogItemId,
            sku: fixtures.sku,
            name: fixtures.searchToken,
          },
          quantity_ordered: '1.500',
          quantity_received: '0.000',
          unit_cost_net: '3.33',
          line_net: '5.00',
        },
        {
          id: expect.any(String),
          part: {
            id: partBId,
            sku: `SKU-${fixtures.searchToken}-B`,
            name: `${fixtures.searchToken} B`,
          },
          quantity_ordered: '3.000',
          quantity_received: '0.000',
          unit_cost_net: '0.10',
          line_net: '0.30',
        },
      ]);
    });

    it('reports the goods-receipt movements booked against a completed order', async () => {
      const result = await purchasingCall('get_purchase_order', {
        id: completedOrderId,
      });

      expect(result.isError).not.toBe(true);
      const detail = parsePayload<PurchaseOrderDetail>(result);
      expect(detail).toMatchObject({
        status: 'COMPLETED',
        totals: { net: '14.00' },
        receipts: {
          movement_count: 1,
          last_received_at: '2024-03-06T10:00:00.000Z',
        },
      });
      expect(detail.lines[0].quantity_received).toBe('2.000');
    });

    it('lists vendors newest first with id, name, and active only, and no bank or contact details', async () => {
      const result = await purchasingCall('list_vendors', {});

      expect(result.isError).not.toBe(true);
      expect(parsePayload<PurchasingPage>(result).data).toEqual([
        { id: fixtures.vendorId, name: fixtures.vendorName, active: true },
        { id: olderVendorId, name: expect.any(String), active: true },
        { id: oldestVendorId, name: expect.any(String), active: true },
      ]);
      const text = toolPayloadText(result);
      expect(text).not.toContain(fixtures.vendorAccountNumber);
      expect(text).not.toContain(fixtures.vendorEmail);
    });

    it('pages vendors newest first with a keyset cursor', async () => {
      expect(await walkPages('list_vendors', {}, 1)).toEqual([
        fixtures.vendorId,
        olderVendorId,
        oldestVendorId,
      ]);
    });

    it('rejects input outside the contract', async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ['list_purchase_orders', { pageSize: 26 }],
        ['list_purchase_orders', { status: 'CANCELLED' }],
        ['list_purchase_orders', { from: '2024-03-10', to: '2024-03-01' }],
        ['list_purchase_orders', { cursor: 'not a cursor' }],
        ['list_purchase_orders', { part_id: 'FILTER-DEMO-01' }],
        ['get_purchase_order', { id: 'PO-2024-0001' }],
        ['list_vendors', { pageSize: 26 }],
        ['list_vendors', { cursor: 'not a cursor' }],
      ];
      for (const [name, args] of cases) {
        expect(await purchasingCallFails(name, args)).toBe(true);
      }
    });

    it('does not show tenant A orders or vendors to tenant B', async () => {
      const asTenantB = (name: string, args: Record<string, unknown>) =>
        withMcpSession(adminHeaderB, 'e2e-purchasing-tenant-b', (session) =>
          session.call(name, args),
        );

      const orders = await asTenantB('list_purchase_orders', {});
      const vendors = await asTenantB('list_vendors', {});
      expect(orders.isError).not.toBe(true);
      expect(vendors.isError).not.toBe(true);
      for (const id of [
        fixtures.purchaseOrderId,
        partialOrderId,
        completedOrderId,
      ]) {
        expect(toolPayloadText(orders)).not.toContain(id);
      }
      for (const id of [fixtures.vendorId, olderVendorId, oldestVendorId]) {
        expect(toolPayloadText(vendors)).not.toContain(id);
      }

      const detail = await asTenantB('get_purchase_order', {
        id: partialOrderId,
      });
      expect(detail.isError).toBe(true);
      expect(toolPayloadText(detail)).toContain('not found');
    });

    it('returns not found for a purchase order that does not exist', async () => {
      const missingId = '00000000-0000-4000-8000-0000000000ff';
      const result = await purchasingCall('get_purchase_order', {
        id: missingId,
      });

      expect(result.isError).toBe(true);
      expect(toolPayloadText(result)).toContain(
        `Purchase order with ID ${missingId} not found`,
      );
    });
  });

  describe('catalog and price reads (AUT-460)', () => {
    /**
     * Fictional supplier, rule, and labor values, written for this suite only.
     * Names and codes carry a per-run suffix: the labor code and revenue group
     * name indexes are still unique across tenants (migrations 20260303151000
     * and the revenue group name key), so fixed values would collide with a
     * previous run's rows.
     */
    const RUN = Date.now().toString(36);
    const SUPPLIER_NAME = `E2E Catalog Supplier ${RUN}`;
    const TAX_GROUP_NAME = `E2E Catalog 20% ${RUN}`;
    const PRICE_LIST_NAME = 'e2e-catalog-price-list.csv';
    const DRAFT_LIST_NAME = 'e2e-catalog-draft-list.csv';
    const RULE_NAME = 'e2e-catalog-brake-35';
    const OTHER_TENANT_RULE = 'e2e-catalog-tenant-b-rule';
    const LABOR_CODE = `E2E-CAT-OIL-${RUN}`;
    const BRAKE_SKU = `E2E-CAT-BRK-${RUN}`;

    let vendorId: string;
    let brakeItemId: string;
    let marginRuleId: string;
    let otherTenantRuleId: string;

    beforeAll(async () => {
      await inTenant(tenantA, async () => {
        const vendor = await prisma.vendor.create({
          data: {
            tenant_id: tenantA,
            name: SUPPLIER_NAME,
            email: 'catalog-supplier@example.test',
            account_number: `E2E-CAT-${RUN}`,
          },
        });
        vendorId = vendor.id;
        const revenueGroup = await prisma.revenueGroup.create({
          data: {
            tenant_id: tenantA,
            name: TAX_GROUP_NAME,
            tax_rate: 20,
            account_number: `8400-${RUN}`,
          },
        });
        const brakeItem = await prisma.catalogItem.create({
          data: {
            tenant_id: tenantA,
            sku: BRAKE_SKU,
            name: 'E2E catalog brake pad',
            unit: 'pcs',
            cost_price: 7.4,
            retail_price: 12.5,
            oem_numbers: ['E2E-OEM-1'],
            revenue_group_id: revenueGroup.id,
          },
        });
        brakeItemId = brakeItem.id;
        await prisma.vendorArticle.create({
          data: {
            tenant_id: tenantA,
            vendor_id: vendor.id,
            catalog_item_id: brakeItem.id,
            vendor_article_no: 'E2E-CAT-SUP-1',
            last_cost: 7.4,
            last_rrp: 12.5,
          },
        });
        const appliedJob = await prisma.importJob.create({
          data: {
            tenant_id: tenantA,
            entity_type: 'SUPPLIER_PRICE_LIST',
            source_system: 'e2e',
            file_name: PRICE_LIST_NAME,
            file_sha256: 'e2e-catalog-applied',
            status: 'APPLIED',
            mapping_json: {},
            options_json: { vendor_id: vendor.id },
            totals_json: { rows: 3, create: 0, update: 3, skip: 0, error: 0 },
            appliedAt: new Date('2026-09-15T10:00:00.000Z'),
          },
        });
        await prisma.catalogPriceHistory.create({
          data: {
            tenant_id: tenantA,
            catalog_item_id: brakeItem.id,
            old_cost: null,
            new_cost: 7.4,
            old_retail: null,
            new_retail: 12.5,
            import_job_id: appliedJob.id,
          },
        });
        await prisma.importJob.create({
          data: {
            tenant_id: tenantA,
            entity_type: 'SUPPLIER_PRICE_LIST',
            source_system: 'e2e',
            file_name: DRAFT_LIST_NAME,
            file_sha256: 'e2e-catalog-draft',
            status: 'DRY_RUN_DONE',
            mapping_json: {},
            options_json: {},
            totals_json: { rows: 9, create: 9, update: 0, skip: 0, error: 0 },
          },
        });
        const marginRule = await prisma.marginRule.create({
          data: {
            tenant_id: tenantA,
            name: RULE_NAME,
            priority: 10,
            markup_percent: 35,
            rounding: 'ROUND_90',
          },
        });
        marginRuleId = marginRule.id;
        await prisma.laborOperation.create({
          data: {
            tenant_id: tenantA,
            code: LABOR_CODE,
            description: 'E2E catalog oil service',
            standard_aw: 0.5,
            hourly_rate: 95,
          },
        });
      });
      const otherRule = await inTenant(tenantB, () =>
        prisma.marginRule.create({
          data: {
            tenant_id: tenantB,
            name: OTHER_TENANT_RULE,
            priority: 1,
            markup_percent: 99,
            rounding: 'NONE',
          },
        }),
      );
      otherTenantRuleId = otherRule.id;
    });

    afterAll(async () => {
      // The shared tenant cleanup does not know these rows, and it deletes catalog
      // items before the vendor links and price history that reference them.
      await inTenant(tenantA, async () => {
        await prisma.catalogPriceHistory.deleteMany({
          where: { tenant_id: tenantA, catalog_item_id: brakeItemId },
        });
        await prisma.vendorArticle.deleteMany({
          where: { tenant_id: tenantA, catalog_item_id: brakeItemId },
        });
        await prisma.catalogItem.deleteMany({
          where: { tenant_id: tenantA, id: brakeItemId },
        });
        await prisma.revenueGroup.deleteMany({
          where: { tenant_id: tenantA, name: TAX_GROUP_NAME },
        });
        await prisma.marginRule.deleteMany({
          where: { tenant_id: tenantA, name: RULE_NAME },
        });
        await prisma.laborOperation.deleteMany({
          where: { tenant_id: tenantA, code: LABOR_CODE },
        });
      });
      await inTenant(tenantB, () =>
        prisma.marginRule.deleteMany({
          where: { tenant_id: tenantB, name: OTHER_TENANT_RULE },
        }),
      );
    });

    const catalogCall = (
      name: string,
      args: Record<string, unknown> = {},
      header = adminHeaderA,
    ) => callMcpTool(caller(header, 'e2e-catalog-reads'), name, args);

    /** Every row of a paged read, walking meta.next_cursor. */
    async function walkAll<T>(
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<T[]> {
      const rows: T[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 500; guard += 1) {
        const page = parsePayload<{
          data: T[];
          meta: { next_cursor: string | null };
        }>(await catalogCall(toolName, cursor ? { ...args, cursor } : args));
        rows.push(...page.data);
        if (!page.meta.next_cursor) {
          return rows;
        }
        cursor = page.meta.next_cursor;
      }
      throw new Error(`${toolName} did not finish paging`);
    }

    it.each<[string, () => Record<string, unknown>, string[]]>([
      ['list_catalog_items', () => ({}), ['data', 'meta']],
      [
        'get_catalog_item',
        () => ({ id: fixtures.catalogItemId }),
        [
          'id',
          'sku',
          'tax_class',
          'cost_price',
          'price_net',
          'default_vendor',
          'price_history',
        ],
      ],
      ['list_price_lists', () => ({}), ['data', 'meta']],
      ['list_margin_rules', () => ({}), ['data', 'meta']],
    ])('returns the documented shape from %s', async (toolName, args, keys) => {
      const result = await catalogCall(toolName, args());

      expect(result.isError).not.toBe(true);
      expect(
        Object.keys(parsePayload<Record<string, unknown>>(result)),
      ).toEqual(expect.arrayContaining(keys));
    });

    it('lets the SALES role read the catalog and price reads too', async () => {
      for (const toolName of [
        'list_catalog_items',
        'list_price_lists',
        'list_margin_rules',
      ]) {
        const result = await catalogCall(toolName, {}, salesHeaderA);
        expect(result.isError).not.toBe(true);
      }
    });

    it('lists the applied price list with its vendor, applied date, and row count, and not the dry run', async () => {
      const lists = await walkAll<{
        name: string;
        vendor: { id: string; name: string } | null;
        valid_from: string | null;
        items_count: number;
      }>('list_price_lists', { pageSize: 7 });

      const names = lists.map((row) => row.name);
      expect(names).toContain(PRICE_LIST_NAME);
      expect(names).not.toContain(DRAFT_LIST_NAME);
      const listed = lists.find((row) => row.name === PRICE_LIST_NAME);
      expect(listed).toMatchObject({
        vendor: { id: vendorId, name: SUPPLIER_NAME },
        valid_from: '2026-09-15T10:00:00.000Z',
        items_count: 3,
      });
    });

    it("lists this tenant's margin rule with its markup and rounding, and not tenant B's rule", async () => {
      const rules = await walkAll<{
        id: string;
        markup: { percent: string | null; use_supplier_rrp: boolean };
        rounding: string;
      }>('list_margin_rules', { pageSize: 7 });

      expect(rules.find((rule) => rule.id === marginRuleId)).toMatchObject({
        markup: { percent: '35.00', use_supplier_rrp: false },
        rounding: 'ROUND_90',
      });
      expect(rules.map((rule) => rule.id)).not.toContain(otherTenantRuleId);
    });

    it('lists labor operations as type labor with the hourly rate as net price', async () => {
      const labor = await walkAll<{
        sku: string;
        type: string;
        unit: string;
        price_net: string;
      }>('list_catalog_items', {
        type: 'labor',
        query: LABOR_CODE,
        pageSize: 5,
      });

      expect(labor).toEqual([
        expect.objectContaining({
          sku: LABOR_CODE,
          type: 'labor',
          unit: 'h',
          price_net: '95.00',
        }),
      ]);
    });

    it('returns the item with its tax class, EUR amounts, default vendor, and price history', async () => {
      const detail = parsePayload<Record<string, unknown>>(
        await catalogCall('get_catalog_item', { id: brakeItemId }),
      );

      expect(detail).toMatchObject({
        sku: BRAKE_SKU,
        active: true,
        cost_price: '7.40',
        price_net: '12.50',
        tax_class: { name: TAX_GROUP_NAME, tax_rate: '20.00' },
        oem_numbers: ['E2E-OEM-1'],
        default_vendor: {
          name: SUPPLIER_NAME,
          vendor_article_no: 'E2E-CAT-SUP-1',
          last_cost: '7.40',
        },
        price_history: [
          expect.objectContaining({ new_cost: '7.40', new_retail: '12.50' }),
        ],
      });
    });

    it('walks every catalog part exactly once, whatever the page size', async () => {
      const small = await walkAll<{ id: string }>('list_catalog_items', {
        pageSize: 3,
      });
      const large = await walkAll<{ id: string }>('list_catalog_items', {
        pageSize: 25,
      });

      expect(small.map((row) => row.id)).toEqual(large.map((row) => row.id));
      expect(new Set(small.map((row) => row.id)).size).toBe(small.length);
    });

    it("shows tenant B none of tenant A's price lists, margin rules, or labor operations", async () => {
      const session = caller(adminHeaderB, 'e2e-catalog-tenant-b');
      const payload = [
        toolPayloadText(
          await callMcpTool(session, 'list_price_lists', { pageSize: 25 }),
        ),
        toolPayloadText(
          await callMcpTool(session, 'list_margin_rules', { pageSize: 25 }),
        ),
        toolPayloadText(
          await callMcpTool(session, 'list_catalog_items', {
            type: 'labor',
            query: LABOR_CODE,
          }),
        ),
      ].join('\n');

      expect(payload).not.toContain(PRICE_LIST_NAME);
      expect(payload).not.toContain(RULE_NAME);
      expect(payload).not.toContain(LABOR_CODE);
      expect(payload).not.toContain(SUPPLIER_NAME);
      const detail = await callMcpTool(session, 'get_catalog_item', {
        id: fixtures.catalogItemId,
      });
      expect(detail.isError).toBe(true);
    });

    it.each<[string, Record<string, unknown>]>([
      ['list_catalog_items', { pageSize: 26 }],
      ['list_catalog_items', { type: 'service' }],
      ['list_catalog_items', { cursor: 'not a cursor!' }],
      ['get_catalog_item', { id: 'not-a-uuid' }],
      ['list_price_lists', { pageSize: 26 }],
      ['list_margin_rules', { cursor: 'not a cursor!' }],
    ])('rejects an invalid %s call: %j', async (toolName, args) => {
      const result = await catalogCall(toolName, args);

      expect(result.isError).toBe(true);
    });
  });

  it('propose_workshop_booking PROPOSE: preview is provisional and apply commits order and loaner', async () => {
    await setPolicyTier('workshop.booking_package', 'PROPOSE');
    const draftVehicle = await createDraftVehicle('mcp-booking-package');
    const dedicatedBay = await prismaA.bay.create({
      data: {
        site_id: fixtures.siteId,
        name: `MCP booking package ${Date.now()}`,
        is_active: true,
      },
    });
    const schedule = scheduledBooking(16);
    const loanerVehicleRecord = await prismaA.vehicle.create({
      data: {
        customer_id: draftVehicle.customerId,
        make: 'VW',
        model: 'Golf',
        year: 2020,
        plate: 'W-MCP-LOAN',
        vin: 'MCPLOANERVIN00001',
      },
    });
    const loanerFleet = await prismaA.loanerVehicle.create({
      data: {
        site_id: fixtures.siteId,
        vehicle_id: loanerVehicleRecord.id,
        display_name: 'MCP Pool',
        status: 'AVAILABLE',
        active: true,
      },
    });

    const traceId = '00000000-0000-4000-8000-000000000535';
    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-booking-package'),
      'propose_workshop_booking',
      {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        bay_id: dedicatedBay.id,
        scheduled_start_at: schedule.scheduled_start_at,
        scheduled_end_at: schedule.scheduled_end_at,
        loaner_vehicle_id: loanerFleet.id,
        planned_from: schedule.scheduled_start_at,
        planned_to: schedule.scheduled_end_at,
      },
      traceId,
    );
    const proposed = parsePayload<{
      status: string;
      pending_action_id: string;
      would_change: WouldChangeEntry[];
      proposal: { provisional: boolean };
    }>(result);
    expect(proposed.status).toBe('needs_approval');
    expect(proposed.proposal.provisional).toBe(true);
    const previewOrder = previewCreatedRow(
      proposed.would_change,
      'WorkshopOrder',
    );
    const previewLoaner = previewCreatedRow(
      proposed.would_change,
      'LoanerBooking',
    );
    expect(
      await prismaA.workshopOrder.findFirst({ where: { id: previewOrder.id } }),
    ).toBeNull();
    expect(
      await prismaA.loanerBooking.findFirst({
        where: { id: previewLoaner.id },
      }),
    ).toBeNull();

    await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

    const committedOrder = await prismaA.workshopOrder.findFirst({
      where: { vehicle_id: draftVehicle.vehicleId },
      select: { id: true, status: true },
    });
    expect(committedOrder).toBeTruthy();
    expect(committedOrder?.status).toBe('SCHEDULED');
    expect(committedOrder?.id).not.toBe(previewOrder.id);
    const committedLoaner = await prismaA.loanerBooking.findFirst({
      where: { loaner_vehicle_id: loanerFleet.id },
      select: { id: true, workshop_order_id: true, status: true },
    });
    expect(committedLoaner?.status).toBe('RESERVED');
    expect(committedLoaner?.workshop_order_id).toBe(committedOrder?.id);
    expect(committedLoaner?.id).not.toBe(previewLoaner.id);

    await expectActionLogRow(traceId, 'mcp.propose_workshop_booking', {
      status: 'PROPOSED',
      tier: 'PROPOSE',
    });
  });

  it('AUT-601: propose_workshop_booking with loaner_charge creates a FEE line on apply', async () => {
    await setPolicyTier('workshop.booking_package', 'PROPOSE');
    const draftVehicle = await createDraftVehicle('mcp-booking-loaner-fee');
    const dedicatedBay = await prismaA.bay.create({
      data: {
        site_id: fixtures.siteId,
        name: `MCP booking loaner fee ${Date.now()}`,
        is_active: true,
      },
    });
    const schedule = scheduledBooking(17);
    const loanerVehicleRecord = await prismaA.vehicle.create({
      data: {
        customer_id: draftVehicle.customerId,
        make: 'VW',
        model: 'Polo',
        year: 2019,
        plate: 'W-MCP-FEE',
        vin: 'MCPLOANERFEEVIN01',
      },
    });
    const loanerFleet = await prismaA.loanerVehicle.create({
      data: {
        site_id: fixtures.siteId,
        vehicle_id: loanerVehicleRecord.id,
        display_name: 'MCP Fee Pool',
        status: 'AVAILABLE',
        active: true,
      },
    });

    const result = await callMcpTool(
      caller(adminHeaderA, 'e2e-booking-loaner-fee'),
      'propose_workshop_booking',
      {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        bay_id: dedicatedBay.id,
        scheduled_start_at: schedule.scheduled_start_at,
        scheduled_end_at: schedule.scheduled_end_at,
        loaner_vehicle_id: loanerFleet.id,
        planned_from: schedule.scheduled_start_at,
        planned_to: schedule.scheduled_end_at,
        loaner_charge: { unit_price_cents: 3500, quantity_days: 1 },
      },
      '00000000-0000-4000-8000-000000000601',
    );
    const proposed = parsePayload<{
      status: string;
      pending_action_id: string;
    }>(result);
    expect(proposed.status).toBe('needs_approval');

    await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

    const feeLine = await prismaA.workshopTaskLineItem.findFirst({
      where: {
        tenant_id: tenantA,
        type: 'FEE',
        description: 'Leihwagen',
        workshop_task: {
          workshop_order: { vehicle_id: draftVehicle.vehicleId },
        },
      },
      select: { quantity: true, unit_price: true, item_no: true },
    });
    expect(feeLine?.item_no).toBe('LEIH');
    expect(feeLine?.quantity.toString()).toBe('1');
    expect(feeLine?.unit_price.toString()).toBe('35');
  });

  describe('AUT-539 purchase_order.propose_draft acceptance', () => {
    type PurchaseDemandSeed = {
      requisitionId: string;
      reservationIds: string[];
      unitCostNet: string;
      vendorArticleId: string;
      cleanup: () => Promise<void>;
    };

    async function seedRequisitionDemandForPurchasePropose(
      options: { secondLineOnSamePart?: boolean } = {},
    ): Promise<PurchaseDemandSeed> {
      const dedicatedTask = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: fixtures.workshopOrderId,
          title: `MCP PO demand ${Date.now()}`,
          status: 'NOT_STARTED',
        },
      });
      const dedicatedLine = await createPartLine(prismaA, dedicatedTask.id, {
        item_no: fixtures.sku,
        description: fixtures.searchToken,
        unit_price: 2,
        catalog_item_id: fixtures.catalogItemId,
      });
      const catalogBefore = await prismaA.catalogItem.findFirstOrThrow({
        where: { id: fixtures.catalogItemId, tenant_id: tenantA },
        select: { brand_id: true, cost_price: true, unit: true },
      });
      const vehicleBefore = await prismaA.vehicle.findFirstOrThrow({
        where: { id: fixtures.vehicleId, tenant_id: tenantA },
        select: { make: true, make_brand_id: true },
      });
      let vehicleMakeBrandId = vehicleBefore.make_brand_id;
      let createdMakeBrandId: number | null = null;
      if (!vehicleMakeBrandId) {
        const makeName = `McpPoMake-${Date.now()}`;
        const makeBrand = await prismaA.brand.create({
          data: {
            tenant_id: tenantA,
            name: makeName,
            normalized_name: makeName.toLowerCase(),
            isVehicleMake: true,
          },
        });
        vehicleMakeBrandId = makeBrand.id;
        createdMakeBrandId = makeBrand.id;
        await prismaA.vehicle.update({
          where: { id: fixtures.vehicleId },
          data: { make_brand_id: makeBrand.id },
        });
      }
      await prismaA.catalogItem.update({
        where: { id: fixtures.catalogItemId },
        data: { brand_id: vehicleMakeBrandId, cost_price: 1 },
      });
      await prismaA.vendor.update({
        where: { id: fixtures.vendorId },
        data: {
          supportedBrands: { connect: [{ id: vehicleMakeBrandId }] },
        },
      });
      const vendorArticle = await prismaA.vendorArticle.create({
        data: {
          tenant_id: tenantA,
          vendor_id: fixtures.vendorId,
          catalog_item_id: fixtures.catalogItemId,
          vendor_article_no: `MCP-VA-${Date.now()}`,
          last_cost: 3.5,
        },
      });
      const requisitionItems: Array<{
        workshopTaskLineItemId: string;
        quantity: number;
      }> = [
        {
          workshopTaskLineItemId: dedicatedLine.id,
          quantity: 1,
        },
      ];
      if (options.secondLineOnSamePart) {
        const secondTask = await prismaA.workshopTask.create({
          data: {
            tenant_id: tenantA,
            workshop_order_id: fixtures.workshopOrderId,
            title: `MCP PO second job ${Date.now()}`,
            status: 'NOT_STARTED',
          },
        });
        const secondLine = await createPartLine(prismaA, secondTask.id, {
          item_no: fixtures.sku,
          description: fixtures.searchToken,
          unit_price: 2,
          catalog_item_id: fixtures.catalogItemId,
        });
        requisitionItems.push({
          workshopTaskLineItemId: secondLine.id,
          quantity: 1,
        });
      }
      const sheet = await request(app.getHttpServer())
        .post('/api/parts-requisitions')
        .set('Authorization', adminHeaderA)
        .send({
          vehicleMakeBrandId: vehicleMakeBrandId,
          items: requisitionItems,
        });
      if (sheet.status !== 201) {
        throw new Error(
          `requisition seed failed: ${sheet.status} ${JSON.stringify(sheet.body)}`,
        );
      }
      if (vehicleMakeBrandId === null) {
        throw new Error('vehicle make brand id missing after seed');
      }
      const reservationIds = sheet.body.lines.map(
        (line: { reservationId: string }) => line.reservationId,
      );
      return {
        requisitionId: sheet.body.id,
        reservationIds,
        unitCostNet: '3.50',
        vendorArticleId: vendorArticle.id,
        async cleanup() {
          await prismaA.vendorArticle.deleteMany({
            where: { id: vendorArticle.id },
          });
          await prismaA.vendor.update({
            where: { id: fixtures.vendorId },
            data: {
              supportedBrands: { disconnect: [{ id: vehicleMakeBrandId }] },
            },
          });
          await prismaA.catalogItem.update({
            where: { id: fixtures.catalogItemId },
            data: {
              brand_id: catalogBefore.brand_id,
              cost_price: catalogBefore.cost_price,
            },
          });
          if (createdMakeBrandId) {
            await prismaA.vehicle.update({
              where: { id: fixtures.vehicleId },
              data: { make_brand_id: vehicleBefore.make_brand_id },
            });
          }
        },
      };
    }

    function purchaseProposeArgs(
      demand: PurchaseDemandSeed,
      overrides: Record<string, unknown> = {},
    ) {
      return {
        vendor_id: fixtures.vendorId,
        requisition_id: demand.requisitionId,
        lines: demand.reservationIds.map((reservationId) => ({
          reservation_id: reservationId,
          catalog_item_id: fixtures.catalogItemId,
          cost_basis: { version: 1, unit_cost_net: demand.unitCostNet },
        })),
        ...overrides,
      };
    }

    async function countVendorDraftPos() {
      return prismaA.purchaseOrder.count({
        where: { vendor_id: fixtures.vendorId, status: 'DRAFT' },
      });
    }

    beforeEach(async () => {
      await setPolicyTier('purchase_order.propose_draft', 'PROPOSE');
    });

    it('propose_purchase_order PROPOSE: preview is provisional and apply commits one DRAFT only', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const poCountBefore = await countVendorDraftPos();
        const stockBefore = await prismaA.inventoryStock.findFirstOrThrow({
          where: {
            catalog_item_id: fixtures.catalogItemId,
            site_id: fixtures.siteId,
            location_id: fixtures.locationId,
          },
        });

        const traceId = '00000000-0000-4000-8000-000000000539';
        const result = await callMcpTool(
          caller(adminHeaderA, 'e2e-purchase-propose'),
          'propose_purchase_order',
          purchaseProposeArgs(demand),
          traceId,
        );
        const proposed = parsePayload<{
          status: string;
          pending_action_id: string;
          would_change: WouldChangeEntry[];
          proposal: {
            provisional: boolean;
            preview: {
              totals: { net: string };
              disclaimer: string;
              lines: Array<{
                unit: string;
                unit_cost_net: string;
                cost_source: {
                  kind: string;
                  vendor_article_no: string | null;
                  verified: boolean;
                };
              }>;
            };
          };
        }>(result);
        expect(proposed.status).toBe('needs_approval');
        expect(proposed.proposal.provisional).toBe(true);
        expect(proposed.proposal.preview.totals.net).toBe('3.50');
        expect(proposed.proposal.preview.disclaimer).toBe(
          PURCHASE_PROPOSE_DISCLAIMER,
        );
        expect(proposed.proposal.preview.lines[0].unit).toBeTruthy();
        expect(proposed.proposal.preview.lines[0].unit_cost_net).toBe('3.50');
        expect(proposed.proposal.preview.lines[0].cost_source).toMatchObject({
          kind: 'vendor_article',
          verified: true,
        });
        const previewPo = previewCreatedRow(
          proposed.would_change,
          'PurchaseOrder',
        );
        expect(
          await prismaA.purchaseOrder.findFirst({ where: { id: previewPo.id } }),
        ).toBeNull();
        expect(await countVendorDraftPos()).toBe(poCountBefore);

        const stockAfterPreview = await prismaA.inventoryStock.findFirstOrThrow(
          {
            where: { id: stockBefore.id },
          },
        );
        expect(stockAfterPreview.quantity_on_hand).toEqual(
          stockBefore.quantity_on_hand,
        );

        await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

        const committed = await prismaA.purchaseOrder.findFirst({
          where: {
            vendor_id: fixtures.vendorId,
            site_id: fixtures.siteId,
            status: 'DRAFT',
          },
          orderBy: { createdAt: 'desc' },
        });
        expect(committed).toBeTruthy();
        expect(committed?.id).not.toBe(previewPo.id);
        expect(await countVendorDraftPos()).toBe(poCountBefore + 1);

        await expectActionLogRow(traceId, 'mcp.propose_purchase_order', {
          status: 'PROPOSED',
          tier: 'PROPOSE',
        });
      } finally {
        await demand.cleanup();
      }
    });

    it('allows two reservation lines for the same catalog item', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose({
        secondLineOnSamePart: true,
      });
      try {
        const result = await callMcpTool(
          caller(adminHeaderA, 'e2e-purchase-two-lines'),
          'propose_purchase_order',
          purchaseProposeArgs(demand),
          '00000000-0000-4000-8000-000000000543',
        );
        const proposed = parsePayload<{
          status: string;
          proposal: { preview: { lines: unknown[]; totals: { net: string } } };
        }>(result);
        expect(proposed.status).toBe('needs_approval');
        expect(proposed.proposal.preview.lines).toHaveLength(2);
        expect(proposed.proposal.preview.totals.net).toBe('7.00');
      } finally {
        await demand.cleanup();
      }
    });

    it('rejects foreign vendor, requisition, and reservation ids without creating a PO', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      const prismaB = createTenantAwarePrisma(prisma, tenantB);
      const foreignVendor = await prismaB.vendor.create({
        data: {
          tenant_id: tenantB,
          name: 'Foreign vendor',
          email: 'foreign-vendor@example.test',
          account_number: `FOREIGN-${Date.now()}`,
        },
      });
      try {
        const before = await countVendorDraftPos();
        const foreignId = randomUUID();

        for (const args of [
          {
            ...purchaseProposeArgs(demand),
            vendor_id: foreignVendor.id,
          },
          {
            ...purchaseProposeArgs(demand),
            requisition_id: foreignId,
          },
          {
            ...purchaseProposeArgs(demand),
            lines: [
              {
                reservation_id: foreignId,
                catalog_item_id: fixtures.catalogItemId,
                cost_basis: { version: 1, unit_cost_net: demand.unitCostNet },
              },
            ],
          },
        ]) {
          const result = await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-foreign'),
            'propose_purchase_order',
            args,
            randomUUID(),
          );
          expect(result.isError).toBe(true);
        }
        expect(await countVendorDraftPos()).toBe(before);
      } finally {
        await demand.cleanup();
        await prismaB.vendor.deleteMany({ where: { id: foreignVendor.id } });
      }
    });

    it('rejects invalid and negative unit costs at the MCP schema', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const before = await countVendorDraftPos();
        for (const unitCost of ['12.5', '-1.00', 'abc']) {
          const result = await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-bad-cost'),
            'propose_purchase_order',
            {
              ...purchaseProposeArgs(demand),
              lines: [
                {
                  reservation_id: demand.reservationIds[0],
                  catalog_item_id: fixtures.catalogItemId,
                  cost_basis: { version: 1, unit_cost_net: unitCost },
                },
              ],
            },
            randomUUID(),
          );
          expect(result.isError).toBe(true);
        }
        expect(await countVendorDraftPos()).toBe(before);
      } finally {
        await demand.cleanup();
      }
    });

    it('rejects stale demand after the slice is already on a PO', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const before = await countVendorDraftPos();
        const proposed = parsePayload<{ pending_action_id: string }>(
          await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-stale'),
            'propose_purchase_order',
            purchaseProposeArgs(demand),
            '00000000-0000-4000-8000-000000000544',
          ),
        );
        await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);
        expect(await countVendorDraftPos()).toBe(before + 1);

        const stale = await callMcpTool(
          caller(adminHeaderA, 'e2e-purchase-stale-2'),
          'propose_purchase_order',
          purchaseProposeArgs(demand),
          '00000000-0000-4000-8000-000000000545',
        );
        expect(stale.isError).toBe(true);
        expect(await countVendorDraftPos()).toBe(before + 1);
      } finally {
        await demand.cleanup();
      }
    });

    it('rejects a non-positive reservation quantity without creating a PO', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const before = await countVendorDraftPos();
        await prismaA.partsReservation.update({
          where: { id: demand.reservationIds[0] },
          data: { quantity: 0 },
        });
        const result = await callMcpTool(
          caller(adminHeaderA, 'e2e-purchase-zero-qty'),
          'propose_purchase_order',
          purchaseProposeArgs(demand),
          '00000000-0000-4000-8000-000000000546',
        );
        expect(result.isError).toBe(true);
        expect(await countVendorDraftPos()).toBe(before);
      } finally {
        await demand.cleanup();
      }
    });

    it('rejects apply when unit cost changes after preview', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const before = await countVendorDraftPos();
        const proposed = parsePayload<{ pending_action_id: string }>(
          await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-cost-stale'),
            'propose_purchase_order',
            purchaseProposeArgs(demand),
            '00000000-0000-4000-8000-000000000547',
          ),
        );
        await prismaA.vendorArticle.update({
          where: { id: demand.vendorArticleId },
          data: { last_cost: 9.99 },
        });
        await applyProposal(proposed.pending_action_id, adminHeaderA).expect(422);
        expect(await countVendorDraftPos()).toBe(before);
      } finally {
        await demand.cleanup();
      }
    });

    it('refuses apply when the active site changed after simulation', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      const mainSite = await prismaA.site.findFirstOrThrow({
        where: { id: fixtures.siteId },
        select: { legal_entity_id: true },
      });
      const otherSite = await prismaA.site.create({
        data: {
          legal_entity_id: mainSite.legal_entity_id,
          code: `MCP-PO-SITE-${Date.now()}`,
          name: 'MCP PO other site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
        },
      });
      await prismaA.siteMembership.create({
        data: {
          tenant_id: tenantA,
          user_id: tenantAUserId,
          site_id: otherSite.id,
          is_active: true,
        },
      });
      try {
        const before = await countVendorDraftPos();
        const proposed = parsePayload<{ pending_action_id: string }>(
          await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-site'),
            'propose_purchase_order',
            purchaseProposeArgs(demand),
            '00000000-0000-4000-8000-000000000548',
          ),
        );
        await prismaA.user.update({
          where: { id: tenantAUserId },
          data: { active_site_id: otherSite.id },
        });
        await applyProposal(proposed.pending_action_id, adminHeaderA).expect(422);
        await prismaA.user.update({
          where: { id: tenantAUserId },
          data: { active_site_id: fixtures.siteId },
        });
        expect(await countVendorDraftPos()).toBe(before);
      } finally {
        await demand.cleanup();
      }
    });

    it('allows only one successful apply under concurrent approval', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const before = await countVendorDraftPos();
        const proposed = parsePayload<{ pending_action_id: string }>(
          await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-double-apply'),
            'propose_purchase_order',
            purchaseProposeArgs(demand),
            '00000000-0000-4000-8000-000000000549',
          ),
        );
        const [first, second] = await Promise.all([
          applyProposal(proposed.pending_action_id, adminHeaderA),
          applyProposal(proposed.pending_action_id, adminHeaderA),
        ]);
        const statuses = [first.status, second.status];
        expect(statuses.some((status) => status === 200)).toBe(true);
        expect(await countVendorDraftPos()).toBe(before + 1);
      } finally {
        await demand.cleanup();
      }
    });

    it('rolls back apply when the EXECUTED agent action log insert fails', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      const agentActionLog = app.get(AgentActionLogService);
      const realRecordInTransaction =
        agentActionLog.recordInTransaction.bind(agentActionLog);
      const recordSpy = jest
        .spyOn(agentActionLog, 'recordInTransaction')
        .mockImplementation(async (input, tx, work, metadata) => {
          if (
            input.status === 'EXECUTED' &&
            input.actionType === 'purchase_order.propose_draft'
          ) {
            if (work) {
              await work();
            }
            throw new Error('simulated EXECUTED log insert failure');
          }
          return realRecordInTransaction(input, tx, work, metadata);
        });
      try {
        const before = await countVendorDraftPos();
        const proposed = parsePayload<{ pending_action_id: string }>(
          await callMcpTool(
            caller(adminHeaderA, 'e2e-purchase-audit-rollback'),
            'propose_purchase_order',
            purchaseProposeArgs(demand),
            '00000000-0000-4000-8000-000000000550',
          ),
        );
        await applyProposal(proposed.pending_action_id, adminHeaderA).expect(500);
        expect(await countVendorDraftPos()).toBe(before);
      } finally {
        recordSpy.mockRestore();
        await demand.cleanup();
      }
    });

    it('replays propose_purchase_order with the same command_id', async () => {
      const demand = await seedRequisitionDemandForPurchasePropose();
      try {
        const commandId = '00000000-0000-4000-8000-000000000540';
        const args = { ...purchaseProposeArgs(demand), command_id: commandId };
        const first = await callMcpTool(
          caller(adminHeaderA, 'e2e-purchase-replay'),
          'propose_purchase_order',
          args,
          '00000000-0000-4000-8000-000000000541',
        );
        const second = await callMcpTool(
          caller(adminHeaderA, 'e2e-purchase-replay'),
          'propose_purchase_order',
          args,
          '00000000-0000-4000-8000-000000000542',
        );
        const firstPayload = parsePayload<{
          pending_action_id: string;
          replayed?: boolean;
        }>(first);
        const secondPayload = parsePayload<{
          pending_action_id: string;
          replayed?: boolean;
        }>(second);
        expect(secondPayload.pending_action_id).toBe(
          firstPayload.pending_action_id,
        );
        expect(secondPayload.replayed).toBe(true);
      } finally {
        await demand.cleanup();
      }
    });
  });

  it('AUT-535: replays propose_workshop_booking with the same command_id', async () => {
    await setPolicyTier('workshop.booking_package', 'PROPOSE');
    const draftVehicle = await createDraftVehicle('mcp-booking-replay');
    const dedicatedBay = await prismaA.bay.create({
      data: {
        site_id: fixtures.siteId,
        name: `MCP booking replay ${Date.now()}`,
        is_active: true,
      },
    });
    const schedule = scheduledBooking(17);
    const commandId = '00000000-0000-4000-8000-000000000536';

    const first = await callMcpTool(
      caller(adminHeaderA, 'e2e-booking-replay'),
      'propose_workshop_booking',
      {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        bay_id: dedicatedBay.id,
        scheduled_start_at: schedule.scheduled_start_at,
        scheduled_end_at: schedule.scheduled_end_at,
        command_id: commandId,
      },
      '00000000-0000-4000-8000-000000000537',
    );
    const second = await callMcpTool(
      caller(adminHeaderA, 'e2e-booking-replay'),
      'propose_workshop_booking',
      {
        customer_id: draftVehicle.customerId,
        vehicle_id: draftVehicle.vehicleId,
        bay_id: dedicatedBay.id,
        scheduled_start_at: schedule.scheduled_start_at,
        scheduled_end_at: schedule.scheduled_end_at,
        command_id: commandId,
      },
      '00000000-0000-4000-8000-000000000538',
    );

    const firstPayload = parsePayload<{
      status: string;
      pending_action_id: string;
      replayed?: boolean;
    }>(first);
    const secondPayload = parsePayload<{
      status: string;
      pending_action_id: string;
      replayed?: boolean;
    }>(second);
    expect(firstPayload.status).toBe('needs_approval');
    expect(secondPayload.status).toBe('needs_approval');
    expect(secondPayload.pending_action_id).toBe(
      firstPayload.pending_action_id,
    );
    expect(secondPayload.replayed).toBe(true);
  });

  describe('AUT-599 propose_workshop_order_completion', () => {
    async function seedCompletionOrder() {
      const order = await prismaA.workshopOrder.create({
        data: {
          order_number: `WO-COMPLETE-${Date.now()}`,
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
          site_id: fixtures.siteId,
          odometer: 1200,
          fuel_level: 40,
          status: 'IN_PROGRESS',
        },
      });
      const task = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: order.id,
          title: 'MCP completion task',
          status: 'IN_PROGRESS',
        },
      });
      return { order, task };
    }

    beforeEach(async () => {
      await setPolicyTier('workshop_order.complete', 'PROPOSE');
      await seedReadySellerAndAccountingProfile(prismaA, tenantA);
    });

    it('PROPOSE: previews task completion and apply commits DONE + COMPLETED', async () => {
      const { order, task } = await seedCompletionOrder();
      const traceId = '00000000-0000-4000-8000-000000000603';
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-order-completion'),
        'propose_workshop_order_completion',
        { workshop_order_id: order.id },
        traceId,
      );
      const proposed = parsePayload<{
        status: string;
        pending_action_id: string;
        proposal: {
          provisional: boolean;
          preview: {
            tasks: Array<{ new_status: string }>;
            order_status: { new: string };
            ready_email: { notify_customer: boolean; will_send: boolean };
          };
        };
      }>(result);
      expect(proposed.status).toBe('needs_approval');
      expect(proposed.proposal.provisional).toBe(true);
      expect(proposed.proposal.preview.tasks[0]?.new_status).toBe('DONE');
      expect(proposed.proposal.preview.order_status.new).toBe('COMPLETED');
      expect(proposed.proposal.preview.ready_email).toEqual({
        notify_customer: false,
        will_send: false,
        notice_code: null,
      });

      const taskBeforeApply = await prismaA.workshopTask.findFirstOrThrow({
        where: { id: task.id },
      });
      expect(taskBeforeApply.status).toBe('IN_PROGRESS');

      await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

      const taskAfter = await prismaA.workshopTask.findFirstOrThrow({
        where: { id: task.id },
      });
      const orderAfter = await prismaA.workshopOrder.findFirstOrThrow({
        where: { id: order.id },
      });
      expect(taskAfter.status).toBe('DONE');
      expect(orderAfter.status).toBe('COMPLETED');

      await expectActionLogRow(traceId, 'mcp.propose_workshop_order_completion', {
        status: 'PROPOSED',
        tier: 'PROPOSE',
      });
    });

    it('apply completes only tasks pinned at propose time', async () => {
      const { order, task } = await seedCompletionOrder();
      const proposed = parsePayload<{ pending_action_id: string }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-order-completion-pin'),
          'propose_workshop_order_completion',
          { workshop_order_id: order.id },
        ),
      );
      const extraTask = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: order.id,
          title: 'Added after proposal',
          status: 'IN_PROGRESS',
        },
      });
      await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);
      const pinnedTask = await prismaA.workshopTask.findFirstOrThrow({
        where: { id: task.id },
      });
      const lateTask = await prismaA.workshopTask.findFirstOrThrow({
        where: { id: extraTask.id },
      });
      expect(pinnedTask.status).toBe('DONE');
      expect(lateTask.status).toBe('IN_PROGRESS');
    });

    it('PROPOSE with notify_customer true previews ready_email.will_send when order will complete', async () => {
      await prismaA.customer.update({
        where: { id: fixtures.customerId },
        data: {
          email: 'ready-mcp@example.at',
          contact_email_ok: true,
        },
      });
      const { order } = await seedCompletionOrder();
      const outboxBefore = await prismaA.notificationOutbox.count({
        where: { tenant_id: tenantA },
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-order-completion-notify'),
        'propose_workshop_order_completion',
        { workshop_order_id: order.id, notify_customer: true },
      );
      const proposed = parsePayload<{
        proposal: {
          preview: {
            ready_email: {
              notify_customer: boolean;
              will_send: boolean;
              notice_code: string | null;
            };
          };
        };
      }>(result);
      expect(proposed.proposal.preview.ready_email).toMatchObject({
        notify_customer: true,
        will_send: true,
        notice_code: 'QUEUED',
      });
      const outboxAfterPropose = await prismaA.notificationOutbox.count({
        where: { tenant_id: tenantA },
      });
      expect(outboxAfterPropose).toBe(outboxBefore);
    });

    it('returns not found for a workshop order at another site in the same tenant', async () => {
      const mainSite = await prismaA.site.findFirstOrThrow({
        where: { id: fixtures.siteId },
        select: { legal_entity_id: true },
      });
      const otherSite = await prismaA.site.create({
        data: {
          legal_entity_id: mainSite.legal_entity_id,
          code: `MCP-COMPLETE-OTHER-${Date.now()}`,
          name: 'MCP completion other site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
        },
      });
      const foreignOrderId = await prismaA.workshopOrder
        .create({
          data: {
            order_number: `WO-OTHER-SITE-${Date.now()}`,
            customer_id: fixtures.customerId,
            vehicle_id: fixtures.vehicleId,
            site_id: otherSite.id,
            odometer: 900,
            fuel_level: 40,
            status: 'IN_PROGRESS',
          },
        })
        .then((row) => row.id);
      await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: foreignOrderId,
          title: 'Other site task',
          status: 'IN_PROGRESS',
        },
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-order-completion-site'),
        'propose_workshop_order_completion',
        { workshop_order_id: foreignOrderId },
      );
      expect(result.isError).toBe(true);
    });

    it('returns not found for a workshop order in another tenant', async () => {
      const siteB = await resolveTestMainSiteId(prisma, tenantB);
      const foreignOrderId = await inTenant(tenantB, async () => {
        const customer = await prisma.customer.create({
          data: {
            tenant_id: tenantB,
            first_name: 'Foreign',
            last_name: 'Order',
            email: `foreign-${Date.now()}@example.com`,
          },
        });
        const vehicle = await prisma.vehicle.create({
          data: {
            tenant_id: tenantB,
            make: 'Test',
            model: 'Foreign',
            year: 2020,
            vin: `VIN-F-${Date.now()}`,
            customer_id: customer.id,
          },
        });
        const order = await prisma.workshopOrder.create({
          data: {
            tenant_id: tenantB,
            order_number: `WO-B-${Date.now()}`,
            customer_id: customer.id,
            vehicle_id: vehicle.id,
            site_id: siteB,
            odometer: 500,
            fuel_level: 50,
            status: 'IN_PROGRESS',
          },
        });
        return order.id;
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-order-completion-foreign'),
        'propose_workshop_order_completion',
        { workshop_order_id: foreignOrderId },
      );
      expect(result.isError).toBe(true);
    });

    it('rejects policy-disabled calls with not_permitted', async () => {
      await putPolicyRule('workshop_order.complete', {
        tier: 'PROPOSE',
        enabled: false,
      });
      const { order } = await seedCompletionOrder();
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-order-completion-off'),
        'propose_workshop_order_completion',
        { workshop_order_id: order.id },
      );
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('not_permitted');
    });
  });

  describe('AUT-600 propose_invoice_draft_from_order', () => {
    async function seedInvoiceableWorkshopOrder() {
      await prismaA.customer.update({
        where: { id: fixtures.customerId },
        data: {
          address_street: 'Musterstraße 1',
          address_city: 'Wien',
          address_zip: '1010',
          address_country: 'AT',
        },
      });
      const order = await prismaA.workshopOrder.create({
        data: {
          order_number: `WO-INV-DRAFT-${Date.now()}`,
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
          site_id: fixtures.siteId,
          odometer: 1500,
          fuel_level: 50,
          status: 'COMPLETED',
        },
      });
      const task = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: order.id,
          title: 'MCP invoice draft task',
          status: 'DONE',
        },
      });
      await prismaA.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task.id,
          type: 'LABOR',
          item_no: 'INV-LABOR-01',
          description: 'Synthetic service line',
          quantity: 1,
          unit_price: 100,
        },
      });
      return { order, task };
    }

    beforeEach(async () => {
      await setPolicyTier('invoice.create_draft_from_workshop_order', 'PROPOSE');
      await seedReadySellerAndAccountingProfile(prismaA, tenantA);
    });

    it('PROPOSE: previews totals and apply commits one DRAFT invoice', async () => {
      const { order } = await seedInvoiceableWorkshopOrder();
      const traceId = '00000000-0000-4000-8000-000000000604';
      const commandId = '00000000-0000-4000-8000-000000000605';
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-invoice-draft'),
        'propose_invoice_draft_from_order',
        { workshop_order_id: order.id, command_id: commandId },
        traceId,
      );
      const proposed = parsePayload<{
        status: string;
        pending_action_id: string;
        proposal: {
          provisional: boolean;
          preview: {
            status: string;
            invoice_id: string;
            totals: { net: string; vat: string; gross: string };
            lines: Array<{ description: string; gross: string }>;
            recipient: { customer_id: string; name: string };
            finalize_note: string;
          };
        };
      }>(result);
      expect(proposed.status).toBe('needs_approval');
      expect(proposed.proposal.provisional).toBe(true);
      expect(proposed.proposal.preview.status).toBe('DRAFT');
      expect(proposed.proposal.preview.totals).toEqual({
        net: '100.00',
        vat: '20.00',
        gross: '120.00',
      });
      expect(proposed.proposal.preview.lines[0]?.gross).toBe('120.00');
      expect(proposed.proposal.preview.recipient.customer_id).toBe(
        fixtures.customerId,
      );
      expect(proposed.proposal.preview.finalize_note).toContain('DRAFT');

      const previewInvoiceId = proposed.proposal.preview.invoice_id;
      expect(previewInvoiceId).toBeTruthy();

      const sequenceBeforePropose = await prismaA.invoiceSequence.findMany({
        where: { tenant_id: tenantA },
      });
      const invoicesBefore = await prismaA.invoice.count({
        where: { workshop_order_id: order.id },
      });
      expect(invoicesBefore).toBe(0);
      expect(
        await prismaA.invoice.findFirst({ where: { id: previewInvoiceId } }),
      ).toBeNull();
      expect(await prismaA.invoiceSequence.findMany({
        where: { tenant_id: tenantA },
      })).toEqual(sequenceBeforePropose);

      const applied = await applyProposal(
        proposed.pending_action_id,
        adminHeaderA,
      ).expect(200);
      expect(applied.body.status).toBe('EXECUTED');

      const invoices = await prismaA.invoice.findMany({
        where: { workshop_order_id: order.id },
      });
      expect(invoices).toHaveLength(1);
      const invoice = invoices[0];
      expect(invoice.status).toBe('DRAFT');
      expect(invoice.id).not.toBe(previewInvoiceId);
      expect(invoice.invoice_number).toBeNull();
      expect(invoice.total_net.toFixed(2)).toBe(
        proposed.proposal.preview.totals.net,
      );
      expect(invoice.total_tax.toFixed(2)).toBe(
        proposed.proposal.preview.totals.vat,
      );
      expect(invoice.total_gross.toFixed(2)).toBe(
        proposed.proposal.preview.totals.gross,
      );
      expect(
        await prismaA.invoice.findFirst({ where: { id: previewInvoiceId } }),
      ).toBeNull();
      expect(await prismaA.invoiceSequence.findMany({
        where: { tenant_id: tenantA },
      })).toEqual(sequenceBeforePropose);

      await expectActionLogRow(traceId, 'mcp.propose_invoice_draft_from_order', {
        status: 'PROPOSED',
        tier: 'PROPOSE',
      });
    });

    it('conflicts when the workshop order is already invoiced', async () => {
      const { order } = await seedInvoiceableWorkshopOrder();
      await createDraftInvoice({
        customerId: fixtures.customerId,
        siteId: fixtures.siteId,
        description: 'Existing draft',
        workshopOrderId: order.id,
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-invoice-draft-conflict'),
        'propose_invoice_draft_from_order',
        { workshop_order_id: order.id },
      );
      expect(result.isError).toBe(true);
    });

    it('replays with the same command_id', async () => {
      const { order } = await seedInvoiceableWorkshopOrder();
      const commandId = '00000000-0000-4000-8000-000000000606';
      const first = parsePayload<{ pending_action_id: string }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-invoice-draft-replay'),
          'propose_invoice_draft_from_order',
          { workshop_order_id: order.id, command_id: commandId },
        ),
      );
      const second = parsePayload<{ pending_action_id: string; replayed?: boolean }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-invoice-draft-replay'),
          'propose_invoice_draft_from_order',
          { workshop_order_id: order.id, command_id: commandId },
        ),
      );
      expect(second.pending_action_id).toBe(first.pending_action_id);
      expect(second.replayed).toBe(true);
    });
  });

  describe('AUT-597 propose_estimate_send', () => {
    const estimateRecipientEmail = 'kva.recipient@example.com';
    let previousSendFlag: string | undefined;
    let previousApprovalBaseUrl: string | undefined;

    async function seedEstimateSendOrder() {
      await prismaA.customer.update({
        where: { id: fixtures.customerId },
        data: {
          email: estimateRecipientEmail,
          contact_email_ok: true,
        },
      });
      const order = await prismaA.workshopOrder.create({
        data: {
          order_number: `WO-KVA-${Date.now()}`,
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
          site_id: fixtures.siteId,
          odometer: 2200,
          fuel_level: 50,
          status: 'IN_PROGRESS',
        },
      });
      const task = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: order.id,
          title: 'MCP estimate send task',
          status: 'IN_PROGRESS',
        },
      });
      await prismaA.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task.id,
          type: 'LABOR',
          item_no: 'KVA-LABOR-01',
          description: 'Synthetic labor line',
          quantity: 1,
          unit_price: 50,
        },
      });
      return { order, task };
    }

    beforeEach(async () => {
      previousSendFlag = process.env.CUSTOMER_ESTIMATE_SEND_ENABLED;
      previousApprovalBaseUrl = process.env.ESTIMATE_APPROVAL_BASE_URL;
      process.env.CUSTOMER_ESTIMATE_SEND_ENABLED = 'true';
      process.env.ESTIMATE_APPROVAL_BASE_URL = 'https://portal.example.at';
      await setPolicyTier('estimate.send_customer_message', 'PROPOSE');
      await seedReadySellerAndAccountingProfile(prismaA, tenantA);
    });

    afterEach(() => {
      if (previousSendFlag === undefined) {
        delete process.env.CUSTOMER_ESTIMATE_SEND_ENABLED;
      } else {
        process.env.CUSTOMER_ESTIMATE_SEND_ENABLED = previousSendFlag;
      }
      if (previousApprovalBaseUrl === undefined) {
        delete process.env.ESTIMATE_APPROVAL_BASE_URL;
      } else {
        process.env.ESTIMATE_APPROVAL_BASE_URL = previousApprovalBaseUrl;
      }
    });

    it('PROPOSE: previews totals and apply sends one SENT version with outbox row', async () => {
      const { order } = await seedEstimateSendOrder();
      const traceId = '00000000-0000-4000-8000-000000000607';
      const commandId = '00000000-0000-4000-8000-000000000608';
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-estimate-send'),
        'propose_estimate_send',
        {
          workshop_order_id: order.id,
          channel: 'email',
          command_id: commandId,
        },
        traceId,
      );
      const proposed = parsePayload<{
        status: string;
        tier: string;
        pending_action_id: string;
        proposal: {
          provisional: boolean;
          preview: {
            estimate_number: string;
            totals: { net: string; vat: string; gross: string };
            recipient_email_masked: string;
            lines: Array<{ gross: string }>;
          };
        };
      }>(result);
      expect(proposed.status).toBe('needs_approval');
      expect(proposed.tier).toBe('PROPOSE');
      expect(proposed.proposal.provisional).toBe(true);
      expect(proposed.proposal.preview.totals).toEqual({
        net: '50.00',
        vat: '10.00',
        gross: '60.00',
      });
      expect(proposed.proposal.preview.lines[0]?.gross).toBe('60.00');
      expect(proposed.proposal.preview.recipient_email_masked).toContain('@');
      const proposedJson = JSON.stringify(proposed);
      expect(proposedJson).not.toContain(estimateRecipientEmail);

      const proposalRow = await prismaA.agentProposal.findFirstOrThrow({
        where: { id: proposed.pending_action_id },
      });
      expect(proposalRow.action_type).toBe('estimate.send_customer_message');
      expect(JSON.stringify(proposalRow.payload_json)).not.toContain(
        estimateRecipientEmail,
      );

      const actionLog = await prismaA.agentActionLog.findFirstOrThrow({
        where: { trace_id: traceId, action_type: 'mcp.propose_estimate_send' },
      });
      expect(JSON.stringify(actionLog.result_summary_json)).not.toContain(
        estimateRecipientEmail,
      );
      expect(JSON.stringify(actionLog.input_summary_json)).not.toContain(
        estimateRecipientEmail,
      );

      const versionsBefore = await prismaA.workshopEstimateVersion.count({
        where: {
          estimate: { workshop_order_id: order.id },
          status: 'SENT',
        },
      });
      expect(versionsBefore).toBe(0);

      const applied = await applyProposal(
        proposed.pending_action_id,
        adminHeaderA,
      ).expect(200);
      expect(applied.body.status).toBe('EXECUTED');

      const sentVersions = await prismaA.workshopEstimateVersion.findMany({
        where: {
          estimate: { workshop_order_id: order.id },
          status: 'SENT',
        },
      });
      expect(sentVersions).toHaveLength(1);
      expect(sentVersions[0]?.total_gross?.toFixed(2)).toBe('60.00');

      const outbox = await prismaA.notificationOutbox.count({
        where: {
          workshop_order_id: order.id,
          event_type: 'CUSTOMER_ESTIMATE_SENT',
        },
      });
      expect(outbox).toBe(1);

      await expectActionLogRow(traceId, 'mcp.propose_estimate_send', {
        status: 'PROPOSED',
        tier: 'PROPOSE',
      });
    });

    it('reports PROPOSE tier in capabilities when the tenant rule is enabled', async () => {
      const caps = await readAllCapabilities((args) =>
        callMcpTool(caller(adminHeaderA, 'e2e-estimate-cap'), 'get_capabilities', args),
      );
      const entry = caps.data.find((row) => row.tool === 'propose_estimate_send');
      expect(entry).toMatchObject({ tier: 'PROPOSE', enabled: true });
      expect(caps.human_only_actions).not.toContain(
        'estimate.send_customer_message',
      );
    });

    it('rejects unconfirmed customer email before creating a proposal', async () => {
      const { order } = await seedEstimateSendOrder();
      await prismaA.customer.update({
        where: { id: fixtures.customerId },
        data: {
          email: estimateRecipientEmail,
          contact_email_ok: false,
        },
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-estimate-email-not-confirmed'),
        'propose_estimate_send',
        { workshop_order_id: order.id, channel: 'email' },
      );
      expect(result.isError).toBe(true);
      expect(toolPayloadText(result)).toContain(
        'ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED',
      );
      expect(
        await prismaA.agentProposal.count({
          where: {
            action_type: 'estimate.send_customer_message',
            payload_json: {
              path: ['workshop_order_id'],
              equals: order.id,
            },
          },
        }),
      ).toBe(0);
    });

    it('rejects missing customer email before creating a proposal', async () => {
      const { order } = await seedEstimateSendOrder();
      await prismaA.customer.update({
        where: { id: fixtures.customerId },
        data: { email: null, contact_email_ok: true },
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-estimate-no-email'),
        'propose_estimate_send',
        { workshop_order_id: order.id, channel: 'email' },
      );
      expect(result.isError).toBe(true);
      expect(toolPayloadText(result)).toContain(
        'ESTIMATE_CUSTOMER_EMAIL_MISSING',
      );
      expect(
        await prismaA.agentProposal.count({
          where: {
            action_type: 'estimate.send_customer_message',
            payload_json: {
              path: ['workshop_order_id'],
              equals: order.id,
            },
          },
        }),
      ).toBe(0);
    });

    it('refuses propose when estimate.send_customer_message is disabled', async () => {
      const { order } = await seedEstimateSendOrder();
      await putPolicyRule('estimate.send_customer_message', {
        tier: 'PROPOSE',
        enabled: false,
      });
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-estimate-policy-off'),
        'propose_estimate_send',
        { workshop_order_id: order.id, channel: 'email' },
      );
      expect(result.isError).toBe(true);
      expect(
        await prismaA.agentProposal.count({
          where: {
            action_type: 'estimate.send_customer_message',
            payload_json: {
              path: ['workshop_order_id'],
              equals: order.id,
            },
          },
        }),
      ).toBe(0);
      await setPolicyTier('estimate.send_customer_message', 'PROPOSE');
    });

    it('conflicts on apply when workshop lines changed after propose', async () => {
      const { order, task } = await seedEstimateSendOrder();
      const proposed = parsePayload<{ pending_action_id: string }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-estimate-stale'),
          'propose_estimate_send',
          { workshop_order_id: order.id, channel: 'email' },
        ),
      );
      await prismaA.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task.id,
          type: 'LABOR',
          item_no: 'KVA-LABOR-02',
          description: 'Extra line after propose',
          quantity: 1,
          unit_price: 10,
        },
      });
      await applyProposal(proposed.pending_action_id, adminHeaderA).expect(409);
    });

    it('double apply sends only one customer email', async () => {
      const { order } = await seedEstimateSendOrder();
      const proposed = parsePayload<{ pending_action_id: string }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-estimate-double-apply'),
          'propose_estimate_send',
          { workshop_order_id: order.id, channel: 'email' },
        ),
      );
      await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);
      const secondApply = await applyProposal(
        proposed.pending_action_id,
        adminHeaderA,
      ).expect(200);
      expect(secondApply.body.status).toBe('EXECUTED');
      const outbox = await prismaA.notificationOutbox.count({
        where: {
          workshop_order_id: order.id,
          event_type: 'CUSTOMER_ESTIMATE_SENT',
        },
      });
      expect(outbox).toBe(1);
    });

    it('replays with the same command_id', async () => {
      const { order } = await seedEstimateSendOrder();
      const commandId = '00000000-0000-4000-8000-000000000609';
      const first = parsePayload<{ pending_action_id: string }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-estimate-send-replay'),
          'propose_estimate_send',
          { workshop_order_id: order.id, channel: 'email', command_id: commandId },
        ),
      );
      const second = parsePayload<{ pending_action_id: string; replayed?: boolean }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-estimate-send-replay'),
          'propose_estimate_send',
          { workshop_order_id: order.id, channel: 'email', command_id: commandId },
        ),
      );
      expect(second.pending_action_id).toBe(first.pending_action_id);
      expect(second.replayed).toBe(true);
    });

    it('does not propose for a workshop order in another tenant', async () => {
      const { order } = await seedEstimateSendOrder();
      const result = await callMcpTool(
        caller(adminHeaderB, 'e2e-estimate-tenant-b'),
        'propose_estimate_send',
        { workshop_order_id: order.id, channel: 'email' },
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('AUT-598 mechanic finding media MCP tools', () => {
    let advisorEmployeeId = '';
    let findingTaskId: string;
    let findingOrderId: string;
    let uploadedMediaId: string;

    beforeAll(async () => {
      await runWithTenantContext(tenantA, async () => {
        const linked = await prisma.employee.findFirst({
          where: { tenant_id: tenantA, user_id: tenantAUserId },
          select: { id: true },
        });
        if (linked) {
          advisorEmployeeId = linked.id;
          await prisma.employee.update({
            where: { id: linked.id },
            data: { is_active: true, user_id: tenantAUserId },
          });
        } else {
          const created = await seedTestEmployee(prisma, {
            tenantId: tenantA,
            userId: tenantAUserId,
            name: 'MCP Advisor Employee',
            role: EmployeeRole.SERVICE_ADVISOR,
          });
          advisorEmployeeId = created.id;
        }
      });
      const order = await prismaA.workshopOrder.create({
        data: {
          order_number: `WO-FIND-${Date.now()}`,
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
          site_id: fixtures.siteId,
          odometer: 2200,
          fuel_level: 50,
          status: 'IN_PROGRESS',
        },
      });
      findingOrderId = order.id;
      const task = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: order.id,
          title: 'MCP finding task',
          status: 'IN_PROGRESS',
        },
      });
      findingTaskId = task.id;
    });

    beforeEach(async () => {
      await setPolicyTier('workshop.media_upload_slot', 'AUTO');
      await setPolicyTier('workshop_order.propose_mechanic_finding', 'PROPOSE');
      mockMechanicMediaStorage.generateUploadPolicy.mockResolvedValue({
        uploadUrl: 'https://storage.example/upload',
        formFields: { key: 'tenants/t/object.jpg', policy: 'sig' },
        storageBucket: 'test-workshop-media-bucket',
        storageKey: `tenants/${tenantA}/orders/${findingOrderId}/tasks/${findingTaskId}/object.jpg`,
        expiresAt: new Date(Date.now() + 900_000),
      });
    });

    it('request_workshop_media_upload rejects unsupported mime_type', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-media-upload-bad-mime'),
        'request_workshop_media_upload',
        {
          workshop_task_id: findingTaskId,
          mime_type: 'video/mp4',
          size_bytes: 1024,
          purpose: 'MECHANIC_FINDING',
        },
      );
      expect(result.isError).toBe(true);
    });

    it('request_workshop_media_upload AUTO returns media_id and upload fields without bucket secrets', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-media-upload-slot'),
        'request_workshop_media_upload',
        {
          workshop_task_id: findingTaskId,
          mime_type: 'image/jpeg',
          size_bytes: 2048,
          purpose: 'MECHANIC_FINDING',
        },
      );
      const payload = parsePayload<{
        status: string;
        result: {
          id: string;
          media_id: string;
          upload_url: string;
          fields: Record<string, string>;
          expires_at: string;
        };
      }>(result);
      expect(payload.status).toBe('executed');
      expect(payload.result.media_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(payload.result.upload_url).toContain('https://');
      expect(payload.result.fields).toBeDefined();
      expect(payload.result).not.toHaveProperty('storageBucket');
      uploadedMediaId = payload.result.media_id;
    });

    it('propose_mechanic_finding PROPOSE rejects foreign media_ids', async () => {
      const result = await callMcpTool(
        caller(adminHeaderA, 'e2e-finding-bad-media'),
        'propose_mechanic_finding',
        {
          workshop_order_id: findingOrderId,
          workshop_task_id: findingTaskId,
          description: 'brake pads worn below limit',
          media_ids: ['51500000-0000-4000-8000-000000000599'],
        },
      );
      expect(result.isError).toBe(true);
    });

    it('propose_mechanic_finding PROPOSE then apply stores advisor finding', async () => {
      const mediaId =
        uploadedMediaId ??
        (
          await inTenant(tenantA, () =>
            prismaA.workshopMedia.create({
              data: {
                tenant_id: tenantA,
                workshop_order_id: findingOrderId,
                workshop_task_id: findingTaskId,
                uploaded_by_employee_id: advisorEmployeeId,
                purpose: WorkshopMediaPurpose.GENERAL,
                storage_bucket: 'test-workshop-media-bucket',
                storage_key: `tenants/${tenantA}/orders/${findingOrderId}/tasks/${findingTaskId}/fixture.jpg`,
                url_strategy: 'SIGNED',
                mime_type: 'image/jpeg',
                size_bytes: 1024,
              },
            }),
          )
        ).id;

      const proposed = parsePayload<{
        status: string;
        pending_action_id: string;
        proposal: { provisional: boolean };
      }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-finding-propose'),
          'propose_mechanic_finding',
          {
            workshop_order_id: findingOrderId,
            workshop_task_id: findingTaskId,
            description: 'brake pads worn below limit',
            media_ids: [mediaId],
          },
        ),
      );
      expect(proposed.status).toBe('needs_approval');
      expect(proposed.proposal.provisional).toBe(true);

      await applyProposal(proposed.pending_action_id, adminHeaderA).expect(200);

      const proposalRow = await prismaA.agentProposal.findFirstOrThrow({
        where: { id: proposed.pending_action_id },
      });
      expect(proposalRow.action_type).toBe('workshop_order.mechanic_finding');
      expect(proposalRow.status).toBe('EXECUTED');

      const orderRead = parsePayload<{
        mechanic_findings: Array<{ finding_text: string; media: Array<{ id: string }> }>;
      }>(
        await callMcpTool(
          caller(adminHeaderA, 'e2e-finding-read-order'),
          'get_workshop_order',
          { workshop_order_id: findingOrderId },
        ),
      );
      expect(orderRead.mechanic_findings.length).toBeGreaterThan(0);
      expect(orderRead.mechanic_findings[0]?.finding_text).toContain(
        'brake pads worn',
      );
      expect(orderRead.mechanic_findings[0]?.media[0]?.id).toBe(mediaId);
    });
  });

  // Note: MCP_SERVER_ENABLED=false → 404 is already tested above
});
