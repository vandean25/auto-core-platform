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
import { computePickerlDue } from '../src/vehicle/pickerl/compute-pickerl-due.js';

describe('Vehicle Pickerl (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let salesToken: string;
  let techToken: string;
  let otherTenantToken: string;
  let vehicleId: string;
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'vehicle-pickerl');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    adminToken = createTestAuthToken(app.get(AuthService), testTenant);

    const otherTenant = await createTestTenant(
      basePrisma,
      'vehicle-pickerl-other',
    );
    otherTenantToken = createTestAuthToken(app.get(AuthService), otherTenant);

    await runWithTenantContext(tenantId, async () => {
      const authService = app.get(AuthService);
      const techUser = await prisma.user.create({
        data: {
          firebaseUid: `e2e-tech-pickerl-${Date.now()}`,
          email: `e2e-tech-pickerl-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(prisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      techToken = authService.createTestToken({
        sub: techUser.firebaseUid,
        email: techUser.email,
        tenantId,
        role: 'TECH',
      });

      const salesUser = await prisma.user.create({
        data: {
          firebaseUid: `e2e-sales-pickerl-${Date.now()}`,
          email: `e2e-sales-pickerl-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(prisma, {
        tenantId,
        userId: salesUser.id,
        role: 'SALES',
      });
      salesToken = authService.createTestToken({
        sub: salesUser.firebaseUid,
        email: salesUser.email,
        tenantId,
        role: 'SALES',
      });
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'VW',
        model: 'Golf',
        year: 2019,
        first_registration_date: new Date('2019-06-01T00:00:00.000Z'),
      },
    });
    vehicleId = vehicle.id;

  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });

  it('returns pickerl_due UNKNOWN when Erstzulassung is missing', async () => {
    const missing = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Audi',
        model: 'A3',
        year: 2021,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/vehicles/${missing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.pickerl_due.status).toBe('UNKNOWN');
    expect(res.body.pickerl_due.due_month).toBeNull();
  });

  it('reflects pickerl_due after creating a record', async () => {
    const freshVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        make: 'Toyota',
        model: 'Yaris',
        year: 2024,
        first_registration_date: new Date('2024-01-15T00:00:00.000Z'),
      },
    });

    const before = await request(app.getHttpServer())
      .get(`/api/vehicles/${freshVehicle.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(before.body.pickerl_due.due_month).toBe(
      computePickerlDue(
        { first_registration_date: '2024-01-15' },
        [],
        new Date(),
      ).due_month,
    );

    await request(app.getHttpServer())
      .post(`/api/vehicles/${freshVehicle.id}/inspection-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2024-03-01',
        plaketten_valid_until_year: 2026,
        plaketten_valid_until_month: 3,
      })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get(`/api/vehicles/${freshVehicle.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(after.body.pickerl_due.due_month).toBe('2026-03');
  });

  it('creates and lists inspection records; TECH cannot create', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2022-06-05',
        plaketten_valid_until_year: 2024,
        plaketten_valid_until_month: 6,
        station_name: 'Prüfstelle Demo',
      })
      .expect(201);

    expect(createRes.body.plaketten_valid_until_year).toBe(2024);

    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2024-06-05',
        plaketten_valid_until_year: 2026,
        plaketten_valid_until_month: 6,
      })
      .expect(403);

    const listRes = await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${techToken}`)
      .expect(200);

    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
  });

  it('allows SALES to create records', async () => {
    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2024-06-01',
        plaketten_valid_until_year: 2026,
        plaketten_valid_until_month: 6,
      })
      .expect(201);
  });

  it('validates DTO fields with 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: 'not-a-date',
        plaketten_valid_until_year: 2026,
        plaketten_valid_until_month: 6,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2024-06-01',
        plaketten_valid_until_year: 2026,
        plaketten_valid_until_month: 13,
      })
      .expect(400);
  });

  it('supports PATCH and DELETE for writers; TECH gets 403', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2021-06-01',
        plaketten_valid_until_year: 2023,
        plaketten_valid_until_month: 6,
      })
      .expect(201);

    const recordId = created.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ station_name: 'Blocked' })
      .expect(403);

    const patched = await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ station_name: 'Updated Prüfstelle' })
      .expect(200);

    expect(patched.body.station_name).toBe('Updated Prüfstelle');

    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('returns 404 for cross-tenant inspection record access', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/vehicles/${vehicleId}/inspection-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        inspection_type: 'PICKERL_57A',
        inspected_on: '2020-06-01',
        plaketten_valid_until_year: 2022,
        plaketten_valid_until_month: 6,
      })
      .expect(201);

    const recordId = created.body.id as string;

    await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .send({ notes: 'nope' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}/inspection-records/${recordId}`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .expect(404);
  });
});
