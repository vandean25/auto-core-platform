import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { AuthService } from '../src/auth/auth.service.js';
import {
  createGlobalValidationPipe,
  GlobalExceptionFilter,
} from '../src/common/index.js';
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
  let vehicleId: string;
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
    app.useGlobalFilters(new GlobalExceptionFilter());
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
      vehicleId = vehicle.id;

      await prisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId,
          vehicle_id: vehicle.id,
          inspection_type: 'PICKERL_57A',
          inspected_on: new Date('2025-06-01'),
          plaketten_valid_until_year: 2027,
          plaketten_valid_until_month: 6,
          station_name: 'SYNTH-STATION',
        },
      });

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

  it('rejects wrong device serial with DEVICE_BINDING_MISMATCH', async () => {
    registerSyntheticMeasurement('SYNTH-WRONG-DEVICE', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-WRONG-DEVICE',
      device_serial: 'SYNTH-OTHER-DEVICE',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-WRONG-DEVICE').expect(422);
    expect(res.body.code).toBe('DEVICE_BINDING_MISMATCH');
    const count = await prisma.inspectionMeasurement.count({
      where: {
        tenant_id: tenantId,
        measurement_id: 'SYNTH-MEASUREMENT-WRONG-DEVICE',
      },
    });
    expect(count).toBe(0);
  });

  it('rejects unknown native schema version with UNSUPPORTED_SCHEMA_VERSION', async () => {
    registerSyntheticMeasurement('SYNTH-UNKNOWN-NATIVE', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-UNKNOWN-NATIVE',
      native_schema_version: 'UNKNOWN/999',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-UNKNOWN-NATIVE').expect(422);
    expect(res.body.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects implausible forces with IMPLAUSIBLE_MEASUREMENT', async () => {
    registerSyntheticMeasurement('SYNTH-OUT-OF-RANGE', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-OUT-OF-RANGE',
      workshop_order_ref: orderNumber,
      wheels: [
        { axle: 1, side: 'LEFT', force: '99.000', unit: 'kN' },
        ...SYNTHETIC_BRAKE_MEASUREMENT.wheels.slice(1),
      ],
    });
    const res = await preview('SYNTH-OUT-OF-RANGE').expect(422);
    expect(res.body.code).toBe('IMPLAUSIBLE_MEASUREMENT');
  });

  it('rejects measured_at without timezone offset', async () => {
    registerSyntheticMeasurement('SYNTH-NO-TZ', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-NO-TZ',
      measured_at: '2026-10-16T11:15:00',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-NO-TZ').expect(400);
    expect(res.body.code).toBe('INVALID_MEASUREMENT_PAYLOAD');
  });

  it('rejects future measured_at with INVALID_MEASUREMENT_PAYLOAD', async () => {
    registerSyntheticMeasurement('SYNTH-FUTURE', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-FUTURE',
      measured_at: '2030-10-16T11:15:00+02:00',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-FUTURE').expect(400);
    expect(res.body.code).toBe('INVALID_MEASUREMENT_PAYLOAD');
  });

  it('rejects malformed JSON with INVALID_MEASUREMENT_PAYLOAD', async () => {
    registerSyntheticMeasurement('SYNTH-MALFORMED-JSON', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-MALFORMED',
      workshop_order_ref: orderNumber,
    });
    const res = await preview('SYNTH-MALFORMED-JSON').expect(400);
    expect(res.body.code).toBe('INVALID_MEASUREMENT_PAYLOAD');
  });

  it('returns 404 for foreign workshop order', async () => {
    await request(app.getHttpServer())
      .post(
        `/api/workshop-orders/00000000-0000-4000-8000-000000000099/measurements/preview`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        device_source_id: deviceSourceId,
        native_measurement_reference: 'SYNTH-NATIVE-RESULT-1',
      })
      .expect(404);
  });

  it('returns 403 for API key principal on preview', async () => {
    const keyRes = await request(app.getHttpServer())
      .post('/api/tenant-api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'measurement-e2e', scopes: ['customers:read'] })
      .expect(201);
    const apiKeyToken = keyRes.body.token as string;
    await request(app.getHttpServer())
      .post(`/api/workshop-orders/${orderId}/measurements/preview`)
      .set('Authorization', `Bearer ${apiKeyToken}`)
      .send({
        device_source_id: deviceSourceId,
        native_measurement_reference: 'SYNTH-NATIVE-RESULT-1',
      })
      .expect(403);
  });

  it('returns NOT_CONFIGURED for non-TEST_ONLY device profile', async () => {
    const prodSource = await prisma.inspectionDeviceSource.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        source_system: 'WORKSHOP_NET',
        source_instance_id: 'SYNTH-NETWORK-PROD',
        device_serial: 'SYNTH-BRAKE-SERIAL-PROD',
        device_model: 'SYNTH-BRAKE-MODEL',
        profile_id: 'VENDOR_X',
        profile_version: 'VENDOR_X/1',
        profile_digest: createHash('sha256').update('VENDOR_X').digest('hex'),
        binding_revision: 1,
        range_min: '0',
        range_max: '10',
        range_unit: 'kN',
        read_enabled: true,
        is_active: true,
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/api/workshop-orders/${orderId}/measurements/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        device_source_id: prodSource.id,
        native_measurement_reference: 'SYNTH-NATIVE-RESULT-1',
      })
      .expect(422);
    expect(res.body.code).toBe('NOT_CONFIGURED');
  });

  it('still applies when inspector qualification is expired (C2 not a brake gate)', async () => {
    registerSyntheticMeasurement('SYNTH-QUAL-EXPIRED', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-QUAL-EXPIRED',
      workshop_order_ref: orderNumber,
    });
    const previewRes = await preview('SYNTH-QUAL-EXPIRED').expect(201);
    expect(previewRes.body.state).toBe('READY_FOR_REVIEW');
    await applyImport(previewRes.body).expect(200);
    const applied = await prisma.inspectionMeasurement.findFirst({
      where: { measurement_id: 'SYNTH-MEASUREMENT-QUAL-EXPIRED' },
    });
    expect(applied).not.toBeNull();
  });

  it('does not mutate vehicle inspection due records or checklist on apply', async () => {
    const recordsBefore = await prisma.vehicleInspectionRecord.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
    });
    const checklistBefore = await prisma.workshopInspectionItem.count({
      where: { tenant_id: tenantId },
    });

    registerSyntheticMeasurement('SYNTH-NO-SIDE-EFFECT', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-NO-SIDE-EFFECT',
      workshop_order_ref: orderNumber,
    });
    const previewRes = await preview('SYNTH-NO-SIDE-EFFECT').expect(201);
    await applyImport(previewRes.body).expect(200);

    const recordsAfter = await prisma.vehicleInspectionRecord.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
    });
    const checklistAfter = await prisma.workshopInspectionItem.count({
      where: { tenant_id: tenantId },
    });

    expect(recordsAfter).toHaveLength(recordsBefore.length);
    expect(recordsAfter[0]?.plaketten_valid_until_year).toBe(
      recordsBefore[0]?.plaketten_valid_until_year,
    );
    expect(recordsAfter[0]?.plaketten_valid_until_month).toBe(
      recordsBefore[0]?.plaketten_valid_until_month,
    );
    expect(checklistAfter).toBe(checklistBefore);
  });

  it('replays parallel apply with a single measurement row', async () => {
    registerSyntheticMeasurement('SYNTH-PARALLEL', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-PARALLEL',
      workshop_order_ref: orderNumber,
    });
    const previewRes = await preview('SYNTH-PARALLEL').expect(201);
    const [first, second] = await Promise.all([
      applyImport(previewRes.body),
      applyImport(previewRes.body),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 200]);
    const count = await prisma.inspectionMeasurement.count({
      where: { measurement_id: 'SYNTH-MEASUREMENT-PARALLEL' },
    });
    expect(count).toBe(1);
  });

  it('persists conflict support event after MEASUREMENT_CONFLICT preview', async () => {
    registerSyntheticMeasurement('SYNTH-EVENT-A', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-EVENT',
      revision: 'SYNTH-REV-EVENT-1',
      workshop_order_ref: orderNumber,
    });
    const firstPreview = await preview('SYNTH-EVENT-A').expect(201);
    await applyImport(firstPreview.body).expect(200);

    registerSyntheticMeasurement('SYNTH-EVENT-B', {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measurement_id: 'SYNTH-MEASUREMENT-EVENT',
      revision: 'SYNTH-REV-EVENT-2',
      wheels: [
        { axle: 1, side: 'LEFT', force: '2.800', unit: 'kN' },
        ...SYNTHETIC_BRAKE_MEASUREMENT.wheels.slice(1),
      ],
      workshop_order_ref: orderNumber,
    });
    await preview('SYNTH-EVENT-B').expect(409);
    const events = await prisma.inspectionSupportEvent.findMany({
      where: {
        tenant_id: tenantId,
        reason: 'MEASUREMENT_CONFLICT',
        contract_kind: 'BRAKE_MEASUREMENT',
      },
    });
    expect(events.length).toBeGreaterThan(0);
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
