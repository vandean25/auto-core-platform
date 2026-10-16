import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
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
import {
  registerSyntheticMeasurement,
  SYNTHETIC_BRAKE_MEASUREMENT,
} from '../src/inspection-measurement/inspection-measurement-synthetic-fixtures.js';

describe('Inspection measurement (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let token: string;
  let siteId: string;
  let orderId: string;
  let deviceSourceId: string;
  const orderNumber = `SYNTH-ORDER-${Date.now()}`;

  function preview(reference = 'SYNTH-NATIVE-RESULT-1') {
    return request(app.getHttpServer())
      .post(`/api/workshop-orders/${orderId}/measurements/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        device_source_id: deviceSourceId,
        native_measurement_reference: reference,
      });
  }

  function applyImport(previewBody: {
    id: string;
    fingerprint: string;
    version: number;
  }) {
    return request(app.getHttpServer())
      .post(
        `/api/workshop-orders/${orderId}/measurements/${previewBody.id}/apply`,
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
    const testTenant = await createTestTenant(basePrisma, 'inspection-measurement');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    token = createTestAuthToken(app.get(AuthService), testTenant);

    await runWithTenantContext(tenantId, async () => {
      const site = await prisma.site.findFirst({ where: { tenant_id: tenantId } });
      if (!site) {
        throw new Error('missing site');
      }
      siteId = site.id;

      const customer = await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          type: 'PRIVATE',
          first_name: 'SYNTH',
          last_name: 'MEASUREMENT',
        },
      });

      const vehicle = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          vin: 'WVWZZZ1JZXW000001',
          plate: 'SYNTH-M-001',
          first_registration_date: new Date('2020-10-01T00:00:00.000Z'),
        },
      });

      const order = await prisma.workshopOrder.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          order_number: orderNumber,
          status: 'IN_PROGRESS',
          vehicle_id: vehicle.id,
          customer_id: customer.id,
          odometer: 1000,
          fuel_level: 50,
        },
      });
      orderId = order.id;

      const profileDigest = createHash('sha256').update('TEST_ONLY').digest('hex');
      const deviceSource = await prisma.inspectionDeviceSource.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          source_system: 'WORKSHOP_NET',
          source_instance_id: 'SYNTH-NETWORK-1',
          device_serial: 'SYNTH-BRAKE-SERIAL-1',
          device_model: 'SYNTH-BRAKE-MODEL',
          profile_id: 'TEST_ONLY',
          profile_version: 'TEST_ONLY/1',
          profile_digest: profileDigest,
          binding_revision: 1,
          range_min: '0',
          range_max: '10',
          range_unit: 'kN',
          read_enabled: true,
          is_active: true,
        },
      });
      deviceSourceId = deviceSource.id;

      await prisma.inspectionDeviceEvidence.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
          device_source_id: deviceSourceId,
          evidence_ref: 'SYNTH-DEVICE-EVIDENCE-1',
          evidence_revision: 1,
          effective_from: new Date('2026-01-01T00:00:00.000Z'),
          effective_until_exclusive: new Date('2027-01-01T00:00:00.000Z'),
          applicability_reviewed: true,
        },
      });

      registerSyntheticMeasurement('SYNTH-NATIVE-RESULT-1', {
        ...SYNTHETIC_BRAKE_MEASUREMENT,
        workshop_order_ref: orderNumber,
      });
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });

  it('previews and applies a synthetic brake measurement once', async () => {
    const previewRes = await preview().expect(201);
    expect(previewRes.body.state).toBe('READY_FOR_REVIEW');
    expect(previewRes.body.fingerprint).toHaveLength(64);

    const applyRes = await applyImport(previewRes.body).expect(200);
    expect(applyRes.body.replay).toBe(false);
    expect(applyRes.body.measurement.wheels).toHaveLength(4);

    const measurements = await prisma.inspectionMeasurement.findMany({
      where: { workshop_order_id: orderId },
    });
    expect(measurements).toHaveLength(1);
  });

  it('rejects wrong vehicle vin with 422', async () => {
    registerSyntheticMeasurement('SYNTH-WRONG-VIN', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      workshop_order_ref: orderNumber,
      vehicle_vin: 'WVWZZZ1JZXW000002',
    });
    const res = await preview('SYNTH-WRONG-VIN').expect(422);
    expect(res.body.code).toBe('VEHICLE_IDENTITY_MISMATCH');
  });

  it('rejects unsupported unit with 422', async () => {
    registerSyntheticMeasurement('SYNTH-WRONG-UNIT', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      workshop_order_ref: orderNumber,
      wheels: [
        { axle: 1, side: 'LEFT', force: '2.100', unit: 'daN' as 'kN' },
        ...SYNTHETIC_BRAKE_MEASUREMENT.wheels.slice(1),
      ],
    });
    const res = await preview('SYNTH-WRONG-UNIT').expect(422);
    expect(res.body.code).toBe('UNSUPPORTED_UNIT');
  });

  it('replays identical apply with 200 and a single measurement row', async () => {
    registerSyntheticMeasurement('SYNTH-REPLAY', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-REPLAY',
      workshop_order_ref: orderNumber,
    });
    const firstPreview = await preview('SYNTH-REPLAY').expect(201);
    await applyImport(firstPreview.body).expect(200);
    const secondPreview = await preview('SYNTH-REPLAY').expect(201);
    const secondApply = await applyImport(secondPreview.body).expect(200);
    expect(secondApply.body.replay).toBe(true);
    const count = await prisma.inspectionMeasurement.count({
      where: { measurement_id: 'SYNTH-MEASUREMENT-REPLAY' },
    });
    expect(count).toBe(1);
  });

  it('returns 409 MEASUREMENT_CONFLICT when revision changes for same identity', async () => {
    registerSyntheticMeasurement('SYNTH-CONFLICT-A', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-CONFLICT',
      revision: 'SYNTH-REV-1',
      workshop_order_ref: orderNumber,
    });
    const firstPreview = await preview('SYNTH-CONFLICT-A').expect(201);
    await applyImport(firstPreview.body).expect(200);

    registerSyntheticMeasurement('SYNTH-CONFLICT-B', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-CONFLICT',
      revision: 'SYNTH-REV-2',
      wheels: [{ axle: 1, side: 'LEFT', force: '2.500', unit: 'kN' }, ...SYNTHETIC_BRAKE_MEASUREMENT.wheels.slice(1)],
      workshop_order_ref: orderNumber,
    });
    const conflictPreview = await preview('SYNTH-CONFLICT-B').expect(409);
    expect(conflictPreview.body.code).toBe('MEASUREMENT_CONFLICT');
  });

  it('quarantines stale measurements', async () => {
    registerSyntheticMeasurement('SYNTH-STALE', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-STALE',
      measured_at: '2026-10-14T09:00:00+02:00',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-STALE').expect(201);
    expect(res.body.state).toBe('QUARANTINED');
    expect(res.body.reviewed_fields.quarantine_reason).toBe('STALE_MEASUREMENT');
  });

  it('quarantines expired device evidence', async () => {
    await prisma.inspectionDeviceEvidence.updateMany({
      where: { tenant_id: tenantId, evidence_ref: 'SYNTH-DEVICE-EVIDENCE-1' },
      data: {
        effective_until_exclusive: new Date('2026-10-15T00:00:00.000Z'),
      },
    });
    registerSyntheticMeasurement('SYNTH-EXPIRED-DEVICE', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-EXPIRED-DEV',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-EXPIRED-DEVICE').expect(201);
    expect(res.body.state).toBe('QUARANTINED');
    expect(res.body.reviewed_fields.quarantine_reason).toBe('UNCONFIRMED_DEVICE');
    await prisma.inspectionDeviceEvidence.updateMany({
      where: { tenant_id: tenantId, evidence_ref: 'SYNTH-DEVICE-EVIDENCE-1' },
      data: {
        effective_until_exclusive: new Date('2027-01-01T00:00:00.000Z'),
      },
    });
  });

  it('returns 409 REVIEW_REQUIRED when device binding changes after preview', async () => {
    registerSyntheticMeasurement('SYNTH-BINDING', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-BINDING',
      workshop_order_ref: orderNumber,
    });
    const previewRes = await preview('SYNTH-BINDING').expect(201);
    await prisma.inspectionDeviceSource.update({
      where: { id: deviceSourceId },
      data: { binding_revision: 2 },
    });
    const applyRes = await applyImport(previewRes.body).expect(409);
    expect(applyRes.body.code).toBe('REVIEW_REQUIRED');
    await prisma.inspectionDeviceSource.update({
      where: { id: deviceSourceId },
      data: { binding_revision: 1 },
    });
  });
});
