import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AgentPolicyTier, AuditLogAction } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AGENT_POLICY_AUDIT_SOURCE } from '../src/agent-policy/agent-policy.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Agent policy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
  let authHeaderA: string;
  let authHeaderB: string;
  let prismaA: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    const authService = app.get(AuthService);

    tenantA = await createTestTenant(prisma, 'agent-policy-a');
    tenantB = await createTestTenant(prisma, 'agent-policy-b');

    authHeaderA = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    authHeaderB = `Bearer ${createTestAuthToken(authService, tenantB)}`;
    prismaA = createTenantAwarePrisma(prisma, tenantA.tenantId);
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    await teardownTestApp(app, prisma);
  });

  it('lists seeded platform defaults for OWNER/ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/agent-policy/rules')
      .set('Authorization', authHeaderA)
      .expect(200);

    const addLine = response.body.data.find(
      (rule: { action_type: string }) =>
        rule.action_type === 'workshop_order.add_line',
    );
    expect(addLine?.tier).toBe(AgentPolicyTier.AUTO);
    expect(addLine?.source).toBe('platform');
  });

  it('rejects tenant tiers looser than platform default', async () => {
    await request(app.getHttpServer())
      .put('/api/agent-policy/rules/sales_order.apply_discount')
      .set('Authorization', authHeaderA)
      .send({ tier: AgentPolicyTier.AUTO, enabled: true })
      .expect(422);

    await request(app.getHttpServer())
      .put('/api/agent-policy/rules/sales_order.apply_discount')
      .set('Authorization', authHeaderA)
      .send({ tier: AgentPolicyTier.HUMAN_ONLY, enabled: true })
      .expect(200);
  });

  it('writes audit log with before/after on rule change', async () => {
    const update = await request(app.getHttpServer())
      .put('/api/agent-policy/rules/workshop_order.add_line')
      .set('Authorization', authHeaderA)
      .send({ tier: AgentPolicyTier.PROPOSE, enabled: true })
      .expect(200);

    const audit = await prismaA.auditLog.findFirst({
      where: {
        entity_type: 'AgentPolicyRule',
        entity_id: update.body.id,
        action: AuditLogAction.UPDATE,
        source: AGENT_POLICY_AUDIT_SOURCE,
      },
      orderBy: { occurred_at: 'desc' },
    });

    expect(audit?.before).toBeTruthy();
    expect(audit?.after).toBeTruthy();
    expect(audit?.diff).toBeTruthy();
  });

  it('evaluates amount escalation and hard floor', async () => {
    const escalated = await request(app.getHttpServer())
      .post('/api/agent-policy/evaluate')
      .set('Authorization', authHeaderA)
      .send({
        action_type: 'inventory.part_reserve',
        context: { amount_eur: 900 },
      })
      .expect(200);

    expect(escalated.body.tier).toBe(AgentPolicyTier.PROPOSE);
    expect(escalated.body.reasons).toContain('amount_above_threshold');

    const floor = await request(app.getHttpServer())
      .post('/api/agent-policy/evaluate')
      .set('Authorization', authHeaderA)
      .send({ action_type: 'invoice.finalize', context: {} })
      .expect(200);

    expect(floor.body.tier).toBe(AgentPolicyTier.HUMAN_ONLY);
    expect(floor.body.reasons).toContain('hard_floor_category');
  });

  it('enforces tenant isolation for rules and updates', async () => {
    await runWithTenantContext(tenantA.tenantId, async () => {
      await prisma.agentPolicyRule.create({
        data: {
          tenant_id: tenantA.tenantId,
          action_type: 'workshop_order.add_line',
          tier: AgentPolicyTier.HUMAN_ONLY,
          conditions_json: {},
          enabled: true,
          version: 99,
        },
      });
    });

    const tenantBList = await request(app.getHttpServer())
      .get('/api/agent-policy/rules')
      .set('Authorization', authHeaderB)
      .expect(200);

    const tenantBOverride = tenantBList.body.data.find(
      (rule: { action_type: string; version: number }) =>
        rule.action_type === 'workshop_order.add_line' && rule.version === 99,
    );
    expect(tenantBOverride).toBeUndefined();

    await request(app.getHttpServer())
      .put('/api/agent-policy/rules/workshop_order.add_line')
      .set('Authorization', authHeaderB)
      .send({ tier: AgentPolicyTier.HUMAN_ONLY })
      .expect(200);

    const techTenant = await createTestTenant(prisma, 'agent-policy-tech');
    const techUser = await prisma.user.create({
      data: {
        firebaseUid: `tech-agent-policy-${techTenant.tenantId}`,
        email: `tech-agent-policy-${techTenant.tenantId}@example.com`,
      },
    });
    await runWithTenantContext(techTenant.tenantId, async () => {
      await seedTestTenantMember(prisma, {
        tenantId: techTenant.tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
    });
    const techHeader = `Bearer ${createTestAuthToken(app.get(AuthService), {
      ...techTenant,
      firebaseUid: techUser.firebaseUid!,
      email: techUser.email,
      role: 'TECH',
    })}`;

    await request(app.getHttpServer())
      .get('/api/agent-policy/rules')
      .set('Authorization', techHeader)
      .expect(403);

    await cleanupTestTenantGraph(prisma, techTenant.tenantId);
  });
});
