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
  HR_TEST_ALLOWANCE_30_MINUTES,
  HR_TEST_ANNUAL_LEAVE_MINUTES,
  HR_TEST_CARRYOVER_5_MINUTES,
  HR_TEST_REMAINING_AFTER_WEEK_MINUTES,
  HR_TEST_THREE_DAY_LEAVE_MINUTES,
  HR_TEST_WEEK_LEAVE_MINUTES,
  runWithTenantContext,
  seedTestEmployee,
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
  let scheduleChangeEmployeeId: string;

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
      const techEmployee = await seedTestEmployee(basePrisma, {
        tenantId,
        name: 'Tech Leave Mechanic',
        role: 'MECHANIC',
        userId: techUser.id,
      });
      techEmployeeId = techEmployee.id;

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
      const deskEmployee = await seedTestEmployee(basePrisma, {
        tenantId,
        name: 'Sales Advisor',
        role: 'SERVICE_ADVISOR',
        userId: salesUser.id,
      });
      deskEmployeeId = deskEmployee.id;

      const scheduleChangeEmployee = await seedTestEmployee(basePrisma, {
        tenantId,
        name: 'Schedule Change Mechanic',
        role: 'MECHANIC',
        annualLeaveMinutes: 30000,
        hiredOn: new Date('2026-01-01T00:00:00.000Z'),
      });
      scheduleChangeEmployeeId = scheduleChangeEmployee.id;

      await basePrisma.employeeWorkSchedule.create({
        data: {
          tenant_id: tenantId,
          employee_id: scheduleChangeEmployeeId,
          effective_from: new Date('2026-09-14T00:00:00.000Z'),
          days: {
            create: Array.from({ length: 7 }, (_, index) => {
              const weekday = index + 1;
              const isWorking = weekday <= 6;
              return {
                weekday,
                is_working: isWorking,
                start_time: isWorking ? '08:00' : null,
                end_time: isWorking
                  ? weekday === 6
                    ? '12:00'
                    : '16:00'
                  : null,
                break_minutes: 0,
              };
            }),
          },
        },
      });

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
    it('GET /api/hr/me/leave initializes yearly balance and returns full annual allowance remaining', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(res.body.year).toBe(new Date().getUTCFullYear());
      expect(res.body.allowanceMinutes).toBe(HR_TEST_ANNUAL_LEAVE_MINUTES);
      expect(res.body.carryoverMinutes).toBe(0);
      expect(res.body.remainingMinutes).toBe(HR_TEST_ANNUAL_LEAVE_MINUTES);
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

    it('rejects leave on closed days (zero chargeable minutes) with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-08-30',
          endOn: '2026-08-30',
        })
        .expect(400);

      expect(res.body.message).toContain('zero chargeable minutes');
    });

    let createdBookingId: string;

    it('successfully books a work week and snapshots minutesCharged', async () => {
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
      expect(res.body.minutesCharged).toBe(HR_TEST_WEEK_LEAVE_MINUTES);
      createdBookingId = res.body.id;

      const getRes = await request(app.getHttpServer())
        .get('/api/hr/me/leave?year=2026')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(getRes.body.remainingMinutes).toBe(
        HR_TEST_REMAINING_AFTER_WEEK_MINUTES,
      );
      expect(getRes.body.bookings).toHaveLength(1);
      expect(getRes.body.bookings[0].id).toBe(createdBookingId);
    });

    it('rejects overlapping leave booking with 409 Conflict', async () => {
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

    it('rejects booking when minutesCharged exceeds remaining allowance with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .send({
          startOn: '2026-10-05',
          endOn: '2026-11-06',
        })
        .expect(409);

      expect(res.body.message).toContain('Not enough remaining leave time');
    });

    it('cancels leave booking and restores remaining minutes', async () => {
      const cancelRes = await request(app.getHttpServer())
        .post(`/api/hr/leave/${createdBookingId}/cancel`)
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(cancelRes.body.status).toBe('CANCELLED');

      const getRes = await request(app.getHttpServer())
        .get('/api/hr/me/leave?year=2026')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(200);

      expect(getRes.body.remainingMinutes).toBe(HR_TEST_ANNUAL_LEAVE_MINUTES);
    });

    it('employee cannot cancel another employee leave booking', async () => {
      const salesBookingRes = await request(app.getHttpServer())
        .post('/api/hr/me/leave')
        .set('Authorization', `Bearer ${salesAuthToken}`)
        .send({
          startOn: '2026-11-02',
          endOn: '2026-11-06',
        })
        .expect(201);

      const salesBookingId = salesBookingRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/hr/leave/${salesBookingId}/cancel`)
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(403);
    });
  });

  describe('Manager Leave Management & Team Queries', () => {
    let deskBookingId: string;

    it('charges different minutes before and after a schedule change', async () => {
      const beforeChange = await request(app.getHttpServer())
        .post('/api/hr/leave')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          employeeId: scheduleChangeEmployeeId,
          startOn: '2026-09-07',
          endOn: '2026-09-11',
        })
        .expect(201);

      const afterChange = await request(app.getHttpServer())
        .post('/api/hr/leave')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          employeeId: scheduleChangeEmployeeId,
          startOn: '2026-09-14',
          endOn: '2026-09-18',
        })
        .expect(201);

      expect(beforeChange.body.minutesCharged).toBe(2850);
      expect(afterChange.body.minutesCharged).toBe(2400);
    });

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
      expect(res.body.minutesCharged).toBe(HR_TEST_WEEK_LEAVE_MINUTES);
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

      expect(res.body.minutesCharged).toBe(HR_TEST_THREE_DAY_LEAVE_MINUTES);
      expect(res.body.note).toBe('Shortened trip');
    });

    it('OWNER can patch leave balance and sync current year allowance to employee', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/hr/employees/${deskEmployeeId}/leave-balance`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .send({
          year: 2026,
          allowanceMinutes: HR_TEST_ALLOWANCE_30_MINUTES,
          carryoverMinutes: HR_TEST_CARRYOVER_5_MINUTES,
        })
        .expect(200);

      expect(res.body.allowanceMinutes).toBe(HR_TEST_ALLOWANCE_30_MINUTES);
      expect(res.body.carryoverMinutes).toBe(HR_TEST_CARRYOVER_5_MINUTES);

      const empRes = await request(app.getHttpServer())
        .get(`/api/employees/${deskEmployeeId}`)
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(empRes.body.annualLeaveMinutes).toBe(HR_TEST_ALLOWANCE_30_MINUTES);
      expect(empRes.body.carryoverMinutes).toBe(HR_TEST_CARRYOVER_5_MINUTES);
      expect(empRes.body.leaveBalanceYear).toBe(2026);
    });

    it('GET /api/hr/leave is accessible by SALES and OWNER, but returns 403 for TECH', async () => {
      await request(app.getHttpServer())
        .get('/api/hr/leave?from=2026-09-01&to=2026-09-30')
        .set('Authorization', `Bearer ${techAuthToken}`)
        .expect(403);

      const salesRes = await request(app.getHttpServer())
        .get('/api/hr/leave?from=2026-09-01&to=2026-09-30')
        .set('Authorization', `Bearer ${salesAuthToken}`)
        .expect(200);

      expect(Array.isArray(salesRes.body)).toBe(true);
      expect(salesRes.body.length).toBeGreaterThanOrEqual(1);
      expect(salesRes.body[0].employee).toBeDefined();

      const ownerRes = await request(app.getHttpServer())
        .get('/api/hr/leave?from=2026-09-01&to=2026-09-30')
        .set('Authorization', `Bearer ${ownerAuthToken}`)
        .expect(200);

      expect(Array.isArray(ownerRes.body)).toBe(true);
    });
  });
});
