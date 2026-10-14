import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HrWorkScheduleReader } from './hr-work-schedule-reader.service.js';
import { createSchedule } from './hr-work-schedule.spec.support.js';

describe('HrWorkScheduleReader', () => {
  let prisma: {
    employee: { findFirst: jest.Mock };
    employeeWorkSchedule: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let settingsService: { getOrCreateSettings: jest.Mock };
  let tenantContext: {
    getTenantId: jest.Mock;
    getAuthenticatedUser: jest.Mock;
  };
  let reader: HrWorkScheduleReader;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employee-1' }),
      },
      employeeWorkSchedule: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    settingsService = {
      getOrCreateSettings: jest
        .fn()
        .mockResolvedValue({ timezone: 'Europe/Vienna' }),
    };
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    };
    reader = new HrWorkScheduleReader(
      prisma as never,
      settingsService as never,
      tenantContext as never,
    );
  });

  describe('findForEmployee', () => {
    it('returns the version in force today as current', async () => {
      prisma.employeeWorkSchedule.findMany.mockResolvedValue([
        createSchedule('early', '2020-01-01'),
        createSchedule('later', '2099-01-01'),
      ]);

      const result = await reader.findForEmployee('employee-1');

      expect(result.current?.id).toBe('early');
      expect(result.history.map((version) => version.id)).toEqual([
        'early',
        'later',
      ]);
    });

    it('returns no current version when every version starts in the future', async () => {
      prisma.employeeWorkSchedule.findMany.mockResolvedValue([
        createSchedule('future', '2099-01-01'),
      ]);

      const result = await reader.findForEmployee('employee-1');

      expect(result.current).toBeNull();
    });

    it('rejects roles that cannot read schedules before loading history', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({ role: 'TECH' });

      await expect(reader.findForEmployee('employee-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.employeeWorkSchedule.findMany).not.toHaveBeenCalled();
    });

    it('rejects an employee outside the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(reader.findForEmployee('employee-9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.employeeWorkSchedule.findMany).not.toHaveBeenCalled();
    });
  });

  describe('resolveScheduleForDate', () => {
    it('returns the version effective on the requested date', async () => {
      prisma.employeeWorkSchedule.findFirst.mockResolvedValue(createSchedule());

      await expect(
        reader.resolveScheduleForDate('tenant-1', 'employee-1', '2026-05-01'),
      ).resolves.toEqual(expect.objectContaining({ id: 'schedule-1' }));
      expect(prisma.employeeWorkSchedule.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-1',
            employee_id: 'employee-1',
            effective_from: { lte: new Date('2026-05-01T00:00:00.000Z') },
          },
        }),
      );
    });

    it('throws BadRequest when no version covers the date', async () => {
      await expect(
        reader.resolveScheduleForDate('tenant-1', 'employee-1', '2026-05-01'),
      ).rejects.toThrow(
        new BadRequestException(
          'No work schedule found for employee employee-1 on 2026-05-01',
        ),
      );
    });
  });

  describe('getCurrentAverageWorkdayMinutes', () => {
    it('averages the expected minutes of the working days in the current version', async () => {
      prisma.employeeWorkSchedule.findFirst.mockResolvedValue(createSchedule());

      await expect(
        reader.getCurrentAverageWorkdayMinutes(
          'tenant-1',
          'employee-1',
          'Europe/Vienna',
        ),
      ).resolves.toBe(570);
    });
  });
});
