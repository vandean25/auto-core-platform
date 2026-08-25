import { ConflictException, ForbiddenException } from '@nestjs/common';
import { HrWorkScheduleService } from './hr-work-schedule.service';
import { averageExpectedMinutesPerWorkday } from './hr-work-schedule.time';

const scheduleDays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isWorking: weekday <= 5,
  startTime: weekday <= 5 ? '07:30' : null,
  endTime: weekday <= 5 ? '17:00' : null,
  breakMinutes: 0,
}));

function createPayload(effectiveFrom = '2026-09-01') {
  return { effectiveFrom, days: scheduleDays };
}

function createSchedule(id = 'schedule-1', effectiveFrom = '2026-01-01') {
  return {
    id,
    tenant_id: 'tenant-1',
    employee_id: 'employee-1',
    effective_from: new Date(`${effectiveFrom}T00:00:00.000Z`),
    days: scheduleDays.map((day, index) => ({
      id: `day-${index + 1}`,
      tenant_id: 'tenant-1',
      schedule_id: id,
      weekday: day.weekday,
      is_working: day.isWorking,
      start_time: day.startTime,
      end_time: day.endTime,
      break_minutes: day.breakMinutes,
    })),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('HrWorkScheduleService', () => {
  it('uses the 480-minute fallback when no opening hours exist', () => {
    const service = new HrWorkScheduleService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const days = service.mapOpeningHoursToScheduleDays([]);

    expect(days).toHaveLength(7);
    expect(days.every((day) => !day.is_working)).toBe(true);
    expect(averageExpectedMinutesPerWorkday(days)).toBe(480);
  });

  describe('REST API', () => {
    const prisma = {
      employee: { findFirst: jest.fn() },
      employeeWorkSchedule: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      employeeWorkScheduleDay: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const settingsService = {
      getOrCreateSettings: jest.fn(),
    };
    const identityService = {
      assertOwnerAdmin: jest.fn(),
    };
    const tenantContext = {
      getTenantId: jest.fn(),
      getAuthenticatedUser: jest.fn(),
    };

    let service: HrWorkScheduleService;

    beforeEach(() => {
      jest.clearAllMocks();
      tenantContext.getTenantId.mockResolvedValue('tenant-1');
      tenantContext.getAuthenticatedUser.mockReturnValue({ role: 'ADMIN' });
      settingsService.getOrCreateSettings.mockResolvedValue({
        timezone: 'Europe/Vienna',
      });
      service = new HrWorkScheduleService(
        prisma as never,
        settingsService as never,
        identityService as never,
        tenantContext as never,
      );
    });

    it('returns schedule history and resolves current by tenant-local date', async () => {
      const history = [
        createSchedule('schedule-1', '2026-01-01'),
        createSchedule('schedule-2', '2026-12-01'),
      ];
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1' });
      prisma.employeeWorkSchedule.findMany.mockResolvedValue(history);

      const result = await service.findForEmployee('employee-1');

      expect(result.history).toHaveLength(2);
      expect(result.current?.id).toBe('schedule-1');
    });

    it('rejects duplicate effective dates with ConflictException', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1' });
      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          employeeWorkSchedule: {
            findFirst: jest.fn().mockResolvedValue(undefined),
            create: jest.fn().mockRejectedValue({
              code: 'P2002',
            }),
          },
        }),
      );

      await expect(
        service.createForEmployee('employee-1', createPayload()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects schedule versions that are not later than the latest version', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1' });
      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          employeeWorkSchedule: {
            findFirst: jest.fn().mockResolvedValue({
              effective_from: new Date('2026-09-01T00:00:00.000Z'),
            }),
            create: jest.fn(),
          },
        }),
      );

      await expect(
        service.createForEmployee('employee-1', createPayload('2026-08-01')),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates weekday rows without changing effectiveFrom', async () => {
      const existing = createSchedule();
      prisma.employeeWorkSchedule.findFirst.mockResolvedValue(existing);
      const update = jest.fn().mockResolvedValue(existing);
      const findFirst = jest.fn().mockResolvedValue(existing);
      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          employeeWorkSchedule: {
            update,
            findFirst,
          },
          employeeWorkScheduleDay: {
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        }),
      );

      await service.updateForEmployee('employee-1', 'schedule-1', {
        days: scheduleDays,
        effectiveFrom: '2099-01-01',
      });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id_id: {
              tenant_id: 'tenant-1',
              id: 'schedule-1',
            },
          },
          data: expect.not.objectContaining({
            effective_from: expect.anything(),
          }),
        }),
      );
    });

    it('requires owner or admin for schedule writes', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1' });
      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          employeeWorkSchedule: {
            findFirst: jest.fn().mockResolvedValue(undefined),
            create: jest.fn().mockResolvedValue(createSchedule()),
          },
        }),
      );

      await service.createForEmployee('employee-1', createPayload());
      expect(identityService.assertOwnerAdmin).toHaveBeenCalled();

      prisma.employeeWorkSchedule.findFirst.mockResolvedValue(createSchedule());
      prisma.$transaction.mockImplementation(async (callback) =>
        callback({
          employeeWorkSchedule: {
            update: jest.fn().mockResolvedValue(createSchedule()),
            findFirst: jest.fn().mockResolvedValue(createSchedule()),
          },
          employeeWorkScheduleDay: {
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        }),
      );

      await service.updateForEmployee('employee-1', 'schedule-1', {
        days: scheduleDays,
      });
      expect(identityService.assertOwnerAdmin).toHaveBeenCalledTimes(2);
    });

    it('allows schedule reads only for OWNER, ADMIN, and SALES', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({ role: 'TECH' });

      await expect(service.findForEmployee('employee-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
