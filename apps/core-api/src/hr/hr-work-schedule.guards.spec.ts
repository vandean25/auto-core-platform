import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertAuthorizedScheduleSite,
  assertCanReadSchedules,
  assertScheduleEmployeeExists,
} from './hr-work-schedule.guards.js';

describe('hr-work-schedule.guards', () => {
  describe('assertCanReadSchedules', () => {
    it.each(['OWNER', 'ADMIN', 'SALES'])(
      'allows %s to read schedules',
      (role) => {
        expect(() => assertCanReadSchedules(role)).not.toThrow();
      },
    );

    it.each([undefined, 'TECH'])(
      'rejects role %s from reading schedules',
      (role) => {
        expect(() => assertCanReadSchedules(role)).toThrow(ForbiddenException);
      },
    );
  });

  describe('assertScheduleEmployeeExists', () => {
    it('rejects an employee that is not in the tenant', async () => {
      const prisma = {
        employee: { findFirst: jest.fn().mockResolvedValue(null) },
      };

      await expect(
        assertScheduleEmployeeExists(prisma as never, 'employee-9', 'tenant-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'employee-9', tenant_id: 'tenant-1' },
        select: { id: true },
      });
    });

    it('accepts an employee in the tenant', async () => {
      const prisma = {
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: 'employee-1' }),
        },
      };

      await expect(
        assertScheduleEmployeeExists(prisma as never, 'employee-1', 'tenant-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertAuthorizedScheduleSite', () => {
    const siteContext = {
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };

    it('rejects a site outside the caller authorized sites', async () => {
      await expect(
        assertAuthorizedScheduleSite(siteContext as never, 'site-2'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('accepts an authorized site', async () => {
      await expect(
        assertAuthorizedScheduleSite(siteContext as never, 'site-1'),
      ).resolves.toBeUndefined();
    });
  });
});
