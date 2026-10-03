import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('MCP server (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let previousMcpFlag: string | undefined;

  let tenantA: string;
  let tenantB: string;
  let adminHeaderA: string;
  let adminHeaderB: string;
  let techHeaderA: string;
  let prismaA: PrismaService;
  let tenantAUserId: string;

  const mcpBaseUrl = () =>
    `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/api/mcp`;

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
    techHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'TECH',
    })}`;

    const tenantAUser = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantResA.firebaseUid },
      select: { id: true },
    });
    tenantAUserId = tenantAUser.id;
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

  it('returns 404 when MCP_SERVER_ENABLED is false', async () => {
    process.env.MCP_SERVER_ENABLED = 'false';
    await request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', adminHeaderA)
      .send({})
      .expect(404);
    process.env.MCP_SERVER_ENABLED = 'true';
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

  it('lists read tools and records agent action logs', async () => {
    const traceId = '00000000-0000-4000-8000-0000000000a1';
    const transport = new StreamableHTTPClientTransport(new URL(mcpBaseUrl()), {
      requestInit: {
        headers: {
          Authorization: adminHeaderA,
          'X-Trace-Id': traceId,
        },
      },
    });
    const client = new Client(
      { name: 'e2e-mcp-inspector', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'get_customer',
        'get_stock_level',
        'get_vehicle',
        'get_workshop_order',
        'list_workshop_orders',
        'search_customers',
        'search_parts',
        'search_vehicles',
      ].sort(),
    );

    const customer = await prismaA.customer.create({
      data: {
        first_name: 'Mcp',
        last_name: 'ReadOnly',
        email: `mcp-ro-${Date.now()}@example.com`,
      },
    });

    const callResult = await client.callTool({
      name: 'get_customer',
      arguments: { customer_id: customer.id },
    });
    expect(callResult.isError).not.toBe(true);

    const log = await prismaA.agentActionLog.findFirst({
      where: { trace_id: traceId, action_type: 'mcp.get_customer' },
    });
    expect(log).toBeTruthy();
    expect(log?.agent_id).toBe('mcp:e2e-mcp-inspector');
    expect(log?.tier).toBe('AUTO');

    await transport.close();
  });

  it('isolates tenant data for get_customer', async () => {
    const customer = await prismaA.customer.create({
      data: {
        first_name: 'Tenant',
        last_name: 'Isolation',
        email: `mcp-iso-${Date.now()}@example.com`,
      },
    });

    const transport = new StreamableHTTPClientTransport(new URL(mcpBaseUrl()), {
      requestInit: {
        headers: { Authorization: adminHeaderB },
      },
    });
    const client = new Client(
      { name: 'e2e-tenant-b', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    const result = await client.callTool({
      name: 'get_customer',
      arguments: { customer_id: customer.id },
    });
    expect(result.isError).toBe(true);

    await transport.close();
  });
});
