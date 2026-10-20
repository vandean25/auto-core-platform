import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import {
  SYNTHETIC_INSPECTOR_EVIDENCE_DOCUMENT_REF,
  SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD,
  SYNTHETIC_STATION_REF,
} from '../src/inspector-evidence/inspection-evidence-synthetic-fixtures.js';

describe('Inspector evidence (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let employeeId: string;

  const documentDigest = createHash('sha256')
    .update('synthetic-document-bytes', 'utf8')
    .digest('hex');

  beforeAll(async () => {
    app = await createE2eApp();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'inspector-evidence');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    token = createTestAuthToken(app.get(AuthService), testTenant);

    await runWithTenantContext(tenantId, async () => {
      const employee = await prisma.employee.create({
        data: {
          tenant_id: tenantId,
          name: 'SYNTH Inspector',
          role: 'MECHANIC',
          is_active: true,
        },
      });
      employeeId = employee.id;
    });
  });

  afterAll(async () => {
    await runWithTenantContext(tenantId, async () => {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    });
    await teardownTestApp(app);
  });

  it('creates UNREVIEWED evidence, reviews with exact digest, and assesses support', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/employees/${employeeId}/inspection-evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD,
        document_digest: documentDigest,
      })
      .expect(201);

    expect(create.body.evidence_review).toBe('UNREVIEWED');

    const review = await request(app.getHttpServer())
      .post(`/api/employees/${employeeId}/inspection-evidence/${create.body.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_digest: documentDigest,
        version: create.body.version,
        decision: 'ACCEPT',
        review_valid_until: '2026-11-15T09:00:00Z',
      })
      .expect(200);

    expect(review.body.evidence_review).toBe('EVIDENCE_REVIEWED');

    const assessment = await request(app.getHttpServer())
      .get(`/api/employees/${employeeId}/inspection-evidence/assessment`)
      .query({
        station_ref: SYNTHETIC_STATION_REF,
        vehicle_class: 'M1',
        inspection_time: '2026-10-16T10:00:00Z',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(assessment.body.evidence_review).toBe('EVIDENCE_REVIEWED');
    expect(assessment.body.inspection_time_temporal_scope).toBe('CURRENT');
    expect(assessment.body.registry_adapter).toBe('NOT_CONFIGURED');
    expect(assessment.body.qualification_support_status).toBe(
      'QUALIFICATION_CURRENT',
    );
  });

  it('rejects invalid assessment timestamps', async () => {
    await request(app.getHttpServer())
      .get(`/api/employees/${employeeId}/inspection-evidence/assessment`)
      .query({
        station_ref: SYNTHETIC_STATION_REF,
        inspection_time: 'not-a-date',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('rejects review when digest does not match', async () => {
    const create = await request(app.getHttpServer())
      .post(`/api/employees/${employeeId}/inspection-evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD,
        document_ref: `${SYNTHETIC_INSPECTOR_EVIDENCE_DOCUMENT_REF}-2`,
        document_digest: documentDigest,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/employees/${employeeId}/inspection-evidence/${create.body.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        document_digest: 'b'.repeat(64),
        version: create.body.version,
        decision: 'ACCEPT',
        review_valid_until: '2026-11-15T09:00:00Z',
      })
      .expect(409);
  });
});
