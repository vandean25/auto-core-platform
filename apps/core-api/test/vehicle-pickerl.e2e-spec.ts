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

describe('Vehicle Pickerl (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let adminToken: string;
  let techToken: string;
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

    expect(listRes.body).toHaveLength(1);

    const detailRes = await request(app.getHttpServer())
      .get(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(detailRes.body.pickerl_due.due_month).toBe('2024-06');
    expect(detailRes.body.pickerl_due.warnings.length).toBeGreaterThan(0);
  });
});
