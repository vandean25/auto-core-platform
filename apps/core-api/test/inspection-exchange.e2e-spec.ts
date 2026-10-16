import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AppModule } from '../src/app.module.js';
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
import { createHash } from 'node:crypto';
import {
  registerSyntheticCanonicalResult,
  SYNTHETIC_CANONICAL_NEGATIVE,
  SYNTHETIC_CANONICAL_POSITIVE,
  SYNTHETIC_CANONICAL_POSITIVE_NO_PLATE,
} from '../src/inspection-exchange/inspection-exchange-synthetic-fixtures.js';

describe('Inspection exchange (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let siteId: string;
  let legalEntityId: string;
  let vehicleId: string;
  let connectionId: string;

  function previewResult(reference = 'SYNTH-RESULT-001') {
    return request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: reference,
      });
  }

  function applyImport(previewBody: {
    id: string;
    fingerprint: string;
    version: number;
  }) {
    return request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicleId}/inspection-imports/${previewBody.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: previewBody.fingerprint,
        version: previewBody.version,
      });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'inspection-exchange');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    token = createTestAuthToken(app.get(AuthService), testTenant);

    await runWithTenantContext(tenantId, async () => {
      const user = await prisma.user.findFirst({
        where: { firebaseUid: testTenant.firebaseUid },
      });
      const site = await prisma.site.findFirst({ where: { tenant_id: tenantId } });
      if (!user || !site) {
        throw new Error('missing site or user');
      }
      siteId = site.id;
      legalEntityId = site.legal_entity_id;

      const vehicle = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: 'WVWZZZ1JZXW000001',
          plate: 'SYNTH-001',
          first_registration_date: new Date('2020-10-01T00:00:00.000Z'),
        },
      });
      vehicleId = vehicle.id;

      const connection = await prisma.inspectionSourceConnection.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          legal_entity_id: legalEntityId,
          source_system: 'EBV',
          source_account_ref: 'SYNTH-ACCOUNT-001',
          source_station_id: 'SYNTH-STATION-001',
          profile_id: 'TEST_ONLY',
          profile_version: 'TEST_ONLY/1',
          profile_digest: createHash('sha256').update('TEST_ONLY').digest('hex'),
          read_enabled: true,
          is_active: true,
        },
      });
      connectionId = connection.id;
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });

  it('previews and applies a synthetic positive result once', async () => {
    const preview = await previewResult().expect(201);

    expect(preview.body.state).toBe('READY_FOR_REVIEW');
    expect(preview.body.fingerprint).toHaveLength(64);

    const apply = await applyImport(preview.body).expect(200);

    expect(apply.body.result.outcome).toBe('POSITIVE');
    expect(apply.body.replay).toBe(false);

    const records = await prisma.vehicleInspectionRecord.findMany({
      where: { vehicle_id: vehicleId, source: 'EBV_IMPORTED' },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.plaketten_valid_until_year).toBe(2027);
    expect(records[0]?.plaketten_valid_until_month).toBe(10);

    const detail = await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.pickerl_due.last_inspected_on).toBe('2026-10-15');
  });

  it('rejects wrong station on preview', async () => {
    const otherConnection = await prisma.inspectionSourceConnection.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        legal_entity_id: legalEntityId,
        source_system: 'EBV',
        source_account_ref: 'SYNTH-ACCOUNT-999',
        source_station_id: 'SYNTH-STATION-999',
        profile_id: 'TEST_ONLY',
        profile_version: 'TEST_ONLY/1',
        profile_digest: createHash('sha256').update('TEST_ONLY_999').digest('hex'),
        read_enabled: true,
        is_active: true,
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: otherConnection.id,
        native_result_reference: 'SYNTH-RESULT-001',
      })
      .expect(422);
    expect(response.body.code).toBe('STATION_MISMATCH');
  });

  it('replays identical apply with 200 and a single external row', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Polo',
        year: 2019,
        vin: 'WVWZZZ1JZXW000099',
        plate: 'SYNTH-099',
        first_registration_date: new Date('2019-05-01T00:00:00.000Z'),
      },
    });
    registerSyntheticCanonicalResult('SYNTH-RESULT-REPLAY', {
      ...SYNTHETIC_CANONICAL_POSITIVE,
      source_result_id: 'SYNTH-RESULT-REPLAY',
      source_revision: 'SYNTH-REV-REPLAY',
      zbd_report_id: 'SYNTH-ZBD-REPLAY',
      vehicle: {
        vin: 'WVWZZZ1JZXW000099',
        first_registration_on: '2019-05-01',
        registration_plate: 'SYNTH-099',
      },
      occurrence_relation: {
        ...SYNTHETIC_CANONICAL_POSITIVE.occurrence_relation,
        classification_evidence_ref: 'SYNTH-REPLAY-001',
      },
    });

    const preview = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-REPLAY',
      })
      .expect(201);

    const first = await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicle.id}/inspection-imports/${preview.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: preview.body.fingerprint,
        version: preview.body.version,
      })
      .expect(200);

    const secondPreview = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-REPLAY',
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicle.id}/inspection-imports/${secondPreview.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: secondPreview.body.fingerprint,
        version: secondPreview.body.version,
      })
      .expect(200);

    expect(first.body.replay).toBe(false);
    expect(second.body.replay).toBe(true);
    const externalCount = await prisma.externalInspectionResult.count({
      where: { vehicle_id: vehicle.id },
    });
    expect(externalCount).toBe(1);
  });

  it('persists CONFLICT on second apply after digest race', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Passat',
        year: 2018,
        vin: 'WVWZZZ1JZXW000088',
        plate: 'SYNTH-088',
        first_registration_date: new Date('2018-03-01T00:00:00.000Z'),
      },
    });
    registerSyntheticCanonicalResult('SYNTH-RESULT-RACE', {
      ...SYNTHETIC_CANONICAL_POSITIVE,
      source_result_id: 'SYNTH-RESULT-RACE',
      source_revision: 'SYNTH-REV-RACE',
      zbd_report_id: 'SYNTH-ZBD-RACE',
      vehicle: {
        vin: 'WVWZZZ1JZXW000088',
        first_registration_on: '2018-03-01',
        registration_plate: 'SYNTH-088',
      },
      occurrence_relation: {
        ...SYNTHETIC_CANONICAL_POSITIVE.occurrence_relation,
        classification_evidence_ref: 'SYNTH-RACE-001',
      },
    });

    const previewA = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-RACE',
      })
      .expect(201);
    const previewB = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-RACE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicle.id}/inspection-imports/${previewA.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: previewA.body.fingerprint,
        version: previewA.body.version,
      })
      .expect(200);

    const applied = await prisma.externalInspectionResult.findFirst({
      where: { vehicle_id: vehicle.id, source_result_id: 'SYNTH-RESULT-RACE' },
    });
    if (!applied) {
      throw new Error('expected external result');
    }
    await prisma.externalInspectionResult.update({
      where: { tenant_id: tenantId, id: applied.id },
      data: { semantic_digest: '0'.repeat(64) },
    });

    const conflictApply = await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicle.id}/inspection-imports/${previewB.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: previewB.body.fingerprint,
        version: previewB.body.version,
      })
      .expect(409);

    expect(conflictApply.body.code).toBe('EXTERNAL_RESULT_CONFLICT');
    const importRow = await prisma.inspectionExchangeImport.findFirst({
      where: { id: previewB.body.id, tenant_id: tenantId },
    });
    expect(importRow?.state).toBe('CONFLICT');
  });

  it('returns 404 for foreign tenant vehicle access', async () => {
    const otherTenant = await createTestTenant(basePrisma, 'inspection-exchange-b');
    const otherToken = createTestAuthToken(app.get(AuthService), otherTenant);

    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-001',
      })
      .expect(404);

    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId).catch(() => undefined);
  });

  it('denies preview for TECH tenant role', async () => {
    const techFirebaseUid = `e2e-inspection-tech-${Date.now()}`;
    let techUserEmail = '';
    await runWithTenantContext(tenantId, async () => {
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: `tech-${Date.now()}@example.test`,
        },
      });
      techUserEmail = techUser.email;
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      await prisma.siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: techUser.id,
          site_id: siteId,
          is_active: true,
        },
      });
      await prisma.user.update({
        where: { id: techUser.id },
        data: { active_site_id: siteId },
      });
    });
    const techToken = createTestAuthToken(app.get(AuthService), {
      tenantId,
      firebaseUid: techFirebaseUid,
      email: techUserEmail,
      role: 'TECH',
    });

    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-001',
      })
      .expect(403);
  });

  it('blocks PATCH on EBV_IMPORTED inspection records', async () => {
    const record = await prisma.vehicleInspectionRecord.findFirst({
      where: { vehicle_id: vehicleId, source: 'EBV_IMPORTED' },
    });
    if (!record) {
      return;
    }

    await request(app.getHttpServer())
      .patch(
        `/api/vehicles/${vehicleId}/inspection-records/${record.id}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'should-not-stick' })
      .expect(403);
  });

  it('marks POSITIVE without plate as UNCONFIRMED and rejects apply', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Up',
        year: 2021,
        vin: 'WVWZZZ1JZXW000077',
        plate: 'SYNTH-077',
        first_registration_date: new Date('2021-01-01T00:00:00.000Z'),
      },
    });
    registerSyntheticCanonicalResult('SYNTH-RESULT-NO-PLATE', {
      ...SYNTHETIC_CANONICAL_POSITIVE_NO_PLATE,
      vehicle: {
        vin: 'WVWZZZ1JZXW000077',
        first_registration_on: '2021-01-01',
        registration_plate: 'SYNTH-077',
      },
    });

    const preview = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-NO-PLATE',
      })
      .expect(201);

    expect(preview.body.state).toBe('UNCONFIRMED');

    await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicle.id}/inspection-imports/${preview.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: preview.body.fingerprint,
        version: preview.body.version,
      })
      .expect(422);
  });

  it('surfaces negative-result barrier on pickerl due list', async () => {
    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Tiguan',
        year: 2017,
        vin: 'WVWZZZ1JZXW000066',
        plate: 'SYNTH-066',
        first_registration_date: new Date('2017-06-01T00:00:00.000Z'),
      },
    });
    await prisma.vehicleInspectionRecord.create({
      data: {
        tenant_id: tenantId,
        vehicle_id: vehicle.id,
        inspection_type: 'PICKERL_57A',
        inspected_on: new Date('2025-10-01T00:00:00.000Z'),
        plaketten_valid_until_year: 2026,
        plaketten_valid_until_month: 10,
        source: 'MANUAL',
      },
    });
    registerSyntheticCanonicalResult('SYNTH-RESULT-NEGATIVE', {
      ...SYNTHETIC_CANONICAL_NEGATIVE,
      vehicle: {
        vin: 'WVWZZZ1JZXW000066',
        first_registration_on: '2017-06-01',
        registration_plate: 'SYNTH-066',
      },
    });

    const preview = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-NEGATIVE',
      })
      .expect(201);
    expect(preview.body.state).toBe('READY_FOR_REVIEW');
    await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicle.id}/inspection-imports/${preview.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: preview.body.fingerprint,
        version: preview.body.version,
      })
      .expect(200);

    const due = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=90&page=1&pageSize=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = due.body.data.find((entry: { id: string }) => entry.id === vehicle.id);
    expect(row?.pickerl_due?.status).toBe('UNKNOWN');
    expect(
      row?.pickerl_due?.warnings?.some(
        (warning: { code: string }) =>
          warning.code === 'EXTERNAL_RESULT_REQUIRES_REVIEW',
      ),
    ).toBe(true);
  });

  it('persists CONFLICT when ZBD report identity belongs to another vehicle', async () => {
    const otherVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Touran',
        year: 2016,
        vin: 'WVWZZZ1JZXW000055',
        plate: 'SYNTH-055',
        first_registration_date: new Date('2016-04-01T00:00:00.000Z'),
      },
    });
    registerSyntheticCanonicalResult('SYNTH-RESULT-ZBD-OTHER', {
      ...SYNTHETIC_CANONICAL_POSITIVE,
      source_result_id: 'SYNTH-RESULT-ZBD-OTHER',
      source_revision: 'SYNTH-REV-ZBD-OTHER',
      zbd_report_id: 'SYNTH-ZBD-001',
      vehicle: {
        vin: 'WVWZZZ1JZXW000055',
        first_registration_on: '2016-04-01',
        registration_plate: 'SYNTH-055',
      },
      occurrence_relation: {
        ...SYNTHETIC_CANONICAL_POSITIVE.occurrence_relation,
        classification_evidence_ref: 'SYNTH-ZBD-OTHER-001',
      },
    });

    const preview = await request(app.getHttpServer())
      .post(`/api/vehicles/${otherVehicle.id}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-ZBD-OTHER',
      })
      .expect(201);

    expect(preview.body.state).toBe('READY_FOR_REVIEW');

    await request(app.getHttpServer())
      .post(
        `/api/vehicles/${otherVehicle.id}/inspection-imports/${preview.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: preview.body.fingerprint,
        version: preview.body.version,
      })
      .expect(409);

    const importRow = await prisma.inspectionExchangeImport.findFirst({
      where: { id: preview.body.id, tenant_id: tenantId },
    });
    expect(importRow?.state).toBe('CONFLICT');

    const due = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=90&page=1&pageSize=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const row = due.body.data.find(
      (entry: { id: string }) => entry.id === otherVehicle.id,
    );
    expect(row?.pickerl_due?.status).toBe('UNKNOWN');
  });
});
