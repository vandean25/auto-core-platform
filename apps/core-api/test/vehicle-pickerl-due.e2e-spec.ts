import { createE2eApp } from './helpers/e2e-suite.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import {
  dueSoonWithinWindow,
  pickerlDueFixturesForToday,
} from '../src/vehicle/pickerl/pickerl-due-window-fixtures.js';
import { teardownTestApp } from './test-lifecycle.js';

const FIXTURE_FIRST_REGISTRATION = new Date('2019-06-01T00:00:00.000Z');

function expectedPickerlWindowPlates(window: 30 | 60 | 90): string[] {
  const today = new Date();
  const fixtures = pickerlDueFixturesForToday(today);
  const plates = ['W-OVERDUE'];
  if (dueSoonWithinWindow(fixtures.due30, today, window)) {
    plates.push('W-DUE30');
  }
  if (dueSoonWithinWindow(fixtures.due60, today, window)) {
    plates.push('W-DUE60');
  }
  if (dueSoonWithinWindow(fixtures.due90, today, window)) {
    plates.push('W-DUE90');
  }
  return plates.sort();
}

describe('Pickerl Due (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let techToken: string;

  beforeAll(async () => {
    app = await createE2eApp();

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
      const pickerlWindows = pickerlDueFixturesForToday(today);

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

      // 2. DUE_SOON inside the 30-day window (month-end rule)
      const future30 = pickerlWindows.due30;
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
          plaketten_valid_until_year: future30.year,
          plaketten_valid_until_month: future30.month,
        },
      });

      // 3. due inside 60d but outside 30d
      const future60 = pickerlWindows.due60;
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
          plaketten_valid_until_year: future60.year,
          plaketten_valid_until_month: future60.month,
        },
      });

      // 4. due inside 90d but outside 60d
      const future90 = pickerlWindows.due90;
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
          plaketten_valid_until_year: future90.year,
          plaketten_valid_until_month: future90.month,
        },
      });

      // 5. beyond 90 (OK)
      const future120 = pickerlWindows.ok;
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
          plaketten_valid_until_year: future120.year,
          plaketten_valid_until_month: future120.month,
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
    expect([...plates].sort()).toEqual(expectedPickerlWindowPlates(30));
  });

  it('GET /vehicles/pickerl-due filters by window 60 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=60')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(expectedPickerlWindowPlates(60));
  });

  it('GET /vehicles/pickerl-due filters by window 90 with exact plate set', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due?window=90')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const plates = res.body.data.map((v: { plate: string }) => v.plate);
    expect([...plates].sort()).toEqual(expectedPickerlWindowPlates(90));
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
