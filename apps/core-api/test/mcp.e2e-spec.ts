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
import { MCP_READ_TOOL_NAMES } from '../src/mcp/mcp.constants.js';
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
    return {
      searchToken,
      customerId: customer.id,
      vehicleId: vehicle.id,
      workshopOrderId: workshopOrder.id,
      catalogItemId: catalogItem.id,
      sku,
    };
  }

  beforeAll(async () => {
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

  it('lists all eight read tools', async () => {
    const { client, transport } = await connectMcpClient(
      adminHeaderA,
      'e2e-list-tools',
    );
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...MCP_READ_TOOL_NAMES].sort(),
    );
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
});
