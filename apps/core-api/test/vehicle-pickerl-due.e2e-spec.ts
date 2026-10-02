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

describe('Pickerl Due (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'aut380');
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
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantId);
    await teardownTestApp(app);
  });


  it('GET /vehicles/pickerl-due returns paginated list', async () => {
    // Create customer and vehicle
    await runWithTenantContext(tenantId, async () => {
      const customer = await basePrisma.customer.create({
        data: {
          tenant_id: tenantId,
          type: 'PRIVATE',
          first_name: 'John',
          last_name: 'Doe',
        },
      });

      const vehicle = await basePrisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          customer_id: customer.id,
          make: 'VW',
          model: 'Golf',
          year: 2020,
          plate: 'W-123',
          inventory_role: 'CUSTOMER',
          first_registration_date: new Date('2020-01-01'),
        },
      });

      await basePrisma.vehicleInspectionRecord.create({
        data: {
          tenant_id: tenantId,
          vehicle_id: vehicle.id,
          inspection_type: 'PICKERL_57A',
          inspected_on: new Date('2023-01-01'),
          plaketten_valid_until_year: 2024,
          plaketten_valid_until_month: 1,
        },
      });
    });

    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].plate).toBe('W-123');
    expect(res.body.data[0].pickerl_due).toBeDefined();
    expect(res.body.data[0].pickerl_due.status).toBe('OVERDUE');
  });

  it('GET /vehicles/pickerl-due/export returns CSV', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/vehicles/pickerl-due/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('plate,vehicle,customer');
    expect(res.text).toContain('W-123');
  });
});
