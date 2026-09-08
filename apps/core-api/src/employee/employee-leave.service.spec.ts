import { EmployeeRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HrWorkScheduleService } from '../hr/hr-work-schedule.service';
import { EmployeeLeaveService } from './employee-leave.service';

describe('EmployeeLeaveService', () => {
  let service: EmployeeLeaveService;
  const mockPrisma = {
    site: {
      findFirst: jest.fn(),
    },
    employeeLeaveBalance: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    leaveRequest: {
      groupBy: jest.fn(),
    },
  };

  const mockScheduleService = {
    seedInitialSchedule: jest.fn(),
    defaultAnnualLeaveMinutes: jest.fn(),
  };

  const baseEmployee = {
    id: 'emp-1',
    name: 'Jane Doe',
    role: EmployeeRole.MECHANIC,
    is_active: true,
    sort_order: 1,
    user_id: null,
    mother_language_code: null,
    hired_on: new Date('2024-03-01T00:00:00.000Z'),
    annual_leave_minutes: 12875,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.site.findFirst.mockResolvedValue({
      timezone: 'Europe/Vienna',
    });
    mockPrisma.employeeLeaveBalance.findMany.mockResolvedValue([]);
    mockPrisma.leaveRequest.groupBy.mockResolvedValue([]);
    service = new EmployeeLeaveService(
      mockPrisma as unknown as PrismaService,
      mockScheduleService as unknown as HrWorkScheduleService,
    );
  });

  it('resolves site timezone and calculates current local year and date', async () => {
    const year = await service.getCurrentLocalYear('tenant-1');
    const date = await service.getCurrentLocalDate('tenant-1');

    expect(typeof year).toBe('number');
    expect(year).toBeGreaterThanOrEqual(2026);
    expect(date instanceof Date).toBe(true);
    expect(mockPrisma.site.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', code: 'MAIN', is_active: true },
      select: { timezone: true },
    });
  });

  it('returns empty array when attachRemaining receives no employees', async () => {
    const result = await service.attachRemaining('tenant-1', []);
    expect(result).toEqual([]);
    expect(mockPrisma.employeeLeaveBalance.findMany).not.toHaveBeenCalled();
  });

  it('attaches remaining leave minutes from balance and booked requests', async () => {
    mockPrisma.employeeLeaveBalance.findMany.mockResolvedValue([
      {
        employee_id: 'emp-1',
        year: 2026,
        allowance_minutes: 12875,
        carryover_minutes: 1030,
      },
    ]);
    mockPrisma.leaveRequest.groupBy.mockResolvedValue([
      { employee_id: 'emp-1', _sum: { minutes_charged: 2850 } },
    ]);

    const result = await service.attachRemaining('tenant-1', [baseEmployee]);

    expect(result[0].remainingLeaveMinutes).toBe(11055);
    expect(result[0].carryoverMinutes).toBe(1030);
    expect(result[0].leaveBalanceYear).toBe(2026);
  });

  it('seeds schedule and computes default annual leave minutes', async () => {
    mockScheduleService.seedInitialSchedule.mockResolvedValue({
      id: 'sched-1',
      days: [
        {
          weekday: 1,
          is_working: true,
          start_time: '07:30',
          end_time: '17:00',
          break_minutes: 0,
        },
      ],
    });
    mockScheduleService.defaultAnnualLeaveMinutes.mockReturnValue(12875);

    const tx = {} as any;
    const effectiveFrom = new Date('2026-03-01T00:00:00.000Z');

    const minutes = await service.seedInitialScheduleAndAllowance(
      tx,
      'tenant-1',
      'emp-1',
      effectiveFrom,
    );

    expect(minutes).toBe(12875);
    expect(mockScheduleService.seedInitialSchedule).toHaveBeenCalledWith(
      tx,
      'tenant-1',
      'emp-1',
      effectiveFrom,
    );
  });

  it('respects requested annual leave minutes if provided', async () => {
    mockScheduleService.seedInitialSchedule.mockResolvedValue({
      id: 'sched-1',
      days: [],
    });

    const tx = {} as any;
    const effectiveFrom = new Date('2026-03-01T00:00:00.000Z');

    const minutes = await service.seedInitialScheduleAndAllowance(
      tx,
      'tenant-1',
      'emp-1',
      effectiveFrom,
      15000,
    );

    expect(minutes).toBe(15000);
    expect(
      mockScheduleService.defaultAnnualLeaveMinutes,
    ).not.toHaveBeenCalled();
  });

  it('upserts current year leave balance', async () => {
    const tx = {
      employeeLeaveBalance: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;

    await service.updateCurrentYearLeaveBalance(tx, 'tenant-1', 'emp-1', 14000);

    expect(tx.employeeLeaveBalance.upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_employee_id_year: {
          tenant_id: 'tenant-1',
          employee_id: 'emp-1',
          year: expect.any(Number),
        },
      },
      create: {
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        year: expect.any(Number),
        allowance_minutes: 14000,
        carryover_minutes: 0,
      },
      update: { allowance_minutes: 14000 },
    });
  });
});
