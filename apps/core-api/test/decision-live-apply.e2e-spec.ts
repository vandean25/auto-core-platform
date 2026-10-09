import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SystemPrismaService } from '../src/prisma/system-prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { DECISION_PROVIDER_TOKEN } from '../src/decision/decision.constants.js';
import { DecisionLiveApplyService } from '../src/decision/decision-live-apply.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type TestTenant = Awaited<ReturnType<typeof createTestTenant>>;

const DECISION_ACTIONS = ['decision.import_row_match', 'decision.document_sort'];
const customerMapping = {
  external_id: 'Kunden-Nr',
  type: 'Typ',
  first_name: 'Vorname',
  last_name: 'Nachname',
  email: 'E-Mail',
};

function suggestion(choice: string) {
  return {
    choice,
    raw_ref: 'e2e-raw',
    latency_ms: 7,
    provider: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
  };
}

function customerCsv(lastName: string, externalId: string) {
  const headers = ['Kunden-Nr', 'Typ', 'Vorname', 'Nachname', 'E-Mail'];
  return Buffer.from(
    serializeCsv(
      headers,
      [[externalId, 'PRIVATE', 'Erika', lastName, `${externalId}@example.org`]],
      ';',
    ),
    'utf8',
  );
}

async function waitFor<T>(
  read: () => Promise<T | null | undefined>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('Decision live-apply (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let systemPrisma: SystemPrismaService;
  let authService: AuthService;
  let live: DecisionLiveApplyService;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let authA: string;
  let authB: string;
  const decide = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DECISION_PROVIDER_TOKEN)
      .useValue({ providerId: 'openrouter-jev', decide })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    systemPrisma = app.get(SystemPrismaService);
    authService = app.get(AuthService);
    live = app.get(DecisionLiveApplyService);
    tenantA = await createTestTenant(prisma, 'decision-live-a');
    tenantB = await createTestTenant(prisma, 'decision-live-b');
    authA = `Bearer ${createTestAuthToken(authService, tenantA)}`;
    authB = `Bearer ${createTestAuthToken(authService, tenantB)}`;
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      if (!tenant) continue;
      await createTenantAwarePrisma(prisma, tenant.tenantId).documentBrandAsset.deleteMany({});
      await cleanupTestTenantGraph(prisma, tenant.tenantId);
    }
    await systemPrisma.agentPolicyRule.deleteMany({
      where: { tenant_id: null, action_type: { in: DECISION_ACTIONS }, version: { gt: 1 } },
    });
    await teardownTestApp(app, prisma);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DECISION_APPLY_MODE = 'live';
    delete process.env.DECISION_SHADOW_ENABLED;
    delete process.env.DECISION_HTTP_TIMEOUT_MS;
    delete process.env.DECISION_LIVE_OPT_IN;
    for (const tenant of [tenantA, tenantB]) {
      await createTenantAwarePrisma(prisma, tenant.tenantId).agentPolicyRule.deleteMany({});
      await systemPrisma.tenant.update({
        where: { id: tenant.tenantId },
        data: { decision_apply_mode: null },
      });
    }
    await systemPrisma.agentPolicyRule.deleteMany({
      where: { tenant_id: null, action_type: { in: DECISION_ACTIONS }, version: { gt: 1 } },
    });
  });

  afterEach(() => {
    delete process.env.DECISION_APPLY_MODE;
    delete process.env.DECISION_SHADOW_ENABLED;
    delete process.env.DECISION_HTTP_TIMEOUT_MS;
  });

  /** Test-only AUTO rule. Tenant rules can never loosen the platform default, so AUTO is platform-owned. */
  async function setPlatformTierForTest(actionType: string, tier: 'AUTO' | 'PROPOSE') {
    await systemPrisma.agentPolicyRule.create({
      data: {
        tenant_id: null,
        action_type: actionType,
        tier,
        conditions_json: {},
        enabled: true,
        version: 2,
      },
    });
  }

  async function setTenantTier(tenant: TestTenant, actionType: string, tier: 'HUMAN_ONLY' | 'PROPOSE') {
    await createTenantAwarePrisma(prisma, tenant.tenantId).agentPolicyRule.create({
      data: {
        tenant_id: tenant.tenantId,
        action_type: actionType,
        tier,
        conditions_json: {},
        enabled: true,
        version: 1,
      },
    });
  }

  async function seedCustomer(tenant: TestTenant, lastName: string) {
    return createTenantAwarePrisma(prisma, tenant.tenantId).customer.create({
      data: {
        tenant_id: tenant.tenantId,
        type: 'PRIVATE',
        first_name: 'Erika',
        last_name: lastName,
        email: `${lastName.toLowerCase()}@example.org`,
      },
    });
  }

  async function runImport(auth: string, traceId: string, lastName: string) {
    const response = await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', auth)
      .set('X-Trace-Id', traceId)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach('file', customerCsv(lastName, `ext-${lastName}`), 'customers.csv')
      .expect(201);
    return response.body as { id: string; totals: { create: number; update: number } };
  }

  async function importRow(tenant: TestTenant, jobId: string) {
    return createTenantAwarePrisma(prisma, tenant.tenantId).importJobRow.findFirst({
      where: { import_job_id: jobId, row_no: 1 },
    });
  }

  async function logsFor(tenant: TestTenant, traceId: string) {
    return createTenantAwarePrisma(prisma, tenant.tenantId).agentActionLog.findMany({
      where: { trace_id: traceId },
    });
  }

  async function proposalsFor(tenant: TestTenant, traceId: string) {
    return createTenantAwarePrisma(prisma, tenant.tenantId).agentProposal.findMany({
      where: { trace_id: traceId },
    });
  }

  async function createReadyAsset(tenant: TestTenant) {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const legalEntity = await tenantPrisma.legalEntity.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId },
    });
    const id = randomUUID();
    return tenantPrisma.documentBrandAsset.create({
      data: {
        id,
        tenant_id: tenant.tenantId,
        legal_entity_id: legalEntity.id,
        purpose: 'SOURCE',
        state: 'READY',
        byte_length: 128,
        detected_mime_type: 'application/pdf',
        original_filename: 'beleg.pdf',
        sha256: 'b'.repeat(64),
        bucket: 'e2e-test-bucket',
        object_key: `e2e/${id}.pdf`,
        object_generation: '1',
      },
    });
  }

  function decideDocument(tenant: TestTenant, assetId: string, text: string) {
    return runWithTenantContext(tenant.tenantId, () =>
      live.applyDocumentSortForAsset({
        tenantId: tenant.tenantId,
        assetId,
        traceId: randomUUID(),
        text,
      }),
    );
  }

  describe('shadow (default)', () => {
    it('does not change the import and only writes the shadow row', async () => {
      delete process.env.DECISION_APPLY_MODE;
      process.env.DECISION_SHADOW_ENABLED = 'true';
      decide.mockResolvedValue(suggestion('choice_1'));
      const lastName = `Shadow-${randomUUID().slice(0, 8)}`;
      await seedCustomer(tenantA, lastName);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, lastName);

      const shadowRow = await waitFor(async () =>
        createTenantAwarePrisma(prisma, tenantA.tenantId).decisionShadowLog.findFirst({
          where: { trace_id: traceId },
        }),
      );
      expect(shadowRow.use_case).toBe('import_row_matching');
      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
      expect(job.totals).toEqual(expect.objectContaining({ create: 1, update: 0 }));
      expect(await logsFor(tenantA, traceId)).toHaveLength(0);
      expect(await proposalsFor(tenantA, traceId)).toHaveLength(0);
    });

    it('does not consult document sort in shadow mode', async () => {
      delete process.env.DECISION_APPLY_MODE;
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Hallo Werkstatt');

      expect(decide).not.toHaveBeenCalled();
      const reloaded = await createTenantAwarePrisma(prisma, tenantA.tenantId).documentBrandAsset.findFirst({
        where: { id: asset.id },
      });
      expect(reloaded?.document_sort_type).toBeNull();
    });
  });

  describe('import matching (customer)', () => {
    it('live + AUTO: adopts the suggested customer and logs the trace', async () => {
      await setPlatformTierForTest('decision.import_row_match', 'AUTO');
      decide.mockResolvedValue(suggestion('choice_1'));
      const existing = await seedCustomer(tenantA, `Auto-${randomUUID().slice(0, 8)}`);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, existing.last_name);

      const row = await importRow(tenantA, job.id);
      expect(row).toMatchObject({ action: 'UPDATE', entity_id: existing.id });
      expect(job.totals).toEqual(expect.objectContaining({ create: 0, update: 1 }));
      const logs = await logsFor(tenantA, traceId);
      expect(logs).toEqual([
        expect.objectContaining({
          trace_id: traceId,
          action_type: 'decision.import_row_match',
          tier: 'AUTO',
          status: 'EXECUTED',
          entity_type: 'ImportJob',
          entity_id: job.id,
        }),
      ]);
      expect(await proposalsFor(tenantA, traceId)).toHaveLength(0);
    });

    it('live + PROPOSE (platform default): does not apply, creates a pending approval, and approves it', async () => {
      decide.mockResolvedValue(suggestion('choice_1'));
      const existing = await seedCustomer(tenantA, `Propose-${randomUUID().slice(0, 8)}`);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, existing.last_name);

      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
      const [proposal] = await proposalsFor(tenantA, traceId);
      expect(proposal).toMatchObject({
        action_type: 'decision.import_row_match',
        tier: 'PROPOSE',
        status: 'PENDING',
        payload_json: { import_job_id: job.id, row_no: 1, customer_id: existing.id },
      });
      expect(
        (await logsFor(tenantA, traceId)).map((log) => log.status),
      ).toEqual(['PROPOSED']);

      const listing = await request(app.getHttpServer())
        .get('/agent-proposals')
        .set('Authorization', authA)
        .expect(200);
      const listed = JSON.stringify(listing.body);
      expect(listed).toContain(proposal.id);

      await request(app.getHttpServer())
        .post(`/agent-proposals/${proposal.id}/approve`)
        .set('Authorization', authA)
        .expect((response) => {
          expect([200, 201]).toContain(response.status);
          expect(response.body).toMatchObject({ status: 'EXECUTED' });
        });

      expect(await importRow(tenantA, job.id)).toMatchObject({
        action: 'UPDATE',
        entity_id: existing.id,
      });
      const reloaded = await createTenantAwarePrisma(prisma, tenantA.tenantId).importJob.findFirst({
        where: { id: job.id },
      });
      expect(reloaded?.totals_json).toEqual(
        expect.objectContaining({ create: 0, update: 1 }),
      );
    });

    it('live + HUMAN_ONLY: never applies or proposes, and logs the refusal', async () => {
      await setTenantTier(tenantA, 'decision.import_row_match', 'HUMAN_ONLY');
      decide.mockResolvedValue(suggestion('choice_1'));
      const existing = await seedCustomer(tenantA, `Human-${randomUUID().slice(0, 8)}`);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, existing.last_name);

      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
      expect(await proposalsFor(tenantA, traceId)).toHaveLength(0);
      expect(await logsFor(tenantA, traceId)).toEqual([
        expect.objectContaining({
          tier: 'HUMAN_ONLY',
          status: 'REFUSED',
          result_summary_json: expect.objectContaining({ reason: 'human_only' }),
        }),
      ]);
    });

    it('falls back to the rules outcome when Jev times out', async () => {
      process.env.DECISION_HTTP_TIMEOUT_MS = '50';
      await setPlatformTierForTest('decision.import_row_match', 'AUTO');
      decide.mockImplementation(() => new Promise<never>(() => undefined));
      const existing = await seedCustomer(tenantA, `Timeout-${randomUUID().slice(0, 8)}`);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, existing.last_name);

      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
      expect(await logsFor(tenantA, traceId)).toEqual([
        expect.objectContaining({
          status: 'FALLBACK',
          result_summary_json: expect.objectContaining({ reason: 'timeout' }),
        }),
      ]);
    });

    it('falls back when the provider errors, and logs no personal data', async () => {
      await setPlatformTierForTest('decision.import_row_match', 'AUTO');
      decide.mockRejectedValue(new Error('upstream 503'));
      const lastName = `Error-${randomUUID().slice(0, 8)}`;
      const existing = await seedCustomer(tenantA, lastName);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, lastName);

      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
      const logs = await logsFor(tenantA, traceId);
      expect(logs).toEqual([
        expect.objectContaining({
          status: 'FALLBACK',
          result_summary_json: expect.objectContaining({ reason: 'provider_error' }),
        }),
      ]);
      const persisted = JSON.stringify(logs);
      expect(persisted).not.toContain(lastName);
      expect(persisted).not.toContain(existing.email ?? '@example.org');
    });

    it('rejects a choice outside the allowed list and keeps the rules outcome', async () => {
      await setPlatformTierForTest('decision.import_row_match', 'AUTO');
      decide.mockResolvedValue(suggestion('choice_42'));
      const existing = await seedCustomer(tenantA, `Invalid-${randomUUID().slice(0, 8)}`);
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, existing.last_name);

      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
      expect(await logsFor(tenantA, traceId)).toEqual([
        expect.objectContaining({
          status: 'FALLBACK',
          result_summary_json: expect.objectContaining({ reason: 'invalid_choice' }),
        }),
      ]);
    });

    it('a tenant opt-out to shadow stays shadow even when the environment is live', async () => {
      await setPlatformTierForTest('decision.import_row_match', 'AUTO');
      await systemPrisma.tenant.update({
        where: { id: tenantB.tenantId },
        data: { decision_apply_mode: 'shadow' },
      });
      decide.mockResolvedValue(suggestion('choice_1'));
      const lastName = `Optout-${randomUUID().slice(0, 8)}`;
      await seedCustomer(tenantB, lastName);
      const traceId = randomUUID();

      const job = await runImport(authB, traceId, lastName);

      expect((await importRow(tenantB, job.id))?.action).toBe('CREATE');
      expect(decide).not.toHaveBeenCalled();
      expect(await logsFor(tenantB, traceId)).toHaveLength(0);
    });

    it('isolates tenants: the adopted customer belongs to the importing tenant, and the other tenant cannot approve it', async () => {
      await seedCustomer(tenantB, 'Gemeinsam');
      const sameName = await seedCustomer(tenantA, 'Gemeinsam');
      decide.mockResolvedValue(suggestion('choice_1'));
      const traceId = randomUUID();

      const job = await runImport(authA, traceId, 'Gemeinsam');
      expect((await importRow(tenantA, job.id))?.entity_id).toBeNull();
      const [proposal] = await proposalsFor(tenantA, traceId);
      expect(proposal.payload_json).toMatchObject({ customer_id: sameName.id });

      const listingB = await request(app.getHttpServer())
        .get('/agent-proposals')
        .set('Authorization', authB)
        .expect(200);
      expect(JSON.stringify(listingB.body)).not.toContain(proposal.id);

      await request(app.getHttpServer())
        .post(`/agent-proposals/${proposal.id}/approve`)
        .set('Authorization', authB)
        .expect(404);
      expect((await importRow(tenantA, job.id))?.action).toBe('CREATE');
    });
  });

  describe('document sort', () => {
    it('does not consult Jev when the heuristic already decided the type', async () => {
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Rechnung 2026-17');

      expect(decide).not.toHaveBeenCalled();
    });

    it('live + AUTO: sets the document type and logs the trace', async () => {
      await setPlatformTierForTest('decision.document_sort', 'AUTO');
      decide.mockResolvedValue(suggestion('Lieferschein'));
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Hallo Werkstatt');

      const reloaded = await createTenantAwarePrisma(prisma, tenantA.tenantId).documentBrandAsset.findFirst({
        where: { id: asset.id },
      });
      expect(reloaded?.document_sort_type).toBe('Lieferschein');
      const logs = await createTenantAwarePrisma(prisma, tenantA.tenantId).agentActionLog.findMany({
        where: { entity_id: asset.id, action_type: 'decision.document_sort' },
      });
      expect(logs).toEqual([
        expect.objectContaining({ tier: 'AUTO', status: 'EXECUTED', entity_type: 'DocumentBrandAsset' }),
      ]);
    });

    it('live + PROPOSE (platform default): leaves the asset alone and approves on request', async () => {
      decide.mockResolvedValue(suggestion('Kostenvoranschlag'));
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Hallo Werkstatt');

      const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      expect(
        (await tenantPrisma.documentBrandAsset.findFirst({ where: { id: asset.id } }))
          ?.document_sort_type,
      ).toBeNull();
      const proposal = await tenantPrisma.agentProposal.findFirst({
        where: {
          action_type: 'decision.document_sort',
          payload_json: { path: ['document_brand_asset_id'], equals: asset.id },
        },
      });
      expect(proposal).toMatchObject({
        status: 'PENDING',
        tier: 'PROPOSE',
        payload_json: { document_brand_asset_id: asset.id, document_sort_type: 'Kostenvoranschlag' },
      });

      await request(app.getHttpServer())
        .post(`/agent-proposals/${proposal?.id}/approve`)
        .set('Authorization', authA)
        .expect((response) => expect([200, 201]).toContain(response.status));

      expect(
        (await tenantPrisma.documentBrandAsset.findFirst({ where: { id: asset.id } }))
          ?.document_sort_type,
      ).toBe('Kostenvoranschlag');
    });

    it('live + HUMAN_ONLY: never applies or proposes', async () => {
      await setTenantTier(tenantA, 'decision.document_sort', 'HUMAN_ONLY');
      decide.mockResolvedValue(suggestion('Fahrzeugschein'));
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Hallo Werkstatt');

      const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      expect(
        (await tenantPrisma.documentBrandAsset.findFirst({ where: { id: asset.id } }))
          ?.document_sort_type,
      ).toBeNull();
      expect(
        await tenantPrisma.agentProposal.count({
          where: {
            action_type: 'decision.document_sort',
            payload_json: { path: ['document_brand_asset_id'], equals: asset.id },
          },
        }),
      ).toBe(0);
      const logs = await tenantPrisma.agentActionLog.findMany({
        where: { entity_id: asset.id },
      });
      expect(logs).toEqual([expect.objectContaining({ status: 'REFUSED', tier: 'HUMAN_ONLY' })]);
    });

    it('falls back on timeout and keeps the heuristic outcome', async () => {
      process.env.DECISION_HTTP_TIMEOUT_MS = '50';
      await setPlatformTierForTest('decision.document_sort', 'AUTO');
      decide.mockImplementation(() => new Promise<never>(() => undefined));
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Hallo Werkstatt');

      const tenantPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
      expect(
        (await tenantPrisma.documentBrandAsset.findFirst({ where: { id: asset.id } }))
          ?.document_sort_type,
      ).toBeNull();
      expect(
        await tenantPrisma.agentActionLog.findFirst({ where: { entity_id: asset.id } }),
      ).toMatchObject({
        status: 'FALLBACK',
        result_summary_json: expect.objectContaining({ reason: 'timeout' }),
      });
    });

    it('rejects a type outside the allowed list', async () => {
      await setPlatformTierForTest('decision.document_sort', 'AUTO');
      decide.mockResolvedValue(suggestion('Mietvertrag'));
      const asset = await createReadyAsset(tenantA);

      await decideDocument(tenantA, asset.id, 'Hallo Werkstatt');

      expect(
        (await createTenantAwarePrisma(prisma, tenantA.tenantId).documentBrandAsset.findFirst({
          where: { id: asset.id },
        }))?.document_sort_type,
      ).toBeNull();
    });
  });
});
