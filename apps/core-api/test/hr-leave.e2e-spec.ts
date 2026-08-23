import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { createGlobalValidationPipe } from '../src/common';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('HR Leave Booking & Remaining Workdays (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantId: string;
  let fixtureTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let techAuthToken: string;
  let salesAuthToken: string;
  let ownerAuthToken: string;
  let techEmployeeId: string;
  let deskEmployeeId: string;

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

    fixtureTenant = await createTestTenant(basePrisma, 'hr-leave');
    tenantId = fixtureTenant.tenantId;

    await runWithTenantContext(tenantId, async () => {
      // 1. Linked TECH user + employee (mechanic)
      const techFirebaseUid = `e2e-tech-leave-${Date.now()}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techFirebaseUid,
          email: `e2e-tech-leave-${Date.now()}@test.local`,
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
          name: 'Tech Leave Mechanic',
          role: 'MECHANIC',
          is_active: true,
          user_id: techUser.id,
          annual_leave_days: 25,
        },
      });
      techEmployeeId = techEmployee.id;

      // 2. Linked SALES user + employee
      const salesFirebaseUid = `e2e-sales-leave-${Date.now()}`;
      const salesUser = await basePrisma.user.create({
        data: {
          firebaseUid: salesFirebaseUid,
          email: `e2e-sales-leave-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: salesUser.id,
        role: 'SALES',
      });
      salesAuthToken = authService.createTestToken({
        sub: salesFirebaseUid,
        email: salesUser.email,
        tenantId,
        role: 'SALES',
      });
      const deskEmployee = await basePrisma.employee.create({
        data: {
          tenant_id: tenantId,
          name: 'Sales Advisor',
          role: 'SERVICE_ADVISOR',
          is_active: true,
          user_id: salesUser.id,
          annual_leave_days: 25,
        },
      });
      deskEmployeeId = deskEmployee.id;

      // 3. OWNER user
      const ownerFirebaseUid = `e2e-owner-leave-${Date.now()}`;
      const ownerUser = await basePrisma.user.create({
        data: {
          firebaseUid: ownerFirebaseUid,
          email: `e2e-owner-leave-${Date.now()}@test.local`,
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
    });
  });

  afterAll(async () => {
    if (fixtureTenant) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    await teardownTestApp(app);
  });

  describe('Self Leave Management (/api/hr/me/leave)', () => {
    it('GET /api/hr/me/leave initializes yearly balance and returns 25 remaining days', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(res.body.year).toBe(new Date().getUTCFullYear());
      expect(res.body.allowanceDays).toBe(25);
      expect(res.body.carryoverDays).toBe(0);
      expect(res.body.remainingDays).toBe(25);
      expect(res.body.bookings).toEqual([]);
    });

    it('rejects leave spanning across two calendar years with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-12-28',
          endOn: '2027-01-04',
          note: 'New Year trip',
        })
        .expect(400);

      expect(res.body.message).toContain('cannot span two calendar years');
    });

    it('rejects endOn before startOn with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-09-05',
          endOn: '2026-09-01',
        })
        .expect(400);

      expect(res.body.message).toContain('on or after startOn');
    });

    it('rejects leave on closed days (zero workdays) with 400', async () => {
      // 2026-08-30 is Sunday (closed by default)
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-08-30',
          endOn: '2026-08-30',
        })
        .expect(400);

      expect(res.body.message).toContain('zero workdays');
    });

    let createdBookingId: string;

    it('successfully books 5 workdays (Mon-Fri) and snapshots daysCharged', async () => {
      // 2026-09-07 is Mon, 2026-09-11 is Fri
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-09-07',
          endOn: '2026-09-11',
          note: 'Autumn holiday',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.employeeId).toBe(techEmployeeId);
      expect(res.body.startOn).toBe('2026-09-07');
      expect(res.body.endOn).toBe('2026-09-11');
      expect(res.body.status).toBe('BOOKED');
      expect(res.body.daysCharged).toBe(5);
      createdBookingId = res.body.id;

      // Verify remaining days drops to 20
      const getRes = await request(app.getHttpServer())
        .get('/api/hr/me/leave?year=2026')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(getRes.body.remainingDays).toBe(20);
      expect(getRes.body.bookings).toHaveLength(1);
      expect(getRes.body.bookings[0].id).toBe(createdBookingId);
    });

    it('rejects overlapping leave booking with 409 Conflict', async () => {
      // Overlaps with 2026-09-07..2026-09-11
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-09-10',
          endOn: '2026-09-18',
        })
        .expect(409);

      expect(res.body.message).toContain('overlaps');
    });

    it('rejects booking when daysCharged exceeds remaining allowance with 409 Conflict', async () => {
      // 20 remaining. Booking 5 weeks = 25 workdays
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-10-05',
          endOn: '2026-11-06',
        })
        .expect(409);

      expect(res.body.message).toContain('Not enough remaining leave days');
    });

    it('cancels leave booking and restores remaining days', async () => {
      const cancelRes = await request(app.getHttpServer())
        .post(`/api/hr/leave/${createdBookingId}/cancel`)
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      // Remaining days back to 25
      const getRes = await request(app.getHttpServer())
        .get('/api/hr/me/leave?year=2026')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(getRes.body.remainingDays).toBe(25);
    });

    it('employee cannot cancel another employee leave booking', async () => {
      // Sales books leave
      const salesBookingRes = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${salesAuthToken}`)
        .send({
          startOn: '2026-11-02',
          endOn: '2026-11-06',
        })
        .expect(201);

      const salesBookingId = salesBookingRes.body.id;

      // Tech attempts to cancel Sales' booking
      await request(app.getHttpServer())
        .post(`/api/hr/leave/${salesBookingId}/cancel`)
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(403);
    });
  });

  describe('Manager Leave Management & Team Queries', () => {
    let deskBookingId: string;

    it('OWNER can book leave for another employee via POST /api/hr/leave', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/leave')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          employeeId: deskEmployeeId,
          startOn: '2026-09-14',
          endOn: '2026-09-18',
          note: 'Booked by manager',
        })
        .expect(201);

      expect(res.body.employeeId).toBe(deskEmployeeId);
      expect(res.body.daysCharged).toBe(5);
      deskBookingId = res.body.id;
    });

    it('OWNER can update leave dates and note via PATCH /api/hr/leave/:id', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/hr/leave/${deskBookingId}`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          startOn: '2026-09-14',
          endOn: '2026-09-16',
          note: 'Shortened trip',
        })
        .expect(200);

      expect(res.body.daysCharged).toBe(3);
      expect(res.body.note).toBe('Shortened trip');
    });

    it('OWNER can patch leave balance and sync current year allowance to employee', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/hr/employees/${deskEmployeeId}/leave-balance`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          year: 2026,
          allowanceDays: 30,
          carryoverDays: 5,
        })
        .expect(200);

      expect(res.body.allowanceDays).toBe(30);
      expect(res.body.carryoverDays).toBe(5);

      // Verify Employee.annual_leave_days was updated
      const empRes = await request(app.getHttpServer())
        .get(`/api/employees/${deskEmployeeId}`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(empRes.body.annualLeaveDays).toBe(30);
    });

    it('GET /api/hr/leave is accessible by SALES and OWNER, but returns 403 for TECH', async () => {
      // Tech receives 403
      await request(app.getHttpServer())
        .get('/api/hr/leave?from=2026-09-01&to=2026-09-30')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(403);

      // Sales receives 200
      const salesRes = await request(app.getHttpServer())
        .get('/api/hr/leave?from=2026-09-01&to=2026-09-30')
        .set('Authorization', `Bearer ${salesAuthToken}`)
        .expect(200);

      expect(Array.isArray(salesRes.body)).toBe(true);
      expect(salesRes.body.length).toBeGreaterThanOrEqual(1);
      expect(salesRes.body[0].employee).toBeDefined();

      // Owner receives 200
      const ownerRes = await request(app.getHttpServer())
        .get('/api/hr/leave?from=2026-09-01&to=2026-09-30')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(Array.isArray(ownerRes.body)).toBe(true);
    });
  });
});
