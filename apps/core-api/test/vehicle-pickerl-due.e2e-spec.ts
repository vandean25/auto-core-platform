import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const FIXTURE_FIRST_REGISTRATION = new Date('2019-06-01T00:00:00.000Z');

describe('Pickerl Due (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let techToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'aut-380-fix');
    tenantId = testTenant.tenantId;

    const testUser = await basePrisma.user.create({
      data: {
        email: `admin-${Date.now()}@pickerl.test`,
        firebaseUid: `uid-${Date.now()}`,
      },
    });

    await seedTestTenantMember(basePrisma, {
      tenantId,
      userId: testUser.id,
      role: 'ADMIN',
    });

    const authService = app.get(AuthService);
    adminToken = createTestAuthToken(authService, testTenant, {
      sub: testUser.firebaseUid,
      email: testUser.email,
      role: 'ADMIN',
    });

    await runWithTenantContext(tenantId, async () => {
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: `e2e-tech-pickerl-due-${Date.now()}`,
          email: `e2e-tech-pickerl-due-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
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

    // Seed AUT-380 fixtures
    await runWithTenantContext(tenantId, async () => {
      const customer = await basePrisma.customer.create({
        data: {
          tenant_id: tenantId,
          type: 'PRIVATE',
          first_name: 'John',
          last_name: 'Doe',
          phone: '+4312345678',
          email: '=injection@test.com',
        },
      });

      const today = new Date();
      const todayYear = today.getUTCFullYear();
      const todayMonth = today.getUTCMonth() + 1;

      // 1. OVERDUE
      const v1 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Overdue', year: 2020, plate: 'W-OVERDUE', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v1.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: todayYear - 1, plaketten_valid_until_month: 1,
        },
      });

      // 2. DUE_SOON inside 30d
      const future30 = new Date(Date.UTC(todayYear, todayMonth - 1, today.getUTCDate() + 15));
      const v2 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Due30', year: 2020, plate: 'W-DUE30', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v2.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future30.getUTCFullYear(), plaketten_valid_until_month: future30.getUTCMonth() + 1,
        },
      });

      // 3. due 31-60
      const future60 = new Date(Date.UTC(todayYear, todayMonth - 1, today.getUTCDate() + 45));
      const v3 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Due60', year: 2020, plate: 'W-DUE60', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v3.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future60.getUTCFullYear(), plaketten_valid_until_month: future60.getUTCMonth() + 1,
        },
      });

      // 4. due 61-90
      const future90 = new Date(Date.UTC(todayYear, todayMonth - 1, today.getUTCDate() + 75));
      const v4 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Due90', year: 2020, plate: 'W-DUE90', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v4.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future90.getUTCFullYear(), plaketten_valid_until_month: future90.getUTCMonth() + 1,
        },
      });

      // 5. beyond 90 (OK)
      const future120 = new Date(Date.UTC(todayYear, todayMonth - 1, today.getUTCDate() + 120));
      const v5 = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'OK', year: 2020, plate: 'W-OK', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId, vehicle_id: v5.id, inspection_type: 'PICKERL_57A', inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: future120.getUTCFullYear(), plaketten_valid_until_month: future120.getUTCMonth() + 1,
        },
      });

      // 6. UNKNOWN (no inspection)
      await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId, customer_id: customer.id,
          make: 'VW', model: 'Unknown', year: 2020, plate: 'W-UNKNOWN', inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });

      // 7. USED stock vehicle (should be ignored)
      await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'VW', model: 'Stock', year: 2020, plate: 'W-STOCK', inventory_role: 'USED',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
    });

    const otherTenant = await createTestTenant(basePrisma, 'pickerl-due-other');
    otherTenantId = otherTenant.tenantId;
    const today = new Date();
    const todayYear = today.getUTCFullYear();
    await runWithTenantContext(otherTenantId, async () => {
      const v8 = await basePrisma.vehicle.create({
        data: {
          tenant_id: otherTenantId,
          make: 'VW',
          model: 'Other',
          year: 2020,
          plate: 'W-OTHER',
          inventory_role: 'CUSTOMER',
          first_registration_date: FIXTURE_FIRST_REGISTRATION,
        },
      });
      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: otherTenantId,
          vehicle_id: v8.id,
          inspection_type: 'PICKERL_57A',
          inspected_on: new Date('2020-01-01'),
          plaketten_valid_until_year: todayYear - 1,
          plaketten_valid_until_month: 1,
        },
      });
    });
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await cleanupTestTenantGraph(basePrisma, otherTenantId);
    await teardownTestApp(app);
  });


  it('GET /vehicles/pickerl-due returns paginated list with pageCount', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.meta.pageCount).toBeDefined();
    expect(res.body.meta.totalPages).toBeUndefined();

    const plates = res.body.data.map(v => v.plate);
    expect(plates).toContain('W-OVERDUE');
    expect(plates).toContain('W-DUE30');
    expect(plates).toContain('W-DUE60');
    expect(plates).toContain('W-DUE90');
    expect(plates).toContain('W-OK');
    expect(plates).toContain('W-UNKNOWN');
    expect(plates).not.toContain('W-STOCK');
    expect(plates).not.toContain('W-OTHER');
  });

  it('GET /vehicles/pickerl-due filters by window 30 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=30')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(['W-DUE30', 'W-OVERDUE'].sort());
  });

  it('GET /vehicles/pickerl-due filters by window 60 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=60')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(
      ['W-DUE30', 'W-DUE60', 'W-OVERDUE'].sort(),
    );
  });

  it('GET /vehicles/pickerl-due filters by window 90 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=90')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(
      ['W-DUE30', 'W-DUE60', 'W-DUE90', 'W-OVERDUE'].sort(),
    );
  });

  it('GET /vehicles/pickerl-due?status=UNKNOWN returns only unknown vehicles', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?status=UNKNOWN')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect(plates).toEqual(['W-UNKNOWN']);
  });

  it('GET /vehicles/pickerl-due returns 401 without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due')
      .expect(401);
  });

  it('GET /vehicles/pickerl-due returns 403 for TECH role', async () => {
    await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due')
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);
  });

  it('GET /vehicles/pickerl-due/export returns CSV without formulas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('plate,vehicle,customer');
    expect(res.text).toContain('W-OVERDUE');
    expect(res.text).toContain('2020-01-01'); // last_inspected_on
    expect(res.text).toContain('+4312345678'); // phone
    expect(res.text).toContain(`'=injection@test.com`); // Neutralized CSV injection
  });
});
