import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import {
  VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE,
  VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE,
  VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE,
  VEHICLE_NOVA_CLASS_INVALID_CODE,
} from '../src/vehicle/vehicle-regulatory.validation.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Vehicle regulatory fields (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;
  let otherAuthToken: string;
  let vehicleId: string;
  let stockVehicleId: string;
  let siteId: string;
  let lotId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'vehicle-regulatory');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const otherTenant = await createTestTenant(
      basePrisma,
      'vehicle-regulatory-other',
    );
    otherAuthToken = createTestAuthToken(app.get(AuthService), otherTenant);

    const site = await prisma.site.findFirstOrThrow({
      where: { tenant_id: tenantId },
    });
    siteId = site.id;
    const lot = await prisma.storageLocation.findFirstOrThrow({
      where: { tenant_id: tenantId, site_id: siteId, type: 'vehicle_lot' },
    });
    lotId = lot.id;

    const stockVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'BMW',
        model: 'X3',
        year: 2022,
        inventory_role: 'USED',
        stock_status: 'IN_STOCK',
        site_id: siteId,
        location_id: lotId,
        co2_wltp_g_km: 50,
      },
    });
    stockVehicleId = stockVehicle.id;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });

  it('creates, reads, and updates regulatory fields within tenant', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Mercedes-Benz',
        model: 'C 200',
        year: 2024,
        first_registration_date: '2024-03-15',
        co2_wltp_g_km: 142,
        co2_nedc_g_km: 128,
        typenschein_no: 'TS-AUT375',
        nova_class: 'STANDARD',
        emission_class: 'Euro 6d',
      })
      .expect(201);

    vehicleId = createRes.body.id;
    expect(createRes.body.first_registration_date).toBeTruthy();
    expect(createRes.body.co2_wltp_g_km).toBe(142);
    expect(createRes.body.typenschein_no).toBe('TS-AUT375');
    expect(createRes.body.nova_class).toBe('STANDARD');

    const getRes = await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.co2_nedc_g_km).toBe(128);
    expect(getRes.body.emission_class).toBe('Euro 6d');

    await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ co2_wltp_g_km: 99 })
      .expect(200)
      .expect(({ body }) => {
        expect(body.co2_wltp_g_km).toBe(99);
      });

    const row = await prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    expect(row?.co2_wltp_g_km).toBe(99);
  });

  it('rejects invalid regulatory values with stable error codes', async () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 2);
    const futureIso = future.toISOString().slice(0, 10);

    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Audi',
        model: 'A4',
        year: 2025,
        first_registration_date: futureIso,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_FIRST_REGISTRATION_DATE_FUTURE_CODE);
      });

    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Audi',
        model: 'A4',
        year: 2025,
        first_registration_date: 20240315,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE);
      });

    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Audi',
        model: 'A4',
        year: 2025,
        first_registration_date: '2024-02-30',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_FIRST_REGISTRATION_DATE_INVALID_CODE);
      });

    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Audi',
        model: 'A4',
        year: 2025,
        co2_wltp_g_km: 900,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE);
      });

    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Audi',
        model: 'A4',
        year: 2025,
        co2_wltp_g_km: true,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE);
      });

    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        make: 'Audi',
        model: 'A4',
        year: 2025,
        nova_class: 'BOGUS',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_NOVA_CLASS_INVALID_CODE);
      });
  });

  it('isolates vehicles by tenant on read and patch', async () => {
    await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .send({ co2_wltp_g_km: 1 })
      .expect(404);

    const row = await prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    expect(row?.co2_wltp_g_km).toBe(99);
  });

  it('leaves regulatory fields unchanged when patch omits them', async () => {
    await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ plate: 'W-REG-375' })
      .expect(200);

    const row = await prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    expect(row?.plate).toBe('W-REG-375');
    expect(row?.co2_wltp_g_km).toBe(99);
    expect(row?.typenschein_no).toBe('TS-AUT375');
  });

  it('patches regulatory fields on dealer stock vehicles', async () => {
    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${stockVehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        co2_wltp_g_km: 120,
        typenschein_no: 'STOCK-TS',
        nova_class: 'OTHER',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.co2_wltp_g_km).toBe(120);
        expect(body.typenschein_no).toBe('STOCK-TS');
        expect(body.nova_class).toBe('OTHER');
      });

    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${stockVehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ co2_nedc_g_km: null, emission_class: null })
      .expect(200)
      .expect(({ body }) => {
        expect(body.co2_nedc_g_km).toBeNull();
        expect(body.emission_class).toBeNull();
      });

    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${stockVehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ co2_wltp_g_km: 999 })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(VEHICLE_CO2_WLTP_OUT_OF_RANGE_CODE);
      });

    await request(app.getHttpServer())
      .patch(`/api/vehicle-stock/${stockVehicleId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ mileage: 42_000 })
      .expect(200);

    const row = await prisma.vehicle.findFirst({
      where: { id: stockVehicleId, tenant_id: tenantId },
    });
    expect(row?.mileage).toBe(42_000);
    expect(row?.co2_wltp_g_km).toBe(120);
  });
});
