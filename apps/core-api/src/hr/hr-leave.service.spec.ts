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
    employee: { findFirst: jest.fn(), update: jest.fn() },
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
    countChargeableDays: jest.fn(),
    countChargeableDaysForTenant: jest.fn(),
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
        annual_leave_days: 25,
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
        annual_leave_days: 25,
      });
      await expect(
        service.createMyLeave({
          startOn: '2026-09-05',
          endOn: '2026-09-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects zero chargeable workdays with 400', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_days: 25,
      });
      mockWorkdayService.countChargeableDays.mockReturnValue(0);
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
        annual_leave_days: 25,
      });
      mockWorkdayService.countChargeableDays.mockReturnValue(5);
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

    it('rejects booking when daysCharged exceeds remaining leave with 409', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_days: 25,
      });
      mockWorkdayService.countChargeableDays.mockReturnValue(10);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        allowance_days: 25,
        carryover_days: 0,
      });
      mockPrisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days_charged: 20 },
      }); // remaining = 5

      await expect(
        service.createMyLeave({
          startOn: '2026-09-01',
          endOn: '2026-09-12',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('successfully creates booking and snapshots days_charged', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_days: 25,
      });
      mockWorkdayService.countChargeableDays.mockReturnValue(5);
      mockPrisma.leaveRequest.findFirst.mockResolvedValue(null);
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        allowance_days: 25,
        carryover_days: 0,
      });
      mockPrisma.leaveRequest.aggregate.mockResolvedValue({
        _sum: { days_charged: 0 },
      });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-pg-1' });
      mockPrisma.leaveRequest.create.mockResolvedValue({
        id: 'leave-1',
        employee_id: 'emp-1',
        start_on: new Date('2026-09-01T00:00:00.000Z'),
        end_on: new Date('2026-09-05T00:00:00.000Z'),
        status: LeaveRequestStatus.BOOKED,
        days_charged: 5,
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
      expect(result.daysCharged).toBe(5);
      expect(result.status).toBe('BOOKED');
    });
  });

  describe('getMyLeave', () => {
    it('returns yearly balance, remaining days, and bookings list', async () => {
      mockIdentityService.resolveMe.mockResolvedValue({
        id: 'emp-1',
        annual_leave_days: 25,
      });
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        id: 'bal-1',
        employee_id: 'emp-1',
        year: 2026,
        allowance_days: 25,
        carryover_days: 2,
      });
      mockPrisma.leaveRequest.findMany.mockResolvedValue([
        {
          id: 'l1',
          employee_id: 'emp-1',
          start_on: new Date('2026-06-01T00:00:00.000Z'),
          end_on: new Date('2026-06-05T00:00:00.000Z'),
          status: LeaveRequestStatus.BOOKED,
          days_charged: 5,
          note: null,
          created_by_user_id: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getMyLeave(2026);
      expect(result.year).toBe(2026);
      expect(result.allowanceDays).toBe(25);
      expect(result.carryoverDays).toBe(2);
      expect(result.remainingDays).toBe(22); // 25 + 2 - 5
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
        days_charged: 5,
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
    it('updates balance and writes employee annual_leave_days if year is current year', async () => {
      mockIdentityService.assertOwnerAdmin.mockReturnValue(undefined);
      mockPrisma.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        annual_leave_days: 25,
      });
      mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
        id: 'bal-1',
        employee_id: 'emp-1',
        year: 2026,
        allowance_days: 30,
        carryover_days: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.patchLeaveBalance('emp-1', {
        year: 2026,
        allowanceDays: 30,
        carryoverDays: 3,
      });

      expect(result.allowanceDays).toBe(30);
      expect(result.carryoverDays).toBe(3);
      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1' },
          data: { annual_leave_days: 30 },
        }),
      );
    });
  });
});
