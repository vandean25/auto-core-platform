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
  MCP_WRITE_TOOL_NAMES,
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

type TenantFixtures = {
  searchToken: string;
  customerId: string;
  vehicleId: string;
   workshopOrderId: string;
  catalogItemId: string;
  sku: string;
  workshopTaskLineItemId: string;
  locationId: string;
};

const TRACE_IDS: Record<(typeof MCP_READ_TOOL_NAMES)[number], string> = {
  search_customers: '00000000-0000-4000-8000-000000000101',
  get_customer: '00000000-0000-4000-8000-000000000102',
  search_vehicles: '00000000-0000-4000-8000-000000000103',
  get_vehicle: '00000000-0000-4000-8000-000000000104',
  list_workshop_orders: '00000000-0000-4000-8000-000000000105',
  get_workshop_order: '00000000-0000-4000-8000-000000000106',
  search_parts: '00000000-0000-4000-8000-000000000107',
  get_stock_level: '00000000-0000-4000-8000-000000000108',
};

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

  const mcpBaseUrl = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/mcp`;

  async function connectMcpClient(
    authHeader: string,
    clientName: string,
    traceId?: string,
  ): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const headers: Record<string, string> = { Authorization: authHeader };
    if (traceId) {
      headers['X-Trace-Id'] = traceId;
    }
    const transport = new StreamableHTTPClientTransport(new URL(mcpBaseUrl()), {
      requestInit: { headers },
    });
    const client = new Client(
      { name: clientName, version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    return { client, transport };
  }

  function toolPayloadText(result: CallToolResult): string {
    const textPart = result.content?.find(
      (entry) => entry.type === 'text' && 'text' in entry,
    );
    return typeof textPart?.text === 'string' ? textPart.text : '';
  }

  function stockAvailability(payload: string): number {
    return (JSON.parse(payload) as { quantity_available: number })
      .quantity_available;
  }

  function assertPayloadExcludesTenantAIds(payload: string): void {
    expect(payload).not.toContain(fixtures.customerId);
    expect(payload).not.toContain(fixtures.vehicleId);
    expect(payload).not.toContain(fixtures.workshopOrderId);
    expect(payload).not.toContain(fixtures.catalogItemId);
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
    const lineItem = await prismaA.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'PART',
        part_execution_status: 'PENDING_PICK',
        item_no: catalogItem.sku,
        description: catalogItem.name,
        quantity: 1,
        unit_price: 2,
        catalog_item_id: catalogItem.id,
      },
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
    return {
      searchToken,
      customerId: customer.id,
      vehicleId: vehicle.id,
      workshopOrderId: workshopOrder.id,
      catalogItemId: catalogItem.id,
      sku,
      workshopTaskLineItemId: lineItem.id,
      locationId: location.id,
    };
  }

  async function setPolicyTier(
    actionType: string,
    tier: 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY',
  ): Promise<void> {
    await request(app.getHttpServer())
      .put(`/api/agent-policy/rules/${actionType}`)
      .set('Authorization', adminHeaderA)
      .send({ tier, enabled: true })
      .expect(200);
  }

  async function createDraftVehicle(prefix: string): Promise<{
    customerId: string;
    vehicleId: string;
  }> {
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

   beforeAll(async () => {
     jest.setTimeout(120000);
     previousMcpFlag = process.env.MCP_SERVER_ENABLED;
    process.env.MCP_SERVER_ENABLED = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    await runWithTenantContext(tenantA, async () => {
      await prisma.tenantMember.update({
        where: {
          tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
        },
        data: { role: 'TECH' },
      });
    });

    await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', techHeaderA)
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} })
      .expect(403);

    await runWithTenantContext(tenantA, async () => {
      await prisma.tenantMember.update({
        where: {
          tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
        },
        data: { role: 'ADMIN' },
      });
    });
  });

  it('allows SALES (ADVISOR) to initialize', async () => {
    await runWithTenantContext(tenantA, async () => {
      await prisma.tenantMember.update({
        where: {
          tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
        },
        data: { role: 'SALES' },
      });
    });

    const { transport } = await connectMcpClient(
      salesHeaderA,
      'e2e-sales-advisor',
    );
    await transport.close();

    await runWithTenantContext(tenantA, async () => {
      await prisma.tenantMember.update({
        where: {
          tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
        },
        data: { role: 'ADMIN' },
      });
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

  it('lists all twelve tools (8 read + 4 write)', async () => {
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
    const toolCalls: Array<{
      name: (typeof MCP_READ_TOOL_NAMES)[number];
      arguments: Record<string, unknown>;
    }> = [
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
    ];

    for (const call of toolCalls) {
      const traceId = TRACE_IDS[call.name];
      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        clientName,
        traceId,
      );
      const result = await client.callTool({
        name: call.name,
        arguments: call.arguments,
      });
      expect(result.isError).not.toBe(true);

      const log = await prismaA.agentActionLog.findFirst({
        where: { trace_id: traceId, action_type: `mcp.${call.name}` },
      });
      expect(log).toBeTruthy();
      expect(log?.agent_id).toBe(`mcp:${clientName}`);
      expect(log?.tier).toBe('AUTO');
      await transport.close();
    }
  });

  it('isolates tenant A data for every read tool with tenant B token', async () => {
    const { client, transport } = await connectMcpClient(
      adminHeaderB,
      'e2e-tenant-b-isolation',
    );

    const calls: Array<{
      name: (typeof MCP_READ_TOOL_NAMES)[number];
      arguments: Record<string, unknown>;
    }> = [
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
      {
        name: 'search_parts',
        arguments: { query: fixtures.searchToken },
      },
      {
        name: 'get_stock_level',
        arguments: { sku: fixtures.sku },
      },
    ];

    for (const call of calls) {
      const result = await client.callTool({
        name: call.name,
        arguments: call.arguments,
      });
      const payload = toolPayloadText(result);
      if (call.name.startsWith('get_')) {
        expect(result.isError).toBe(true);
        continue;
      }
      expect(result.isError).not.toBe(true);
      assertPayloadExcludesTenantAIds(payload);
    }

     await transport.close();
   });
    // Write tool e2e cases
    it('propose_line_item PROPOSE → needs_human_approval, no line item row created, PROPOSED agent_action_log', async () => {
      // Arrange: create a workshop task for the workshop order
      const task = await prismaA.workshopTask.create({
        data: {
          tenant_id: tenantA,
          workshop_order_id: fixtures.workshopOrderId,
          title: 'Test Task',
          status: 'NOT_STARTED',
        },
        select: { id: true, line_items_version: true },
      });
      const { line_items_version: expectedVersion } = task;

      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-propose-line-item',
        '00000000-0000-4000-8000-000000000200', // traceId for propose_line_item
      );

      // Act
      const result = await client.callTool({
        name: 'propose_line_item',
        arguments: {
          workshop_order_id: fixtures.workshopOrderId,
          workshop_task_id: task.id,
          expected_line_items_version: expectedVersion,
          line_item: {
            type: 'PART',
            item_no: 'TEST-ITEM',
            description: 'Test line item',
            quantity: 1,
            unit_price_cents: 100,
          },
        },
      });

      // Assert
      expect(result.isError).not.toBe(true);
      const payload = toolPayloadText(result);
      expect(payload).toContain('needs_human_approval');

      // Ensure no line item row was created (dry run is rolled back)
      const lineItemCountAfter = await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: task.id },
      });
      const lineItemCountBefore = 0; // we just created the task, so no line items
      expect(lineItemCountAfter).toBe(lineItemCountBefore);

      // Check for PROPOSED agent action log
      const log = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000200',
          action_type: 'mcp.propose_line_item',
        },
      });
      expect(log).toBeTruthy();
      expect(log?.tier).toBe('PROPOSE');
      expect(log?.status).toBe('PROPOSED');

      await transport.close();
    });
    it('draft_workshop_order AUTO → creates a scheduled order + EXECUTED log with traceId', async () => {
      await setPolicyTier('workshop_order.create', 'AUTO');
      const draftVehicle = await createDraftVehicle('draft-auto');

      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-draft-workshop-order',
        '00000000-0000-4000-8000-000000000201', // traceId for draft_workshop_order
      );

      // Act
      const result = await client.callTool({
        name: 'draft_workshop_order',
        arguments: {
          customer_id: draftVehicle.customerId,
          vehicle_id: draftVehicle.vehicleId,
          purpose: 'CUSTOMER_REPAIR',
          status: 'SCHEDULED',
          odometer: 1000,
          fuel_level: 50,
          notes: 'MCP draft test',
        },
      });

      // Assert
      expect(result.isError).not.toBe(true);
      const payload = toolPayloadText(result);
      const executedResult = JSON.parse(payload) as {
        status: string;
        result: { id: string };
      };
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
      const log = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000201',
          action_type: 'mcp.draft_workshop_order',
        },
      });
      expect(log).toBeTruthy();
      expect(log?.tier).toBe('AUTO');
      expect(log?.status).toBe('EXECUTED');
      expect(log?.entity_type).toBe('WorkshopOrder');
      expect(log?.entity_id).toBe(order.id);
      expect(log?.reversible).toBe(true);

      await transport.close();
    });

    it('HUMAN_ONLY refuse for a write (insert a temporary tenant HUMAN_ONLY policy row for workshop_order.create if needed) → nothing written + REFUSED log', async () => {
      await setPolicyTier('workshop_order.create', 'HUMAN_ONLY');
      const draftVehicle = await createDraftVehicle('draft-human');

      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-human-only-refuse',
        '00000000-0000-4000-8000-000000000202', // traceId
      );

      // Act
      const result = await client.callTool({
        name: 'draft_workshop_order',
        arguments: {
          customer_id: draftVehicle.customerId,
          vehicle_id: draftVehicle.vehicleId,
          purpose: 'CUSTOMER_REPAIR',
          status: 'SCHEDULED',
          odometer: 1000,
          fuel_level: 50,
          notes: 'MCP human-only test',
        },
      });

      // Assert: the tool should return an error (ForbiddenException turned into MCP error?)
      expect(result.isError).toBe(true);
      // Ensure no workshop order was created beyond the initial fixture
      const orders = await prismaA.workshopOrder.count({
        where: {
          customer_id: draftVehicle.customerId,
          vehicle_id: draftVehicle.vehicleId,
          notes: 'MCP human-only test',
        },
      });
      expect(orders).toBe(0);

      // Check for REFUSED agent action log
      const log = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000202',
          action_type: 'mcp.draft_workshop_order',
        },
      });
      expect(log).toBeTruthy();
      expect(log?.tier).toBe('HUMAN_ONLY');
      expect(log?.status).toBe('REFUSED');

      await transport.close();
    });

    it('rejects an active INTAKE status for draft_workshop_order without creating an order', async () => {
      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-draft-active-status-rejected',
        '00000000-0000-4000-8000-000000000213',
      );
      const result = await client.callTool({
        name: 'draft_workshop_order',
        arguments: { vehicle_id: fixtures.vehicleId, status: 'INTAKE' },
      });

      expect(result.isError).toBe(true);
      expect(await prismaA.workshopOrder.count({
        where: { vehicle_id: fixtures.vehicleId },
      })).toBe(1);
      expect(await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000213',
          action_type: 'mcp.draft_workshop_order',
          status: 'FAILED',
        },
      })).toBeTruthy();
      await transport.close();
    });

    it('reserve_part then release_reservation round-trip restores state', async () => {
      await setPolicyTier('inventory.part_reserve', 'AUTO');
      await setPolicyTier('inventory.part_release', 'AUTO');

      // Get initial stock level for the fixture SKU
      const { client: stockClient, transport: stockTransport } = await connectMcpClient(
        adminHeaderA,
        'e2e-initial-stock',
        '00000000-0000-4000-8000-000000000206',
      );
      let initialStock: number;
      {
        const stockResult = await stockClient.callTool({
          name: 'get_stock_level',
          arguments: { sku: fixtures.sku },
        });
        expect(stockResult.isError).not.toBe(true);
        const stockPayload = toolPayloadText(stockResult);
        initialStock = stockAvailability(stockPayload);
      }
      await stockTransport.close();

      // Reserve part
      const { client: reserveClient, transport: reserveTransport } = await connectMcpClient(
        adminHeaderA,
        'e2e-reserve-part',
        '00000000-0000-4000-8000-000000000207',
      );
      const reserveResult = await reserveClient.callTool({
        name: 'reserve_part',
        arguments: {
          workshop_task_line_item_id: fixtures.workshopTaskLineItemId,
          quantity: 1,
          location_id: fixtures.locationId,
        },
      });
      expect(reserveResult.isError).not.toBe(true);

      // Extract reservation ID from agent action log (since the tool returns it in the result summary)
      const reserveLog = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000207',
          action_type: 'mcp.reserve_part',
        },
      });
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
      const { client: stockAfterReserveClient, transport: stockAfterReserveTransport } = await connectMcpClient(
        adminHeaderA,
        'e2e-stock-after-reserve',
        '00000000-0000-4000-8000-000000000208',
      );
      const stockAfterReserveResult = await stockAfterReserveClient.callTool({
        name: 'get_stock_level',
        arguments: { sku: fixtures.sku },
      });
      expect(stockAfterReserveResult.isError).not.toBe(true);
      const stockAfterReservePayload = toolPayloadText(stockAfterReserveResult);
      const stockAfterReserve = stockAvailability(stockAfterReservePayload);
      expect(stockAfterReserve).toBe(initialStock - 1);
      await stockAfterReserveTransport.close();

      // Release reservation
      const { client: releaseClient, transport: releaseTransport } = await connectMcpClient(
        adminHeaderA,
        'e2e-release-reservation',
        '00000000-0000-4000-8000-000000000209',
      );
      const releaseResult = await releaseClient.callTool({
        name: 'release_reservation',
        arguments: {
          reservation_id: reservationId,
          return_location_id: fixtures.locationId,
        },
      });
      expect(releaseResult.isError).not.toBe(true);

      // Check stock after release: should be initialStock
      const { client: stockAfterReleaseClient, transport: stockAfterReleaseTransport } = await connectMcpClient(
        adminHeaderA,
        'e2e-stock-after-release',
        '00000000-0000-4000-8000-000000000210',
      );
      const stockAfterReleaseResult = await stockAfterReleaseClient.callTool({
        name: 'get_stock_level',
        arguments: { sku: fixtures.sku },
      });
      expect(stockAfterReleaseResult.isError).not.toBe(true);
      const stockAfterReleasePayload = toolPayloadText(stockAfterReleaseResult);
      const stockAfterRelease = stockAvailability(stockAfterReleasePayload);
      expect(stockAfterRelease).toBe(initialStock);
      const releasedReservation = await prismaA.partsReservation.findFirst({
        where: { id: reservationId },
        select: { status: true, quantity: true },
      });
      expect(releasedReservation?.status).toBe('CANCELLED');
      expect(releasedReservation?.quantity.toNumber()).toBe(1);

      // Check agent action logs for EXECUTED
      const reserveLogAfter = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000207',
          action_type: 'mcp.reserve_part',
        },
      });
      expect(reserveLogAfter?.status).toBe('EXECUTED');
      const releaseLog = await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000209',
          action_type: 'mcp.release_reservation',
        },
      });
      expect(releaseLog).toBeTruthy();
      expect(releaseLog?.status).toBe('EXECUTED');

      // Cleanup transports
      await reserveTransport.close();
      await releaseTransport.close();
      await stockAfterReleaseTransport.close();
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
      const tenantBSiteId = await resolveTestMainSiteId(prisma, tenantB);
      const tenantBStaging = await prismaB.storageLocation.create({
        data: {
          site_id: tenantBSiteId,
          code: `CROSS-TENANT-STAGING-${Date.now()}`,
          name: 'Cross-tenant staging',
          type: 'staging_tote',
        },
      });
      const tenantBOrder = await prismaB.workshopOrder.create({
        data: {
          order_number: `CROSS-TENANT-${Date.now()}`,
          customer_id: tenantBCustomer.id,
          vehicle_id: tenantBVehicle.id,
          site_id: tenantBSiteId,
          staging_location_id: tenantBStaging.id,
          odometer: 1000,
          fuel_level: 50,
          status: 'INTAKE',
        },
      });
      const tenantBTask = await prismaB.workshopTask.create({
        data: { workshop_order_id: tenantBOrder.id, title: 'Foreign task' },
      });
      const tenantBLine = await prismaB.workshopTaskLineItem.create({
        data: {
          workshop_task_id: tenantBTask.id,
          type: 'PART',
          part_execution_status: 'PENDING_PICK',
          item_no: 'FOREIGN-PART',
          description: 'Foreign part',
          quantity: 1,
          unit_price: 1,
        },
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
      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-cross-tenant-vehicle',
        '00000000-0000-4000-8000-000000000211',
      );

      // Act
      const result = await client.callTool({
        name: 'draft_workshop_order',
        arguments: {
          customer_id: tenantBCustomer.id,
          vehicle_id: tenantBVehicle.id,
          purpose: 'CUSTOMER_REPAIR',
          status: 'SCHEDULED',
          odometer: 1000,
          fuel_level: 50,
        },
      });

      // Assert: the tool should fail (not found or forbidden) because the vehicle does not belong to tenant A
      expect(result.isError).toBe(true);
      // Ensure no workshop order was created in tenant A with this vehicle
      const orders = await prismaA.workshopOrder.count({
        where: {
          vehicle_id: tenantBVehicle.id,
        },
      });
      expect(orders).toBe(0);

      await transport.close();

      const { client: writeClient, transport: writeTransport } =
        await connectMcpClient(
          adminHeaderA,
          'e2e-cross-tenant-write-ids',
          '00000000-0000-4000-8000-000000000214',
        );
      const reserveResult = await writeClient.callTool({
        name: 'reserve_part',
        arguments: {
          workshop_task_line_item_id: tenantBLine.id,
          quantity: 1,
          location_id: fixtures.locationId,
        },
      });
      expect(reserveResult.isError).toBe(true);
      const releaseResult = await writeClient.callTool({
        name: 'release_reservation',
        arguments: { reservation_id: tenantBReservation.id },
      });
      expect(releaseResult.isError).toBe(true);
      expect(await prismaB.partsReservation.findUnique({
        where: { id: tenantBReservation.id },
        select: { status: true },
      })).toMatchObject({ status: 'OPEN' });
      await writeTransport.close();

    });

    it('propose_line_item cannot access a task at another site in the same tenant', async () => {
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
      const stagingLocation = await prismaA.storageLocation.create({
        data: {
          site_id: otherSite.id,
          code: `MCP-OTHER-STAGING-${Date.now()}`,
          name: 'MCP other staging',
          type: 'staging_tote',
        },
      });
      const otherSiteOrder = await prismaA.workshopOrder.create({
        data: {
          order_number: `MCP-OTHER-${Date.now()}`,
          customer_id: fixtures.customerId,
          vehicle_id: fixtures.vehicleId,
          site_id: otherSite.id,
          staging_location_id: stagingLocation.id,
          odometer: 1000,
          fuel_level: 50,
          status: 'INTAKE',
        },
      });
      const otherSiteTask = await prismaA.workshopTask.create({
        data: {
          workshop_order_id: otherSiteOrder.id,
          title: 'Other site task',
          status: 'NOT_STARTED',
        },
      });
      const { client, transport } = await connectMcpClient(
        adminHeaderA,
        'e2e-cross-site-proposal',
        '00000000-0000-4000-8000-000000000212',
      );

      const result = await client.callTool({
        name: 'propose_line_item',
        arguments: {
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
      });

      expect(result.isError).toBe(true);
      expect(await prismaA.workshopTaskLineItem.count({
        where: { workshop_task_id: otherSiteTask.id },
      })).toBe(0);
      expect(await prismaA.agentActionLog.findFirst({
        where: {
          trace_id: '00000000-0000-4000-8000-000000000212',
          action_type: 'mcp.propose_line_item',
          status: 'FAILED',
        },
      })).toBeTruthy();
      await transport.close();
    });

    it('TECH role rejected on write tools', async () => {
      // Arrange: set the user role to TECH
      await runWithTenantContext(tenantA, async () => {
        await prisma.tenantMember.update({
          where: {
            tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
          },
          data: { role: 'TECH' },
        });
      });

      try {
        await request(app.getHttpServer())
          .post('/api/mcp')
          .set('Authorization', techHeaderA)
          .send({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: 1,
            params: {
              name: 'draft_workshop_order',
              arguments: {
                customer_id: fixtures.customerId,
                vehicle_id: fixtures.vehicleId,
                purpose: 'CUSTOMER_REPAIR',
                status: 'SCHEDULED',
                odometer: 1000,
                fuel_level: 50,
              },
            },
          })
          .expect(403);
        expect(
          await prismaA.workshopOrder.count({
            where: {
              customer_id: fixtures.customerId,
              vehicle_id: fixtures.vehicleId,
            },
          }),
        ).toBe(1);
      } finally {
        await runWithTenantContext(tenantA, async () => {
          await prisma.tenantMember.update({
            where: {
              tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
            },
            data: { role: 'ADMIN' },
          });
        });
      }
    });

   // Note: MCP_SERVER_ENABLED=false → 404 is already tested above
   });
