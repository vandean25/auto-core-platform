import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AgentActionLogService } from '../src/agent-action-log/agent-action-log.service.js';
import { AuditLogAction } from '@prisma/client';
import {
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  cleanupTestTenantGraph,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { TenantContextStorage } from '../src/common/services/tenant-context.storage.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Agent action log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let agentActionLogService: AgentActionLogService;

  let tenantA: string;
  let tenantB: string;
  let adminHeaderA: string;
  let adminHeaderB: string;
  let techHeaderA: string;
  let prismaA: PrismaService;
  let tenantAUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    agentActionLogService = app.get(AgentActionLogService);

    const tenantResA = await createTestTenant(prisma, 'agent-log-a');
    const tenantResB = await createTestTenant(prisma, 'agent-log-b');
    tenantA = tenantResA.tenantId;
    tenantB = tenantResB.tenantId;
    prismaA = createTenantAwarePrisma(prisma, tenantA);

    const tenantAUser = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantResA.firebaseUid },
      select: { id: true },
    });
    tenantAUserId = tenantAUser.id;

    adminHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'ADMIN',
    })}`;
    adminHeaderB = `Bearer ${createTestAuthToken(authService, tenantResB, {
      role: 'ADMIN',
    })}`;
    techHeaderA = `Bearer ${createTestAuthToken(authService, tenantResA, {
      role: 'TECH',
    })}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA);
    await cleanupTestTenantGraph(prisma, tenantB);
    await teardownTestApp(app, prisma);
  });

  it('returns X-Trace-Id on API responses', async () => {
    const traceId = '00000000-0000-4000-8000-00000000c0de';
    const res = await request(app.getHttpServer())
      .get('/agent-actions')
      .set('Authorization', adminHeaderA)
      .set('X-Trace-Id', traceId)
      .expect(200);

    expect(res.headers['x-trace-id']).toBe(traceId);
  });

  it('record correlates audit rows and GET /agent-actions/:traceId returns both', async () => {
    const customer = await prismaA.customer.create({
      data: {
        first_name: 'Agent',
        last_name: 'Target',
        email: `agent-target-${Date.now()}@example.com`,
      },
    });

    const traceId = '00000000-0000-4000-8000-00000000d001';

    await runWithTenantContext(tenantA, async () => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-agent-e2e',
        traceId,
        source: 'API',
      });

      await agentActionLogService.record(
        {
          traceId,
          actorType: 'AGENT',
          agentId: 'import-matcher',
          actionType: 'customer.update',
          tier: 'AUTO',
          status: 'EXECUTED',
          entityType: 'Customer',
          entityId: customer.id,
          inputSummary: { first_name: 'AgentUpdated' },
        },
        async () => {
          await prismaA.customer.update({
            where: { id: customer.id },
            data: { first_name: 'AgentUpdated' },
          });
        },
      );
    });

    const updated = await prismaA.customer.findFirst({
      where: { id: customer.id },
    });
    expect(updated?.first_name).toBe('AgentUpdated');

    const auditRows = await prismaA.auditLog.findMany({
      where: {
        entity_type: 'Customer',
        entity_id: customer.id,
        action: AuditLogAction.UPDATE,
      },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].request_id).toBe(traceId);

    const detail = await request(app.getHttpServer())
      .get(`/agent-actions/${traceId}`)
      .set('Authorization', adminHeaderA)
      .expect(200);

    expect(detail.body.logs).toHaveLength(1);
    expect(detail.body.logs[0].traceId).toBe(traceId);
    expect(detail.body.auditEntries).toHaveLength(1);
    expect(detail.body.auditEntries[0].entityId).toBe(customer.id);
  });

  it('denies non-admin tenant users', async () => {
    await runWithTenantContext(tenantA, async () => {
      await prisma.tenantMember.update({
        where: {
          tenant_id_user_id: { tenant_id: tenantA, user_id: tenantAUserId },
        },
        data: { role: 'TECH' },
      });
    });

    await request(app.getHttpServer())
      .get('/agent-actions')
      .set('Authorization', techHeaderA)
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

  it('returns 400 for a non-UUID trace id path param', async () => {
    await request(app.getHttpServer())
      .get('/agent-actions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .set('Authorization', adminHeaderA)
      .expect(400);
  });

  it('isolates traces across tenants', async () => {
    const traceId = '00000000-0000-4000-8000-00000000e001';
    await prismaA.agentActionLog.create({
      data: {
        tenant_id: tenantA,
        trace_id: traceId,
        actor_type: 'AGENT',
        agent_id: 'mcp:test',
        action_type: 'noop',
        tier: 'AUTO',
        status: 'DRY_RUN',
      },
    });

    await request(app.getHttpServer())
      .get(`/agent-actions/${traceId}`)
      .set('Authorization', adminHeaderB)
      .expect(404);
  });
});
