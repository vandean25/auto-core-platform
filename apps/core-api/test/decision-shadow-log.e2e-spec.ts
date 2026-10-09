import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { DECISION_PROVIDER_TOKEN } from '../src/decision/decision.constants.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const TRACE_IDS = {
  importMatch: '00000000-0000-4000-8000-00000000f001',
  documentSort: '00000000-0000-4000-8000-00000000f002',
  providerDown: '00000000-0000-4000-8000-00000000f003',
};

describe('Decision shadow log read API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  const decide = jest.fn();

  let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
  let tenantC: Awaited<ReturnType<typeof createTestTenant>>;
  let adminHeaderA: string;
  let adminHeaderB: string;
  let adminHeaderC: string;
  let techHeaderA: string;
  let tenantAUserId: string;

  let importMatchRowId: string;
  let documentSortRowId: string;
  let providerDownRowId: string;

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
    authService = app.get(AuthService);

    tenantA = await createTestTenant(prisma, 'decision-shadow-log-a');
    tenantB = await createTestTenant(prisma, 'decision-shadow-log-b');
    tenantC = await createTestTenant(prisma, 'decision-shadow-log-c');

    const tenantAUser = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenantA.firebaseUid },
      select: { id: true },
    });
    tenantAUserId = tenantAUser.id;

    adminHeaderA = `Bearer ${createTestAuthToken(authService, tenantA, { role: 'ADMIN' })}`;
    adminHeaderB = `Bearer ${createTestAuthToken(authService, tenantB, { role: 'ADMIN' })}`;
    adminHeaderC = `Bearer ${createTestAuthToken(authService, tenantC, { role: 'ADMIN' })}`;
    techHeaderA = `Bearer ${createTestAuthToken(authService, tenantA, { role: 'TECH' })}`;

    // Made-up rows written straight to the table so filter results are deterministic.
    const tenantAPrisma = createTenantAwarePrisma(prisma, tenantA.tenantId);
    const importMatch = await tenantAPrisma.decisionShadowLog.create({
      data: {
        tenant_id: tenantA.tenantId,
        trace_id: TRACE_IDS.importMatch,
        use_case: 'import_row_matching',
        input_hash: 'hash-import-match',
        input_redacted_json: { row: { type: 'PRIVATE' } },
        suggestion_json: {
          choice: 'choice_1',
          confidence: 0.8,
          rationale: 'Made-up name and email similarity',
          raw_ref: 'resp-made-up-1',
          latency_ms: 120,
          provider: 'openrouter-jev',
          model: 'typesafe/jev-1.13',
        },
        actual_outcome_json: { choice: 'choice_1', source: 'import_dry_run' },
        match: true,
        provider: 'openrouter-jev',
        model: 'typesafe/jev-1.13',
        latency_ms: 120,
        error: null,
        created_at: new Date('2026-09-15T08:00:00.000Z'),
      },
    });
    importMatchRowId = importMatch.id;

    const documentSort = await tenantAPrisma.decisionShadowLog.create({
      data: {
        tenant_id: tenantA.tenantId,
        trace_id: TRACE_IDS.documentSort,
        use_case: 'document_sort',
        input_hash: 'hash-document-sort',
        input_redacted_json: { signals: ['invoice-keyword'] },
        suggestion_json: {
          choice: 'Lieferschein',
          confidence: 0.6,
          rationale: 'Made-up delivery note keywords',
          raw_ref: 'resp-made-up-2',
          latency_ms: 95,
          provider: 'openrouter-jev',
          model: 'typesafe/jev-1.13',
        },
        actual_outcome_json: {
          choice: 'Rechnung',
          source: 'heuristic_classifier',
        },
        match: false,
        provider: 'openrouter-jev',
        model: 'typesafe/jev-1.13',
        latency_ms: 95,
        error: null,
        created_at: new Date('2026-10-02T09:30:00.000Z'),
      },
    });
    documentSortRowId = documentSort.id;

    const providerDown = await tenantAPrisma.decisionShadowLog.create({
      data: {
        tenant_id: tenantA.tenantId,
        trace_id: TRACE_IDS.providerDown,
        use_case: 'document_sort',
        input_hash: 'hash-provider-down',
        input_redacted_json: { signals: [] },
        suggestion_json: Prisma.JsonNull,
        actual_outcome_json: {
          choice: 'Sonstiges',
          source: 'heuristic_classifier',
        },
        match: null,
        provider: 'openrouter-jev',
        model: null,
        latency_ms: null,
        error: 'provider down',
        created_at: new Date('2026-10-04T16:00:00.000Z'),
      },
    });
    providerDownRowId = providerDown.id;
  });

  afterAll(async () => {
    delete process.env.DECISION_SHADOW_ENABLED;
    await cleanupTestTenantGraph(prisma, tenantA.tenantId);
    await cleanupTestTenantGraph(prisma, tenantB.tenantId);
    await cleanupTestTenantGraph(prisma, tenantC.tenantId);
    await teardownTestApp(app, prisma);
  });

  beforeEach(() => {
    decide.mockReset();
    delete process.env.DECISION_SHADOW_ENABLED;
  });

  function customerCsv(rows: string[][]) {
    const headers = ['Kunden-Nr', 'Typ', 'Vorname', 'Nachname', 'E-Mail'];
    return Buffer.from(serializeCsv(headers, rows, ';'), 'utf8');
  }

  function countShadowRows(tenantId: string): Promise<number> {
    return createTenantAwarePrisma(prisma, tenantId).decisionShadowLog.count({
      where: { tenant_id: tenantId },
    });
  }

  // Shadow writes are fire-and-forget, so poll until the expected row lands.
  async function waitForShadowRowCount(tenantId: string, expected: number) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await countShadowRows(tenantId)) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Expected ${expected} shadow rows for tenant`);
  }

  it('returns an empty page for a tenant without shadow rows', async () => {
    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .set('Authorization', adminHeaderB)
      .expect(200);

    expect(res.body).toEqual({ data: [], nextCursor: null });
  });

  it('lists tenant rows newest first with only the read-API fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .set('Authorization', adminHeaderA)
      .expect(200);

    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([
      providerDownRowId,
      documentSortRowId,
      importMatchRowId,
    ]);
    expect(res.body.nextCursor).toBeNull();

    const documentSort = res.body.data[1];
    expect(documentSort).toEqual({
      id: documentSortRowId,
      traceId: TRACE_IDS.documentSort,
      useCase: 'document_sort',
      suggestion: {
        choice: 'Lieferschein',
        confidence: 0.6,
        rationale: 'Made-up delivery note keywords',
      },
      actualOutcome: { choice: 'Rechnung', source: 'heuristic_classifier' },
      latencyMs: 95,
      error: null,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
      match: false,
      createdAt: '2026-10-02T09:30:00.000Z',
    });
    expect(Object.keys(documentSort).sort()).toEqual(
      [
        'actualOutcome',
        'createdAt',
        'error',
        'id',
        'latencyMs',
        'match',
        'model',
        'provider',
        'suggestion',
        'traceId',
        'useCase',
      ].sort(),
    );
  });

  it('returns a null suggestion, latency and model with the provider error on failure', async () => {
    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ useCase: 'document_sort', endDate: '2026-10-05' })
      .set('Authorization', adminHeaderA)
      .expect(200);

    const failed = res.body.data.find(
      (row: { id: string }) => row.id === providerDownRowId,
    );
    expect(failed).toMatchObject({
      suggestion: null,
      latencyMs: null,
      model: null,
      match: null,
      error: 'provider down',
    });
  });

  it('filters by use case', async () => {
    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ useCase: 'import_row_matching' })
      .set('Authorization', adminHeaderA)
      .expect(200);

    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([
      importMatchRowId,
    ]);
  });

  it('rejects unknown use case values', async () => {
    await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ useCase: 'apply_suggestion' })
      .set('Authorization', adminHeaderA)
      .expect(400);
  });

  it('filters by created_at range with an inclusive end day', async () => {
    const window = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-02' })
      .set('Authorization', adminHeaderA)
      .expect(200);
    expect(window.body.data.map((row: { id: string }) => row.id)).toEqual([
      documentSortRowId,
    ]);

    const fromLaterDay = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ startDate: '2026-10-03' })
      .set('Authorization', adminHeaderA)
      .expect(200);
    expect(fromLaterDay.body.data.map((row: { id: string }) => row.id)).toEqual(
      [providerDownRowId],
    );
  });

  it('rejects an inverted date range', async () => {
    await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ startDate: '2026-10-05', endDate: '2026-10-01' })
      .set('Authorization', adminHeaderA)
      .expect(400);
  });

  it('pages with an opaque cursor without skipping or repeating rows', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 3; page += 1) {
      const res = await request(app.getHttpServer())
        .get('/decision-shadow-logs')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .set('Authorization', adminHeaderA)
        .expect(200);

      seen.push(...res.body.data.map((row: { id: string }) => row.id));
      cursor = res.body.nextCursor ?? undefined;
    }

    expect(seen).toEqual([
      providerDownRowId,
      documentSortRowId,
      importMatchRowId,
    ]);
    expect(cursor).toBeUndefined();

    await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ cursor: 'not-a-cursor' })
      .set('Authorization', adminHeaderA)
      .expect(400);
  });

  it('isolates shadow rows across tenants', async () => {
    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .set('Authorization', adminHeaderB)
      .expect(200);

    const ids = res.body.data.map((row: { id: string }) => row.id);
    expect(ids).not.toContain(importMatchRowId);
    expect(ids).not.toContain(documentSortRowId);
    expect(ids).not.toContain(providerDownRowId);
    expect(ids).toEqual([]);
  });

  it('denies TECH members and unauthenticated callers', async () => {
    await runWithTenantContext(tenantA.tenantId, async () => {
      await prisma.tenantMember.update({
        where: {
          tenant_id_user_id: {
            tenant_id: tenantA.tenantId,
            user_id: tenantAUserId,
          },
        },
        data: { role: 'TECH' },
      });
    });

    try {
      await request(app.getHttpServer())
        .get('/decision-shadow-logs')
        .set('Authorization', techHeaderA)
        .expect(403);
    } finally {
      await runWithTenantContext(tenantA.tenantId, async () => {
        await prisma.tenantMember.update({
          where: {
            tenant_id_user_id: {
              tenant_id: tenantA.tenantId,
              user_id: tenantAUserId,
            },
          },
          data: { role: 'ADMIN' },
        });
      });
    }

    await request(app.getHttpServer()).get('/decision-shadow-logs').expect(401);
  });

  it('exposes no write endpoints and leaves stored rows untouched', async () => {
    const before = await countShadowRows(tenantA.tenantId);

    await request(app.getHttpServer())
      .post('/decision-shadow-logs')
      .set('Authorization', adminHeaderA)
      .send({ suggestion: { choice: 'apply' } })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/decision-shadow-logs/${documentSortRowId}`)
      .set('Authorization', adminHeaderA)
      .send({ match: true })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/decision-shadow-logs/${documentSortRowId}`)
      .set('Authorization', adminHeaderA)
      .expect(404);

    const after = await countShadowRows(tenantA.tenantId);
    expect(after).toBe(before);
  });

  it('shows the row written by a real shadow run after an import', async () => {
    process.env.DECISION_SHADOW_ENABLED = 'true';
    decide.mockResolvedValue({
      choice: 'choice_1',
      confidence: 0.77,
      rationale: 'Made-up match on synthetic name',
      raw_ref: 'resp-made-up-3',
      latency_ms: 88,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    });

    const rowsBeforeImport = await countShadowRows(tenantC.tenantId);
    await createTenantAwarePrisma(prisma, tenantC.tenantId).customer.create({
      data: {
        tenant_id: tenantC.tenantId,
        first_name: 'Erika',
        last_name: 'Mustermann',
        email: 'existing-erika@example.org',
      },
    });

    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeaderC)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field(
        'mapping',
        JSON.stringify({
          external_id: 'Kunden-Nr',
          type: 'Typ',
          first_name: 'Vorname',
          last_name: 'Nachname',
          email: 'E-Mail',
        }),
      )
      .attach(
        'file',
        customerCsv([
          ['9301', 'PRIVATE', 'Erika', 'Mustermann', 'erika@example.org'],
        ]),
        'customers.csv',
      )
      .expect(201);

    await waitForShadowRowCount(tenantC.tenantId, rowsBeforeImport + 1);

    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ useCase: 'import_row_matching' })
      .set('Authorization', adminHeaderC)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toMatchObject({
      useCase: 'import_row_matching',
      suggestion: {
        choice: 'choice_1',
        confidence: 0.77,
      },
      latencyMs: 88,
      error: null,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    });
    expect(res.body.data[0].match).toBe(
      res.body.data[0].actualOutcome.choice === 'choice_1',
    );
    expect(decide).toHaveBeenCalled();
  });

  it('shows provider failures from a real shadow run as error text', async () => {
    process.env.DECISION_SHADOW_ENABLED = 'true';
    decide.mockRejectedValue(new Error('provider down'));

    const rowsBeforeFailure = await countShadowRows(tenantC.tenantId);
    await createTenantAwarePrisma(prisma, tenantC.tenantId).customer.create({
      data: {
        tenant_id: tenantC.tenantId,
        first_name: 'Max',
        last_name: 'Beispiel',
        email: 'existing-max@example.org',
      },
    });

    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', adminHeaderC)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field(
        'mapping',
        JSON.stringify({
          external_id: 'Kunden-Nr',
          type: 'Typ',
          first_name: 'Vorname',
          last_name: 'Nachname',
          email: 'E-Mail',
        }),
      )
      .attach(
        'file',
        customerCsv([
          ['9302', 'PRIVATE', 'Max', 'Beispiel', 'max@example.org'],
        ]),
        'customers.csv',
      )
      .expect(201);

    await waitForShadowRowCount(tenantC.tenantId, rowsBeforeFailure + 1);

    const res = await request(app.getHttpServer())
      .get('/decision-shadow-logs')
      .query({ useCase: 'import_row_matching' })
      .set('Authorization', adminHeaderC)
      .expect(200);

    const failed = res.body.data.find(
      (row: { error: string | null }) => row.error === 'provider down',
    );
    expect(failed).toMatchObject({
      suggestion: null,
      latencyMs: null,
      match: null,
      error: 'provider down',
    });
  });
});
