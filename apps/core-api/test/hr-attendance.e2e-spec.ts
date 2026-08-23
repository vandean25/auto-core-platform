import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { createGlobalValidationPipe } from '../src/common';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('HR Attendance Clock & Management (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let fixtureTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let crossTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let techAuthToken: string;
  let unlinkedTechToken: string;
  let ownerAuthToken: string;
  let techEmployeeId: string;
  let otherEmployeeId: string;
  let crossTenantEmployeeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);

    fixtureTenant = await createTestTenant(basePrisma, 'hr-attend');
    tenantId = fixtureTenant.tenantId;
    crossTenant = await createTestTenant(basePrisma, 'hr-attend-cross');

    await runWithTenantContext(crossTenant.tenantId, async () => {
      const crossTenantEmployee = await basePrisma.employee.create({
        data: {
          tenant_id: crossTenant.tenantId,
          name: 'Cross Tenant Employee',
          role: 'SERVICE_ADVISOR',
          is_active: true,
          annual_leave_days: 25,
        },
      });
      crossTenantEmployeeId = crossTenantEmployee.id;
    });

    await runWithTenantContext(tenantId, async () => {
      // 1. Linked TECH user + employee
      const techFirebaseUid = `e2e-tech-hr-${Date.now()}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: `e2e-tech-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      techAuthToken = authService.createTestToken({
        sub: techFirebaseUid,
        email: techUser.email,
        tenantId,
        role: 'TECH',
      });
      const techEmployee = await basePrisma.employee.create({
        data: {
          tenant_id: tenantId,
          name: 'Tech Mechanic',
          role: 'MECHANIC',
          is_active: true,
          user_id: techUser.id,
          annual_leave_days: 25,
        },
      });
      techEmployeeId = techEmployee.id;

      // 2. Unlinked TECH user (no Employee record)
      const unlinkedFirebaseUid = `e2e-unlinked-hr-${Date.now()}`;
      const unlinkedUser = await basePrisma.user.create({
        data: {
          firebaseUid: unlinkedFirebaseUid,
          email: `e2e-unlinked-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: unlinkedUser.id,
        role: 'TECH',
      });
      unlinkedTechToken = authService.createTestToken({
        sub: unlinkedFirebaseUid,
        email: unlinkedUser.email,
        tenantId,
        role: 'TECH',
      });

      // 3. OWNER user + employee
      const ownerFirebaseUid = `e2e-owner-hr-${Date.now()}`;
      const ownerUser = await basePrisma.user.create({
        data: {
          firebaseUid: ownerFirebaseUid,
          email: `e2e-owner-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: ownerUser.id,
        role: 'OWNER',
      });
      ownerAuthToken = authService.createTestToken({
        sub: ownerFirebaseUid,
        email: ownerUser.email,
        tenantId,
        role: 'OWNER',
      });

      // 4. Another employee for manager punch tests
      const otherEmployee = await basePrisma.employee.create({
        data: {
          tenant_id: tenantId,
          name: 'Desk Employee',
          role: 'SERVICE_ADVISOR',
          is_active: true,
          annual_leave_days: 25,
        },
      });
      otherEmployeeId = otherEmployee.id;
    });
  });

  afterAll(async () => {
    if (fixtureTenant) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (crossTenant) {
      await cleanupTestTenantGraph(basePrisma, crossTenant.tenantId);
    }
    await teardownTestApp(app);
  });

  describe('Self Attendance Punching (/api/hr/me/clock)', () => {
    it('initial state is CLOCKED_OUT for linked employee', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(res.body.state).toBe('CLOCKED_OUT');
      expect(res.body.lastEvent).toBeNull();
      expect(Array.isArray(res.body.todayEvents)).toBe(true);
    });

    it('rejects PAUSE while CLOCKED_OUT with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'PAUSE' })
        .expect(409);

      expect(res.body.message).toContain(
        'Cannot punch PAUSE while in state CLOCKED_OUT',
      );
    });

    it('successfully punches CLOCK_IN and transitions to CLOCKED_IN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'CLOCK_IN', note: 'Morning shift' })
        .expect(201);

      expect(res.body.state).toBe('CLOCKED_IN');
      expect(res.body.event.type).toBe('CLOCK_IN');
      expect(res.body.event.source).toBe('SELF');
      expect(res.body.event.employeeId).toBe(techEmployeeId);
      expect(res.body.event.note).toBe('Morning shift');
    });

    it('rejects second CLOCK_IN while CLOCKED_IN with 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'CLOCK_IN' })
        .expect(409);
    });

    it('punches PAUSE and transitions to PAUSED', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'PAUSE', note: 'Coffee' })
        .expect(201);

      expect(res.body.state).toBe('PAUSED');
      expect(res.body.event.type).toBe('PAUSE');
    });

    it('resumes from PAUSED with CLOCK_IN', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'CLOCK_IN' })
        .expect(201);

      expect(res.body.state).toBe('CLOCKED_IN');
    });

    it('punches DOCTOR and transitions to AT_DOCTOR', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'DOCTOR' })
        .expect(201);

      expect(res.body.state).toBe('AT_DOCTOR');
    });

    it('punches CLOCK_OUT and transitions to CLOCKED_OUT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/clock')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({ type: 'CLOCK_OUT' })
        .expect(201);

      expect(res.body.state).toBe('CLOCKED_OUT');
    });

    it('unlinked user receives 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/hr/me/clock')
        .set('Authorization', `Bearer ${unlinkedTechToken}`)
        .expect(403);
    });
  });

  describe('Manager Attendance (/api/hr/attendance)', () => {
    it('TECH receives 403 on GET /api/hr/attendance', async () => {
      await request(app.getHttpServer())
        .get('/api/hr/attendance?from=2026-08-01&to=2026-08-22')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(403);
    });

    it('TECH receives 403 on GET /api/hr/attendance/:employeeId/clock', async () => {
      await request(app.getHttpServer())
        .get(`/api/hr/attendance/${otherEmployeeId}/clock`)
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(403);
    });

    it('OWNER can read the current clock state for an active employee', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/hr/attendance/${otherEmployeeId}/clock`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(res.body.state).toBe('CLOCKED_OUT');
      expect(res.body.lastEvent).toBeNull();
      expect(res.body.todayEvents).toEqual([]);
    });

    it('OWNER receives 404 for an active employee in another tenant', async () => {
      await request(app.getHttpServer())
        .get(`/api/hr/attendance/${crossTenantEmployeeId}/clock`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(404);
    });

    it('OWNER can punch attendance for other employee', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/attendance')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          employeeId: otherEmployeeId,
          type: 'CLOCK_IN',
          note: 'Manager clock-in',
        })
        .expect(201);

      expect(res.body.state).toBe('CLOCKED_IN');
      expect(res.body.event.source).toBe('MANAGER');
      expect(res.body.event.employeeId).toBe(otherEmployeeId);
    });

    it('rejects manager punch with occurredAt before previous event with 409', async () => {
      await request(app.getHttpServer())
        .post('/api/hr/attendance')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          employeeId: otherEmployeeId,
          type: 'CLOCK_OUT',
          occurredAt: '2020-01-01T00:00:00Z',
        })
        .expect(409);
    });

    it('OWNER can query attendance within 31 days', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/hr/attendance?from=2026-08-01&to=2026-08-31')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects query exceeding 31 days with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .get('/api/hr/attendance?from=2026-07-01&to=2026-08-22')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(400);
    });

    it('rejects query with invalid date format (datetime instead of YYYY-MM-DD) with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/hr/attendance?from=2026-08-01T00:00:00Z&to=2026-08-22')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(400);
    });
  });
});
