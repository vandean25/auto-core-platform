import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LeaveRequestStatus } from '@prisma/client';
import { HrLeaveService } from './hr-leave.service';

describe('HrLeaveService', () => {
  let service: HrLeaveService;
  const mockPrisma = {
    employee: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    employeeLeaveBalance: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    leaveRequest: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };
  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      userId: 'fb-user-1',
      email: 'test@example.com',
      role: 'ADMIN',
    }),
  };
  const mockIdentityService = {
    resolveMe: jest.fn(),
    assertOwnerAdmin: jest.fn(),
  };
  const mockWorkdayService = {
    loadTenantCalendar: jest.fn().mockResolvedValue({
      timezone: 'Europe/Vienna',
      openingHours: [],
      holidays: [],
    }),
    countChargeableMinutes: jest.fn(),
    countChargeableMinutesForTenant: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HrLeaveService(
      mockPrisma as any,
      mockTenantContext as any,
      mockIdentityService as any,
      mockWorkdayService as any,
    );
  });

  describe('createMyLeave / createLeaveBooking', () => {
    it('rejects date range spanning two calendar years with 400', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      await expect(
        service.createMyLeave({
          startOn: '2026-12-28',
          endOn: '2027-01-04',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects endOn before startOn with 400', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      await expect(
        service.createMyLeave({
          startOn: '2026-09-05',
          endOn: '2026-09-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects zero chargeable minutes with 400', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      mockWorkdayService.countChargeableMinutes.mockResolvedValue(0);
      await expect(
        service.createMyLeave({
          startOn: '2026-08-30',
          endOn: '2026-08-30',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects overlapping BOOKED range with 409', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      mockWorkdayService.countChargeableMinutes.mockResolvedValue(2850);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({
        id: 'existing-booking',
      });

      await expect(
        service.createMyLeave({
          startOn: '2026-09-01',
          endOn: '2026-09-05',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects booking when minutesCharged exceeds remaining leave with 409', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      mockWorkdayService.countChargeableMinutes.mockResolvedValue(5150);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        allowance_minutes: 12875,
        carryover_minutes: 0,
      });
      mockPrisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { minutes_charged: 10300 },
      });

      await expect(
        service.createMyLeave({
          startOn: '2026-09-01',
          endOn: '2026-09-12',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('successfully creates booking and snapshots minutes_charged', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      mockWorkdayService.countChargeableMinutes.mockResolvedValue(2850);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        allowance_minutes: 12875,
        carryover_minutes: 0,
      });
      mockPrisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { minutes_charged: 0 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-pg-1' });
      mockPrisma.leaveRequest.create.mockResolvedValue({
        id: 'leave-1',
        employee_id: 'emp-1',
        start_on: new Date('2026-09-01T00:00:00.000Z'),
        end_on: new Date('2026-09-05T00:00:00.000Z'),
        status: LeaveRequestStatus.BOOKED,
        minutes_charged: 2850,
        note: 'Holiday',
        created_by_user_id: 'user-pg-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createMyLeave({
        startOn: '2026-09-01',
        endOn: '2026-09-05',
        note: 'Holiday',
      });
      expect(result.id).toBe('leave-1');
      expect(result.minutesCharged).toBe(2850);
      expect(result.status).toBe('BOOKED');
    });
  });

  describe('getMyLeave', () => {
    it('returns yearly balance, remaining minutes, and bookings list', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        id: 'bal-1',
        employee_id: 'emp-1',
        year: 2026,
        allowance_minutes: 12875,
        carryover_minutes: 1030,
      });
      mockPrisma.leaveRequest.findMany.mockResolvedValue([
        {
          id: 'l1',
          employee_id: 'emp-1',
          start_on: new Date('2026-06-01T00:00:00.000Z'),
          end_on: new Date('2026-06-05T00:00:00.000Z'),
          status: LeaveRequestStatus.BOOKED,
          minutes_charged: 2850,
          note: null,
          created_by_user_id: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getMyLeave(2026);
      expect(result.year).toBe(2026);
      expect(result.allowanceMinutes).toBe(12875);
      expect(result.carryoverMinutes).toBe(1030);
      expect(result.remainingMinutes).toBe(11055);
      expect(result.bookings).toHaveLength(1);
    });
  });

  describe('cancelLeave', () => {
    it('allows an employee to cancel own future leave', async () => {
      mockTenantContext.getAuthenticatedUser.mockReturnValue({
        role: 'SALES',
      });
      mockIdentityService.resolveMe.mockResolvedValue({ id: 'emp-1' });
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({
        id: 'leave-1',
        employee_id: 'emp-1',
        start_on: new Date('2026-12-01T00:00:00.000Z'),
        status: LeaveRequestStatus.BOOKED,
      });
      mockPrisma.leaveRequest.update.mockResolvedValue({
        id: 'leave-1',
        employee_id: 'emp-1',
        start_on: new Date('2026-12-01T00:00:00.000Z'),
        end_on: new Date('2026-12-05T00:00:00.000Z'),
        status: LeaveRequestStatus.CANCELLED,
        minutes_charged: 2850,
        note: null,
        created_by_user_id: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.cancelLeave('leave-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('rejects when non-admin employee tries to cancel another employee leave', async () => {
      mockTenantContext.getAuthenticatedUser.mockReturnValue({
        role: 'SALES',
      });
      mockIdentityService.resolveMe.mockResolvedValue({ id: 'emp-1' });
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({
        id: 'leave-2',
        employee_id: 'emp-2',
        start_on: new Date('2026-12-01T00:00:00.000Z'),
        status: LeaveRequestStatus.BOOKED,
      });

      await expect(service.cancelLeave('leave-2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('patchLeaveBalance', () => {
    it('updates balance and writes employee annual_leave_minutes if year is current year', async () => {
      mockIdentityService.assertOwnerAdmin.mockReturnValue(undefined);
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        annual_leave_minutes: 12875,
      });
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        id: 'bal-1',
        employee_id: 'emp-1',
        year: 2026,
        allowance_minutes: 15450,
        carryover_minutes: 1545,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.employee.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.patchLeaveBalance('emp-1', {
        year: 2026,
        allowanceMinutes: 15450,
        carryoverMinutes: 1545,
      });

      expect(result.allowanceMinutes).toBe(15450);
      expect(result.carryoverMinutes).toBe(1545);
      expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1', tenant_id: 'tenant-1' },
          data: { annual_leave_minutes: 15450 },
        }),
      );
    });
  });
});
