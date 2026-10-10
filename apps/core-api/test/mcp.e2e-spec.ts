import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_NEVER_EXPOSED_ACTIONS,
} from '../src/mcp/mcp.constants.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';

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
  'get_workshop_order',
  'get_stock_level',
  'get_invoice',
  'get_agent_action',
  'get_vehicle_history',
  'get_document_pdf',
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
      await transport.close();
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
      { name: 'list_bays', arguments: {} },
      { name: 'list_bins', arguments: {} },
      { name: 'list_workshop_tasks', arguments: {} },
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
        name: 'list_documents',
        arguments: { entity_type: 'customer', entity_id: fixtures.customerId },
      },
      {
        name: 'get_document_pdf',
        arguments: { id: `workshop_order:${fixtures.workshopOrderId}` },
      },
    ];
  }

  beforeAll(async () => {
    jest.setTimeout(120000);
    previousMcpFlag = process.env.MCP_SERVER_ENABLED;
    process.env.MCP_SERVER_ENABLED = 'true';

    // Read links are signed by an in-memory store, so the suite needs no GCS credentials.
    pdfArchive = createInMemoryPdfArchive();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(pdfArchive)
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
      await transport.close();
    });
  });

  it('rejects cross-tenant session reuse with 404', async () => {
    const { transport } = await connectMcpClient(
      adminHeaderA,
      'e2e-session-owner-a',
    );
    const sessionId = transport.sessionId;
    expect(sessionId).toBeTruthy();
    await transport.close();

    await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', adminHeaderB)
      .set('mcp-session-id', sessionId!)
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
      .expect(404);
  });

  it('lists every registered tool (24 read + 4 write)', async () => {
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
    await transport.close();
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

    afterAll(async () => {
      // The shared tenant cleanup does not remove sales orders, and they block the customer delete.
      await prismaA.salesOrder.deleteMany({
        where: { id: historySalesOrderId },
      });
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

    it('does not reveal another tenant document, customer, or vehicle', async () => {
      expect(
        await historyCallFails('get_document_pdf', {
          id: otherTenantDocumentId,
        }),
      ).toBe(true);
      expect(
        await historyCallFails('get_vehicle_history', {
          vehicle_id: otherTenantVehicleId,
        }),
      ).toBe(true);

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

  // Note: MCP_SERVER_ENABLED=false → 404 is already tested above
});
