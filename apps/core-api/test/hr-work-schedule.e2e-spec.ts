import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { createGlobalValidationPipe } from '../src/common';
import { DashboardRealtimeService } from '../src/dashboard-realtime/dashboard-realtime.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestEmployee,
  seedTestTenantMember,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

const scheduleDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isWorking: weekday <= 5,
  startTime: weekday <= 5 ? '07:30' : null,
  endTime: weekday <= 5 ? '17:00' : null,
  breakMinutes: 0,
}));

describe('HR Work Schedule API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let ownerToken: string;
  let adminToken: string;
  let salesToken: string;
  let techToken: string;
  let employeeId: string;
  let foreignTenantId: string;
  let foreignEmployeeId: string;
  let foreignScheduleId: string;
  let realtimeService: DashboardRealtimeService;
  let emitEntityUpdatedSpy: jest.SpyInstance;

  async function createOwnerVersion(effectiveFrom: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom, days: scheduleDays })
      .expect(201);

    return response.body as { id: string };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);
    realtimeService = app.get(DashboardRealtimeService);
    emitEntityUpdatedSpy = jest.spyOn(realtimeService, 'emitEntityUpdated');
    const tenant = await createTestTenant(prisma, 'hr-schedule');
    tenantId = tenant.tenantId;
    ownerToken = createTestAuthToken(authService, tenant);
    const foreignTenant = await createTestTenant(prisma, 'hr-schedule-foreign');
    foreignTenantId = foreignTenant.tenantId;

    await runWithTenantContext(tenantId, async () => {
      const salesUser = await prisma.user.create({
        data: {
          firebaseUid: `e2e-sales-schedule-${Date.now()}`,
          email: `e2e-sales-schedule-${Date.now()}@test.local`,
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

      const adminUser = await prisma.user.create({
        data: {
          firebaseUid: `e2e-admin-schedule-${Date.now()}`,
          email: `e2e-admin-schedule-${Date.now()}@test.local`,
        },
      });
      await seedTestTenantMember(prisma, {
        tenantId,
        userId: adminUser.id,
        role: 'ADMIN',
      });
      adminToken = authService.createTestToken({
        sub: adminUser.firebaseUid,
        email: adminUser.email,
        tenantId,
        role: 'ADMIN',
      });

      const techUser = await prisma.user.create({
        data: {
          firebaseUid: `e2e-tech-schedule-${Date.now()}`,
          email: `e2e-tech-schedule-${Date.now()}@test.local`,
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

      const employee = await seedTestEmployee(prisma, {
        tenantId,
        name: 'Schedule Employee',
        role: 'SERVICE_ADVISOR',
        userId: salesUser.id,
        hiredOn: new Date('2026-01-01T00:00:00.000Z'),
      });
      employeeId = employee.id;
    });

    await runWithTenantContext(foreignTenantId, async () => {
      const foreignEmployee = await seedTestEmployee(prisma, {
        tenantId: foreignTenantId,
        name: 'Foreign Schedule Employee',
        role: 'SERVICE_ADVISOR',
        hiredOn: new Date('2026-01-01T00:00:00.000Z'),
      });
      foreignEmployeeId = foreignEmployee.id;
      const foreignSchedule = await prisma.employeeWorkSchedule.findFirst({
        where: {
          tenant_id: foreignTenantId,
          employee_id: foreignEmployeeId,
        },
      });
      if (!foreignSchedule) {
        throw new Error('Foreign schedule fixture was not created');
      }
      foreignScheduleId = foreignSchedule.id;
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
    }
    if (foreignTenantId) {
      await cleanupTestTenantGraph(prisma, foreignTenantId);
    }
    await teardownTestApp(app);
  });

  it('returns current and historical schedule versions to SALES', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);

    expect(response.body.current.effectiveFrom).toBe('2026-01-01');
    expect(response.body.history).toHaveLength(1);
  });

  it('creates a new schedule version for OWNER', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2026-09-01', days: scheduleDays })
      .expect(201);

    expect(response.body.effectiveFrom).toBe('2026-09-01');
    expect(response.body.days).toHaveLength(7);
  });

  it('rejects duplicate effectiveFrom for the employee', async () => {
    await createOwnerVersion('2026-09-15');
    const response = await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2026-09-15', days: scheduleDays })
      .expect(409);

    expect(response.body.message).toContain('effectiveFrom');
  });

  it('rejects schedule writes from SALES while allowing reads', async () => {
    await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ effectiveFrom: '2026-10-01', days: scheduleDays })
      .expect(403);
  });

  it('rejects schedule corrections from SALES', async () => {
    const { id: scheduleId } = await createOwnerVersion('2026-11-01');

    await request(app.getHttpServer())
      .patch(`/api/hr/employees/${employeeId}/work-schedule/${scheduleId}`)
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ days: scheduleDays })
      .expect(403);
  });

  it('requires exactly seven weekday rows', async () => {
    await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2026-10-01', days: scheduleDays.slice(0, 6) })
      .expect(400);
  });

  it('rejects more than seven weekday rows', async () => {
    await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        effectiveFrom: '2027-02-01',
        days: [...scheduleDays, { ...scheduleDays[0] }],
      })
      .expect(400);
  });

  it('patches times without changing effectiveFrom', async () => {
    const { id: scheduleId } = await createOwnerVersion('2027-01-01');

    const correctedDays = scheduleDays.map((day) =>
      day.weekday === 1 ? { ...day, startTime: '08:00' } : day,
    );
    const response = await request(app.getHttpServer())
      .patch(`/api/hr/employees/${employeeId}/work-schedule/${scheduleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        effectiveFrom: '2099-01-01',
        days: correctedDays,
      })
      .expect(200);

    expect(response.body.effectiveFrom).toBe('2027-01-01');
    expect(response.body.days[0].startTime).toBe('08:00');
  });

  it('rejects schedule reads from TECH', async () => {
    await request(app.getHttpServer())
      .get(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${techToken}`)
      .expect(403);
  });

  it('creates a new schedule version for ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ effectiveFrom: '2028-01-01', days: scheduleDays })
      .expect(201);

    expect(response.body.effectiveFrom).toBe('2028-01-01');
    expect(response.body.days).toHaveLength(7);
  });

  it('rejects invalid HH:MM times', async () => {
    const invalidDays = scheduleDays.map((day) =>
      day.weekday === 1 ? { ...day, startTime: '25:00' } : day,
    );

    await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2028-02-01', days: invalidDays })
      .expect(400);
  });

  it('accepts omitted times on non-working days', async () => {
    const daysWithOmittedTimes = scheduleDays.map((day) => {
      if (day.isWorking) {
        return day;
      }
      const { startTime: _startTime, endTime: _endTime, ...rest } = day;
      return rest;
    });

    await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2028-03-01', days: daysWithOmittedTimes })
      .expect(201);
  });

  it('emits EMPLOYEE_WORK_SCHEDULE realtime events on POST and PATCH', async () => {
    emitEntityUpdatedSpy.mockClear();

    const createResponse = await request(app.getHttpServer())
      .post(`/api/hr/employees/${employeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2028-04-01', days: scheduleDays })
      .expect(201);

    expect(emitEntityUpdatedSpy).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        type: 'EMPLOYEE_WORK_SCHEDULE',
        action: 'CREATED',
        entityId: createResponse.body.id,
      }),
    );

    emitEntityUpdatedSpy.mockClear();

    await request(app.getHttpServer())
      .patch(
        `/api/hr/employees/${employeeId}/work-schedule/${createResponse.body.id}`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ days: scheduleDays })
      .expect(200);

    expect(emitEntityUpdatedSpy).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        type: 'EMPLOYEE_WORK_SCHEDULE',
        action: 'UPDATED',
        entityId: createResponse.body.id,
      }),
    );
  });

  it('keeps schedule reads and writes inside the authenticated tenant', async () => {
    await request(app.getHttpServer())
      .get(`/api/hr/employees/${foreignEmployeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/hr/employees/${foreignEmployeeId}/work-schedule`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ effectiveFrom: '2027-03-01', days: scheduleDays })
      .expect(404);

    await request(app.getHttpServer())
      .patch(
        `/api/hr/employees/${foreignEmployeeId}/work-schedule/${foreignScheduleId}`,
      )
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ days: scheduleDays })
      .expect(404);
  });
});
