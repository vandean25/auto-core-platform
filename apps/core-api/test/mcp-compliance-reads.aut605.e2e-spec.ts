import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PdfStorage } from '../src/common/pdf/pdf-storage.js';
import { MechanicMediaStorage } from '../src/mechanic/mechanic-media.storage.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  MCP_COMPLIANCE_READ_TOOL_NAMES,
  MCP_TOOL_NAMES_WITH_COMPLIANCE,
} from '../src/mcp/mcp-read-tool-catalog.aut605.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { createInMemoryPdfArchive } from './support/in-memory-pdf-archive.js';
import { complianceReadCallsForE2e } from './mcp-e2e-compliance-read-calls.aut605.js';
import {
  closeMcpHttpClient,
  connectMcpHttpClient,
  mcpToolPayloadText,
} from './mcp-e2e-client.aut605.js';

describe('MCP compliance read tools (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previousMcpFlag: string | undefined;
  let tenantId: string;
  let adminHeader: string;
  let prismaTenant: PrismaService;
  let customerId: string;
  let workshopOrderId: string;

  beforeAll(async () => {
    jest.setTimeout(120000);
    previousMcpFlag = process.env.MCP_SERVER_ENABLED;
    process.env.MCP_SERVER_ENABLED = 'true';
    process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';

    const pdfArchive = createInMemoryPdfArchive();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PdfStorage)
      .useValue(pdfArchive)
      .overrideProvider(MechanicMediaStorage)
      .useValue({ generateUploadPolicy: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.listen(0);

    prisma = app.get(PrismaService);
    const authService = app.get(AuthService);
    const tenantRes = await createTestTenant(prisma, 'mcp-compliance');
    tenantId = tenantRes.tenantId;
    prismaTenant = createTenantAwarePrisma(prisma, tenantId);
    adminHeader = `Bearer ${createTestAuthToken(authService, tenantRes, {
      role: 'ADMIN',
    })}`;

    const siteId = await resolveTestMainSiteId(prisma, tenantId);
    const label = `Compliance${Date.now()}`;
    const customer = await prismaTenant.customer.create({
      data: {
        first_name: 'Compliance',
        last_name: label,
        email: `compliance-${Date.now()}@example.com`,
      },
    });
    customerId = customer.id;
    const staging = await prismaTenant.storageLocation.create({
      data: {
        site_id: siteId,
        code: `CMP-TOTE-${label}`,
        name: 'Compliance staging',
        type: 'staging_tote',
      },
    });
    const vehicle = await prismaTenant.vehicle.create({
      data: {
        make: 'Test',
        model: 'Compliance',
        year: 2021,
        vin: `VIN-${label}`,
        customer_id: customer.id,
      },
    });
    const order = await prismaTenant.workshopOrder.create({
      data: {
        order_number: `WO-${label}`,
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        site_id: siteId,
        staging_location_id: staging.id,
        odometer: 500,
        fuel_level: 50,
        status: 'INTAKE',
      },
      select: { id: true },
    });
    workshopOrderId = order.id;
  });

  afterAll(async () => {
    if (previousMcpFlag === undefined) {
      delete process.env.MCP_SERVER_ENABLED;
    } else {
      process.env.MCP_SERVER_ENABLED = previousMcpFlag;
    }
    await cleanupTestTenantGraph(prisma, tenantId);
    await teardownTestApp(app, prisma);
  });

  it('registers compliance read tools on the production MCP session stack', async () => {
    const { client, transport } = await connectMcpHttpClient(
      app,
      adminHeader,
      'e2e-compliance-registry',
    );
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    expect(toolNames.sort()).toEqual([...MCP_TOOL_NAMES_WITH_COMPLIANCE].sort());
    for (const name of MCP_COMPLIANCE_READ_TOOL_NAMES) {
      expect(toolNames).toContain(name);
    }
    await closeMcpHttpClient(transport);
  });

  it('calls each compliance read tool successfully', async () => {
    const { client, transport } = await connectMcpHttpClient(
      app,
      adminHeader,
      'e2e-compliance-reads',
    );
    const calls = complianceReadCallsForE2e({
      customerId,
      workshopOrderId,
    });
    for (const call of calls) {
      const result = (await client.callTool({
        name: call.name,
        arguments: call.arguments,
      })) as CallToolResult;
      expect(result.isError).not.toBe(true);
      expect(mcpToolPayloadText(result).length).toBeGreaterThan(0);
    }
    await closeMcpHttpClient(transport);
  });
});
