import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantMemberRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  hashApiKeySecret,
  parseApiKeyToken,
} from '../src/public-api/api-keys/api-key-token.js';
import { resolveApiKeyPepper } from '../src/public-api/api-keys/api-key-pepper.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const ALL_SCOPES = [
  'customers:read',
  'vehicles:read',
  'invoices:read',
  'workshop-orders:read',
  'stock:read',
];
const CUSTOMERS_PATH = '/public/v1/customers';

type CreatedKey = { id: string; token: string; secret: string };

describe('Public API keys (e2e, AUT-411)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  let tenantA: TestTenantResult;
  let tenantB: TestTenantResult;
  let adminA: string;
  let ownerA: string;
  let techA: string;
  let salesA: string;
  let customerA: string;
  let customerB: string;
  let tenantAPrisma: PrismaService;
  let tenantBPrisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    tenantA = await createTestTenant(prisma, 'public-api-a');
    tenantB = await createTestTenant(prisma, 'public-api-b');
    tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    tenantBPrisma = createTenantAwarePrisma(prisma, tenantB.tenantId);

    adminA = `Bearer ${createTestAuthToken(authService, tenantA, { role: 'ADMIN' })}`;
    ownerA = await createMemberBearer(tenantA, 'OWNER');
    techA = await createMemberBearer(tenantA, 'TECH');
    salesA = await createMemberBearer(tenantA, 'SALES');

    customerA = await createCustomer(tenantA.tenantId, 'Demo Kunde A');
    customerB = await createCustomer(tenantB.tenantId, 'Demo Kunde B');
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    await teardownTestApp(app, prisma);
  });

  afterEach(async () => {
    await prisma.tenant.update({
      where: { id: tenantA.tenantId },
      data: { api_rate_limit_per_minute: 60 },
    });
  });

  async function createMemberBearer(
    tenant: TestTenantResult,
    role: TenantMemberRole,
  ): Promise<string> {
    const slug = role.toLowerCase();
    const firebaseUid = `e2e-${slug}-${tenant.tenantId}`;
    const email = `${slug}-${tenant.tenantId}@example.com`;

    await prisma.user.create({
      data: {
        firebaseUid,
        email,
        active_tenant_id: tenant.tenantId,
        memberships: {
          create: { tenant_id: tenant.tenantId, role, is_active: true },
        },
      },
    });

    return `Bearer ${createTestAuthToken(authService, {
      ...tenant,
      firebaseUid,
      email,
      role,
    })}`;
  }

  async function createCustomer(tenantId: string, firstName: string): Promise<string> {
    const customer = await createTenantAwarePrisma(prisma, tenantId).customer.create({
      data: {
        type: 'PRIVATE',
        first_name: firstName,
        last_name: 'Testperson',
        email: `${firstName.replace(/\W+/g, '.').toLowerCase()}@example.com`,
      },
      select: { id: true },
    });
    return customer.id;
  }

  async function createKey(
    scopes: string[] = ALL_SCOPES,
    name = 'Dashboard',
  ): Promise<CreatedKey> {
    const res = await request(app.getHttpServer())
      .post('/tenant-api-keys')
      .set('Authorization', adminA)
      .send({ name, scopes })
      .expect(201);

    const parsed = parseApiKeyToken(res.body.token);
    if (!parsed) {
      throw new Error('Created token is not in the acp_live_ format.');
    }
    return { id: res.body.id, token: res.body.token, secret: parsed.secret };
  }

  function apiKey(key: CreatedKey): string {
    return `Bearer ${key.token}`;
  }

  describe('admin key management (OWNER and ADMIN)', () => {
    it('creates a key that is listed as ACTIVE without its secret or digest', async () => {
      const key = await createKey(['customers:read'], 'Listed key');

      const res = await request(app.getHttpServer())
        .get('/tenant-api-keys')
        .set('Authorization', ownerA)
        .expect(200);

      const listed = res.body.data.find((row: { id: string }) => row.id === key.id);
      expect(listed).toEqual(
        expect.objectContaining({
          name: 'Listed key',
          keyPrefix: `acp_live_${key.id.slice(0, 8)}`,
          scopes: ['customers:read'],
          status: 'ACTIVE',
        }),
      );
      expect(JSON.stringify(res.body)).not.toContain(key.secret);
      expect(JSON.stringify(res.body)).not.toContain('secret_hash');
    });

    it('returns the full token exactly once, at creation', async () => {
      const key = await createKey(['stock:read']);

      expect(key.token).toMatch(/^acp_live_[0-9a-f-]{36}_[0-9a-f]{64}$/);

      const res = await request(app.getHttpServer())
        .get(`/tenant-api-keys`)
        .set('Authorization', adminA)
        .expect(200);
      const listed = res.body.data.find((row: { id: string }) => row.id === key.id);
      expect(listed).toBeDefined();
      expect(listed.token).toBeUndefined();
    });

    it('stores only the keyed digest and display prefix, never the secret', async () => {
      const key = await createKey();

      const row = await tenantAPrisma.tenantApiKey.findFirstOrThrow({ where: { id: key.id } });

      expect(JSON.stringify(row)).not.toContain(key.secret);
      expect(row.key_prefix).toBe(`acp_live_${key.id.slice(0, 8)}`);
      const pepper = resolveApiKeyPepper();
      expect(pepper).toBeDefined();
      expect(row.secret_hash).toBe(hashApiKeySecret(key.id, key.secret, pepper as Buffer));
      expect(row.tenant_id).toBe(tenantA.tenantId);
    });

    it('writes an audit CREATE entry that holds no digest and no token', async () => {
      const key = await createKey();

      const entries = await tenantAPrisma.auditLog.findMany({
        where: { tenant_id: tenantA.tenantId, entity_type: 'TenantApiKey', entity_id: key.id },
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.action).toBe('CREATE');
      const payload = JSON.stringify(entries[0]);
      expect(payload).not.toContain(key.secret);
      expect(payload).not.toContain(key.token);
      expect(payload).not.toContain('secret_hash');
    });

    it.each([
      ['TECH', () => techA],
      ['SALES', () => salesA],
    ])('answers %s with 403 on list, create and revoke', async (_role, bearer) => {
      const key = await createKey(['stock:read'], 'Guarded key');

      await request(app.getHttpServer())
        .get('/tenant-api-keys')
        .set('Authorization', bearer())
        .expect(403);
      await request(app.getHttpServer())
        .post('/tenant-api-keys')
        .set('Authorization', bearer())
        .send({ name: 'Nope', scopes: ['stock:read'] })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/tenant-api-keys/${key.id}/revoke`)
        .set('Authorization', bearer())
        .expect(403);

      const row = await tenantAPrisma.tenantApiKey.findFirstOrThrow({ where: { id: key.id } });
      expect(row.revoked_at).toBeNull();
    });

    it('rejects an expiry date that is not in the future', async () => {
      await request(app.getHttpServer())
        .post('/tenant-api-keys')
        .set('Authorization', adminA)
        .send({ name: 'Past', scopes: ['stock:read'], expiresAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);
    });

    it('answers 404 when revoking a key that belongs to another tenant', async () => {
      const bKey = await createKeyForTenant(tenantB);

      await request(app.getHttpServer())
        .post(`/tenant-api-keys/${bKey.id}/revoke`)
        .set('Authorization', adminA)
        .expect(404);

      const row = await tenantBPrisma.tenantApiKey.findFirstOrThrow({ where: { id: bKey.id } });
      expect(row.revoked_at).toBeNull();
    });
  });

  describe('authentication and authorization on /public/v1', () => {
    it('serves the key tenant data and never another tenant data', async () => {
      const key = await createKey(['customers:read']);

      const res = await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', apiKey(key))
        .expect(200);

      const ids = res.body.data.map((row: { id: string }) => row.id);
      expect(ids).toContain(customerA);
      expect(ids).not.toContain(customerB);
      expect(res.body.meta).toEqual(
        expect.objectContaining({ page: 1, pageSize: 25 }),
      );
    });

    it('answers 404 for a record of another tenant requested by id', async () => {
      const key = await createKey(['customers:read']);

      await request(app.getHttpServer())
        .get(`${CUSTOMERS_PATH}/${customerB}`)
        .set('Authorization', apiKey(key))
        .expect(404);
    });

    it('rejects a key with a wrong secret with 401', async () => {
      const key = await createKey(['customers:read']);
      const forged = `acp_live_${key.id}_${'0'.repeat(64)}`;

      await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rejects a revoked key with 401 on the very next request', async () => {
      const key = await createKey(['customers:read']);
      await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', apiKey(key))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/tenant-api-keys/${key.id}/revoke`)
        .set('Authorization', adminA)
        .expect(201);

      await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', apiKey(key))
        .expect(401);
    });

    it('rejects an expired key with 401', async () => {
      const key = await createKey(['customers:read']);
      await tenantAPrisma.tenantApiKey.update({
        where: { id: key.id },
        data: { expires_at: new Date(Date.now() - 60_000) },
      });

      await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', apiKey(key))
        .expect(401);
    });

    it('answers 403 when the key lacks the scope the route requires', async () => {
      const key = await createKey(['stock:read']);

      const res = await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', apiKey(key))
        .expect(403);

      expect(JSON.stringify(res.body)).toContain('customers:read');
    });

    it('rejects API keys on session-only endpoints (deny by default) with 403', async () => {
      const key = await createKey(ALL_SCOPES);

      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', apiKey(key))
        .expect(403);
      await request(app.getHttpServer())
        .get('/tenant-api-keys')
        .set('Authorization', apiKey(key))
        .expect(403);
    });

    it('keeps session authentication working for ordinary users', async () => {
      await request(app.getHttpServer())
        .get('/customers')
        .set('Authorization', adminA)
        .expect(200);
    });
  });

  describe('every public route is gated by its own scope', () => {
    it.each([
      ['/public/v1/vehicles', 'vehicles:read'],
      ['/public/v1/invoices', 'invoices:read'],
      ['/public/v1/workshop-orders', 'workshop-orders:read'],
      ['/public/v1/stock', 'stock:read'],
    ])('serves %s with its scope and answers 403 without it', async (path, scope) => {
      const withScope = await createKey([scope]);
      const res = await request(app.getHttpServer()).get(path).set('Authorization', apiKey(withScope)).expect(200);
      expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, pageSize: 25 }));

      const otherScopes = ALL_SCOPES.filter((candidate) => candidate !== scope);
      const withoutScope = await createKey(otherScopes);
      await request(app.getHttpServer()).get(path).set('Authorization', apiKey(withoutScope)).expect(403);
    });
  });

  describe('per-key rate limit', () => {
    it('answers 429 with Retry-After once the key budget for the window is spent', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.tenantId },
        data: { api_rate_limit_per_minute: 2 },
      });
      const key = await createKey(['customers:read'], 'Budget key');

      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(200);
      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(200);
      const limited = await request(app.getHttpServer())
        .get(CUSTOMERS_PATH)
        .set('Authorization', apiKey(key))
        .expect(429);

      const retryAfter = Number(limited.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('counts each key separately, so one key cannot spend another key budget', async () => {
      await prisma.tenant.update({
        where: { id: tenantA.tenantId },
        data: { api_rate_limit_per_minute: 1 },
      });
      const first = await createKey(['customers:read'], 'First');
      const second = await createKey(['customers:read'], 'Second');

      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(first)).expect(200);
      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(first)).expect(429);
      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(second)).expect(200);
    });
  });

  describe('audit trail and last_used_at', () => {
    it('writes one agent-action row per request, carrying the key id and the route', async () => {
      const key = await createKey(['customers:read']);

      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(200);
      await request(app.getHttpServer()).get(`${CUSTOMERS_PATH}/${customerB}`).set('Authorization', apiKey(key)).expect(404);

      const rows = await tenantAPrisma.agentActionLog.findMany({
        where: { tenant_id: tenantA.tenantId, api_key_id: key.id },
        orderBy: { created_at: 'asc' },
      });

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.actor_type)).toEqual(['API_KEY', 'API_KEY']);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          action_type: 'public_api.customers:read',
          status: 'EXECUTED',
          agent_id: null,
        }),
      );
      expect(rows[0]?.input_summary_json).toEqual(
        expect.objectContaining({ method: 'GET', route: CUSTOMERS_PATH }),
      );
      expect(rows[1]?.input_summary_json).toEqual(
        expect.objectContaining({ method: 'GET', route: `${CUSTOMERS_PATH}/:id` }),
      );
      expect(JSON.stringify(rows)).not.toContain(key.secret);
    });

    it('records refusals (revoked, missing scope, unmapped) with the key id', async () => {
      const key = await createKey(['stock:read']);

      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(403);
      await request(app.getHttpServer()).get('/customers').set('Authorization', apiKey(key)).expect(403);

      const rows = await tenantAPrisma.agentActionLog.findMany({
        where: { tenant_id: tenantA.tenantId, api_key_id: key.id },
        orderBy: { created_at: 'asc' },
      });

      expect(rows.map((row) => row.status)).toEqual(['REFUSED', 'REFUSED']);
      expect(rows.map((row) => row.action_type)).toEqual([
        'public_api.customers:read',
        'public_api.unmapped',
      ]);
    });

    it('sets last_used_at on first use and does not rewrite it inside the throttle window', async () => {
      const key = await createKey(['customers:read']);
      const before = await tenantAPrisma.tenantApiKey.findFirstOrThrow({ where: { id: key.id } });
      expect(before.last_used_at).toBeNull();

      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(200);
      const first = await tenantAPrisma.tenantApiKey.findFirstOrThrow({ where: { id: key.id } });
      expect(first.last_used_at).toBeInstanceOf(Date);

      await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(200);
      const second = await tenantAPrisma.tenantApiKey.findFirstOrThrow({ where: { id: key.id } });
      expect(second.last_used_at?.getTime()).toBe(first.last_used_at?.getTime());
    });
  });

  describe('secret handling', () => {
    it('never writes the secret to logs, the audit trail or the agent-action log', async () => {
      const key = await createKey(['customers:read'], 'Log hygiene');

      const captured: string[] = [];
      const spies = [
        jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
          captured.push(String(chunk));
          return true;
        }),
        jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
          captured.push(String(chunk));
          return true;
        }),
        jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
          captured.push(args.map(String).join(' '));
        }),
        jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
          captured.push(args.map(String).join(' '));
        }),
        jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
          captured.push(args.map(String).join(' '));
        }),
      ];

      try {
        await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', apiKey(key)).expect(200);
        await request(app.getHttpServer()).get(CUSTOMERS_PATH).set('Authorization', `Bearer acp_live_${key.id}_${'1'.repeat(64)}`).expect(401);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }

      const output = captured.join('\n');
      expect(output).not.toContain(key.secret);
      expect(output).not.toContain(key.token);

      const rows = await tenantAPrisma.agentActionLog.findMany({ where: { api_key_id: key.id } });
      const audits = await tenantAPrisma.auditLog.findMany({ where: { entity_id: key.id } });
      expect(JSON.stringify(rows)).not.toContain(key.secret);
      expect(JSON.stringify(audits)).not.toContain(key.secret);
    });
  });

  /** Inserts a key row directly for another tenant. Only the id matters for the cross-tenant revoke check. */
  async function createKeyForTenant(tenant: TestTenantResult): Promise<{ id: string }> {
    return createTenantAwarePrisma(prisma, tenant.tenantId).tenantApiKey.create({
      data: {
        id: randomUUID(),
        tenant_id: tenant.tenantId,
        name: 'Other tenant key',
        key_prefix: 'acp_live_00000000',
        secret_hash: 'a'.repeat(64),
        scopes: ['stock:read'],
      },
      select: { id: true },
    });
  }
});
