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
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { createHash } from 'node:crypto';

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
    const preview = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: connectionId,
        native_result_reference: 'SYNTH-RESULT-001',
      })
      .expect(201);

    expect(preview.body.state).toBe('READY_FOR_REVIEW');
    expect(preview.body.fingerprint).toHaveLength(64);

    const apply = await request(app.getHttpServer())
      .post(
        `/api/vehicles/${vehicleId}/inspection-imports/${preview.body.id}/apply`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        fingerprint: preview.body.fingerprint,
        version: preview.body.version,
      })
      .expect(200);

    expect(apply.body.result.outcome).toBe('POSITIVE');

    const records = await prisma.vehicleInspectionRecord.findMany({
      where: { vehicle_id: vehicleId, source: 'EBV_IMPORTED' },
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.plaketten_valid_until_year).toBe(2027);
    expect(records[0]?.plaketten_valid_until_month).toBe(10);

    const manualCount = await prisma.vehicleInspectionRecord.count({
      where: { vehicle_id: vehicleId, source: 'MANUAL' },
    });
    expect(manualCount).toBe(0);

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

    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        connection_id: otherConnection.id,
        native_result_reference: 'SYNTH-RESULT-001',
      })
      .expect(422);
  });
});
