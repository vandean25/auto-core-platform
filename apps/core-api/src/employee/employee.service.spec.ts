import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeRole, Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { formatLocalDate } from '../workshop/workshop-planner.time';
import { EmployeeService } from './employee.service';

const mockPrisma = {
  employee: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findFirstOrThrow: jest.fn(),
    deleteMany: jest.fn(),
  },
  employeeLeaveBalance: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
  },
  leaveRequest: {
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  attendanceEvent: {
    count: jest.fn(),
  },
  workshopTask: {
    count: jest.fn(),
  },
  workshopMedia: {
    count: jest.fn(),
  },
  workshopVoiceNoteDraft: {
    count: jest.fn(),
  },
  laborEntry: {
    count: jest.fn(),
  },
  site: {
    findFirst: jest.fn(),
  },
  workshopOrder: {
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockScheduleService = {
  seedInitialSchedule: jest.fn(),
  defaultAnnualLeaveMinutes: jest.fn(),
};

describe('EmployeeService', () => {
  let service: EmployeeService;
  const mockTenantContext = {
    getAuthenticatedUser: jest.fn(),
    getTenantId: jest.fn(),
  };

  const baseEmployee = {
    id: 'emp-1',
    name: 'Jane Doe',
    role: EmployeeRole.MECHANIC,
    is_active: true,
    sort_order: 1,
    user_id: null,
    hired_on: new Date('2024-03-01T00:00:00.000Z'),
    annual_leave_minutes: 12875,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'user-1',
      email: 'admin@example.com',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    mockTenantContext.getTenantId.mockResolvedValue('tenant-1');
    mockPrisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof mockPrisma) => unknown) =>
        callback(mockPrisma),
    );
    mockPrisma.site.findFirst.mockResolvedValue({
      timezone: 'Europe/Vienna',
    });
    mockPrisma.employeeLeaveBalance.findMany.mockResolvedValue([]);
    mockPrisma.leaveRequest.groupBy.mockResolvedValue([]);
    mockPrisma.employeeLeaveBalance.upsert.mockResolvedValue({
      id: 'balance-1',
      employee_id: 'emp-1',
      year: 2026,
      allowance_minutes: 12875,
      carryover_minutes: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    mockPrisma.employee.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.employee.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.attendanceEvent.count.mockResolvedValue(0);
    mockPrisma.workshopTask.count.mockResolvedValue(0);
    mockPrisma.workshopMedia.count.mockResolvedValue(0);
    mockPrisma.workshopVoiceNoteDraft.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(0);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);
    mockPrisma.employeeLeaveBalance.count.mockResolvedValue(0);
    service = new EmployeeService(
      mockPrisma as unknown as PrismaService,
      mockTenantContext as unknown as TenantContextService,
      mockScheduleService as any,
    );
  });

  it('lists active employees by default', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      skip: 0,
      take: 25,
    });
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    });
  });

  it('supports role and includeInactive filters', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    await service.findAll({
      role: EmployeeRole.MECHANIC,
      includeInactive: true,
      page: 2,
      limit: 10,
    });

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: 'tenant-1', role: EmployeeRole.MECHANIC },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('exposes userId (null) in mapped response when not linked', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].userId).toBeNull();
  });

  it('exposes userId in mapped response when linked', async () => {
    const linkedEmployee = { ...baseEmployee, user_id: 'user-uuid-abc' };
    mockPrisma.employee.findMany.mockResolvedValue([linkedEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].userId).toBe('user-uuid-abc');
  });

  it('maps hiredOn, annualLeaveMinutes, and remainingLeaveMinutes', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);
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

    const result = await service.findAll({});

    expect(result.data[0].hiredOn).toBe('2024-03-01');
    expect(result.data[0].annualLeaveMinutes).toBe(12875);
    expect(result.data[0].carryoverMinutes).toBe(1030);
    expect(result.data[0].leaveBalanceYear).toBe(2026);
    expect(result.data[0].remainingLeaveMinutes).toBe(11055);
    expect(mockPrisma.employeeLeaveBalance.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        employee_id: { in: ['emp-1'] },
        year: 2026,
      },
      select: {
        employee_id: true,
        year: true,
        allowance_minutes: true,
        carryover_minutes: true,
      },
    });
    expect(mockPrisma.leaveRequest.groupBy).toHaveBeenCalledWith({
      by: ['employee_id'],
      where: {
        tenant_id: 'tenant-1',
        employee_id: { in: ['emp-1'] },
        status: 'BOOKED',
        start_on: {
          gte: new Date(Date.UTC(2026, 0, 1)),
          lt: new Date(Date.UTC(2027, 0, 1)),
        },
      },
      _sum: { minutes_charged: true },
    });
    expect(mockPrisma.site.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', code: 'MAIN', is_active: true },
      select: { timezone: true },
    });
  });

  it('returns annual allowance when no current-year balance exists', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].carryoverMinutes).toBe(0);
    expect(result.data[0].leaveBalanceYear).toBe(2026);
    expect(result.data[0].remainingLeaveMinutes).toBe(12875);
  });

  it('persists hire and leave fields when creating an employee', async () => {
    const createdEmployee = {
      ...baseEmployee,
      id: 'emp-new',
      hired_on: new Date('2026-02-03T00:00:00.000Z'),
      annual_leave_minutes: 0,
    };
    const updatedEmployee = {
      ...createdEmployee,
      annual_leave_minutes: 15450,
    };
    mockPrisma.employee.create.mockResolvedValue(createdEmployee);
    mockPrisma.employee.findFirstOrThrow.mockResolvedValue(updatedEmployee);
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

    await service.create({
      name: 'New Mechanic',
      role: EmployeeRole.MECHANIC,
      hiredOn: '2026-02-03',
      annualLeaveMinutes: 15450,
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockScheduleService.seedInitialSchedule).toHaveBeenCalledWith(
      mockPrisma,
      'tenant-1',
      'emp-new',
      new Date('2026-02-03T00:00:00.000Z'),
    );
    expect(mockPrisma.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          hired_on: new Date('2026-02-03T00:00:00.000Z'),
          annual_leave_minutes: 0,
        }),
      }),
    );
    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-new', tenant_id: 'tenant-1' },
        data: { annual_leave_minutes: 15450 },
      }),
    );
  });

  it('seeds a schedule from the tenant-local current date when hire date is omitted', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-02T01:00:00.000Z'));
    try {
      mockPrisma.site.findFirst.mockResolvedValue({
        timezone: 'America/Los_Angeles',
      });
      const createdEmployee = {
        ...baseEmployee,
        id: 'emp-new',
        hired_on: null,
        annual_leave_minutes: 0,
      };
      mockPrisma.employee.create.mockResolvedValue(createdEmployee);
      mockPrisma.employee.findFirstOrThrow.mockResolvedValue({
        ...createdEmployee,
        annual_leave_minutes: 12875,
      });
      mockScheduleService.seedInitialSchedule.mockResolvedValue({
        id: 'sched-1',
        days: [],
      });
      mockScheduleService.defaultAnnualLeaveMinutes.mockReturnValue(12875);

      await service.create({
        name: 'Local Date Mechanic',
        role: EmployeeRole.MECHANIC,
      });

      expect(mockScheduleService.seedInitialSchedule).toHaveBeenCalledWith(
        mockPrisma,
        'tenant-1',
        'emp-new',
        new Date('2026-01-01T00:00:00.000Z'),
      );
      expect(
        mockScheduleService.defaultAnnualLeaveMinutes,
      ).toHaveBeenCalledWith(480);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects SALES when updating hire or leave fields', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'sales-1',
      email: 'sales@example.com',
      tenantId: 'tenant-1',
      role: 'SALES',
    });
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);

    await expect(
      service.update('emp-1', { annualLeaveMinutes: 15450 }),
    ).rejects.toThrow('Tenant admin access is required.');
    await expect(
      service.update('emp-1', { hiredOn: '2026-05-01' }),
    ).rejects.toThrow('Tenant admin access is required.');
  });

  it('rejects SALES when creating an employee with hire or leave fields', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'sales-1',
      email: 'sales@example.com',
      tenantId: 'tenant-1',
      role: 'SALES',
    });

    await expect(
      service.create({
        name: 'New',
        role: EmployeeRole.OFFICE,
        annualLeaveMinutes: 15450,
      }),
    ).rejects.toThrow('Tenant admin access is required.');
    await expect(
      service.create({
        name: 'New',
        role: EmployeeRole.OFFICE,
        hiredOn: '2026-05-01',
      }),
    ).rejects.toThrow('Tenant admin access is required.');
  });

  it('allows SALES to update roster fields without tenant admin access', async () => {
    mockTenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'sales-1',
      email: 'sales@example.com',
      tenantId: 'tenant-1',
      role: 'SALES',
    });
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    const updatedEmployee = {
      ...baseEmployee,
      name: 'Jane Updated',
      role: EmployeeRole.OFFICE,
      is_active: false,
      sort_order: 2,
      user_id: 'user-2',
      mother_language_code: 'de',
    };
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce(baseEmployee)
      .mockResolvedValueOnce(updatedEmployee);

    const result = await service.update('emp-1', {
      name: 'Jane Updated',
      role: EmployeeRole.OFFICE,
      isActive: false,
      sortOrder: 2,
      userId: 'user-2',
      motherLanguageCode: 'de',
    });

    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: {
        name: 'Jane Updated',
        role: EmployeeRole.OFFICE,
        is_active: false,
        sort_order: 2,
        user_id: 'user-2',
        mother_language_code: 'de',
      },
    });
    expect(result.name).toBe('Jane Updated');
    expect(result.role).toBe(EmployeeRole.OFFICE);
    expect(result.isActive).toBe(false);
  });

  it('updates an existing current-year balance with annual leave changes', async () => {
    const updatedEmployee = {
      ...baseEmployee,
      annual_leave_minutes: 15450,
    };
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce(baseEmployee)
      .mockResolvedValueOnce(updatedEmployee);

    await service.update('emp-1', { annualLeaveMinutes: 15450 });

    const currentYear = Number(
      formatLocalDate(new Date(), 'Europe/Vienna').slice(0, 4),
    );
    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: { annual_leave_minutes: 15450 },
    });
    expect(mockPrisma.employeeLeaveBalance.upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_employee_id_year: {
          tenant_id: 'tenant-1',
          employee_id: 'emp-1',
          year: currentYear,
        },
      },
      create: {
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        year: currentYear,
        allowance_minutes: 15450,
        carryover_minutes: 0,
      },
      update: { allowance_minutes: 15450 },
    });
  });

  it('creates a missing current-year balance with zero carryover', async () => {
    const updatedEmployee = {
      ...baseEmployee,
      annual_leave_minutes: 15450,
    };
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce(baseEmployee)
      .mockResolvedValueOnce(updatedEmployee);

    const currentYear = Number(
      formatLocalDate(new Date(), 'Europe/Vienna').slice(0, 4),
    );

    await service.update('emp-1', { annualLeaveMinutes: 15450 });

    expect(mockPrisma.employeeLeaveBalance.upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_employee_id_year: {
          tenant_id: 'tenant-1',
          employee_id: 'emp-1',
          year: currentYear,
        },
      },
      create: {
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        year: currentYear,
        allowance_minutes: 15450,
        carryover_minutes: 0,
      },
      update: { allowance_minutes: 15450 },
    });
  });

  it('throws not found on update missing employee', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'New' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('links a userId when provided in update', async () => {
    const linkedEmployee = { ...baseEmployee, user_id: 'user-uuid-xyz' };
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce(baseEmployee)
      .mockResolvedValueOnce(linkedEmployee);

    const result = await service.update('emp-1', { userId: 'user-uuid-xyz' });

    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: { user_id: 'user-uuid-xyz' },
    });
    expect(result.userId).toBe('user-uuid-xyz');
  });

  it('unlinks a userId when null is provided in update', async () => {
    const linkedEmployee = { ...baseEmployee, user_id: 'user-uuid-xyz' };
    const updatedEmployee = {
      ...baseEmployee,
      user_id: null,
    };
    mockPrisma.employee.findFirst
      .mockResolvedValueOnce(linkedEmployee)
      .mockResolvedValueOnce(updatedEmployee);

    const result = await service.update('emp-1', { userId: null });

    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: { user_id: null },
    });
    expect(result.userId).toBeNull();
  });

  it('throws ConflictException when linking a userId already used in update', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    mockPrisma.employee.updateMany.mockRejectedValue(p2002);

    await expect(
      service.update('emp-1', { userId: 'user-uuid-taken' }),
    ).rejects.toThrow(ConflictException);
  });

  it('sets userId when provided in create', async () => {
    const newEmployee = {
      ...baseEmployee,
      id: 'emp-new',
      user_id: 'user-uuid-new',
      annual_leave_minutes: 12875,
    };
    mockPrisma.employee.create.mockResolvedValue({
      ...newEmployee,
      annual_leave_minutes: 0,
    });
    mockPrisma.employee.findFirstOrThrow.mockResolvedValue(newEmployee);
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

    const result = await service.create({
      name: 'New Mechanic',
      role: EmployeeRole.MECHANIC,
      userId: 'user-uuid-new',
    });

    expect(mockPrisma.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'user-uuid-new' }),
      }),
    );
    expect(result.userId).toBe('user-uuid-new');
  });

  it('throws ConflictException when creating with a userId already in use', async () => {
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    mockPrisma.employee.create.mockRejectedValue(p2002);

    await expect(
      service.create({
        name: 'Duplicate',
        role: EmployeeRole.MECHANIC,
        userId: 'user-uuid-taken',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('soft-disables employee on first delete when unreferenced', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);

    const result = await service.remove('emp-1');

    expect(result.isActive).toBe(false);
    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: { is_active: false },
    });
  });

  it('blocks delete when employee is referenced by workshop orders', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(1);

    await expect(service.remove('emp-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.employee.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.workshopOrder.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', mechanic_id: 'emp-1' },
    });
  });

  it('hard deletes only when already inactive and unreferenced', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      ...baseEmployee,
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);

    const result = await service.remove('emp-1');

    expect(result).toEqual({ id: 'emp-1', deleted: true });
    expect(mockPrisma.employee.deleteMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
    });
    expect(mockPrisma.workshopTask.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', mechanic_id: 'emp-1' },
    });
    expect(mockPrisma.workshopMedia.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', uploaded_by_employee_id: 'emp-1' },
    });
    expect(mockPrisma.workshopVoiceNoteDraft.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', mechanic_employee_id: 'emp-1' },
    });
    expect(mockPrisma.laborEntry.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', employee_id: 'emp-1' },
    });
    expect(mockPrisma.attendanceEvent.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', employee_id: 'emp-1' },
    });
    expect(mockPrisma.leaveRequest.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', employee_id: 'emp-1' },
    });
    expect(mockPrisma.employeeLeaveBalance.count).toHaveBeenCalledWith({
      where: { tenant_id: 'tenant-1', employee_id: 'emp-1' },
    });
  });

  it('soft-disables active employees even when HR rows exist', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.attendanceEvent.count.mockResolvedValue(1);

    const result = await service.remove('emp-1');

    expect(result.isActive).toBe(false);
    expect(mockPrisma.employee.updateMany).toHaveBeenCalled();
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });

  it('soft-disables active employees even when linked work records exist', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(1);
    mockPrisma.workshopTask.count.mockResolvedValue(1);
    mockPrisma.workshopMedia.count.mockResolvedValue(1);
    mockPrisma.workshopVoiceNoteDraft.count.mockResolvedValue(1);

    const result = await service.remove('emp-1');

    expect(result.isActive).toBe(false);
    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: { is_active: false },
    });
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });

  it('blocks hard delete when an HR row references the employee', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      ...baseEmployee,
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.employeeLeaveBalance.count.mockResolvedValue(1);

    await expect(service.remove('emp-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });

  it('blocks hard delete when a restrictive work record references the employee', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      ...baseEmployee,
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(1);

    await expect(service.remove('emp-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });
});
