import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceEventSource, AttendanceEventType } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { HrAttendanceService } from './hr-attendance.service';
import { HrIdentityService } from './hr-identity.service';

describe('HrAttendanceService', () => {
  let service: HrAttendanceService;
  let prisma: {
    attendanceEvent: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    employee: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    workshopSettings: {
      findUnique: jest.Mock;
    };
    employeeLeaveBalance: {
      findUnique: jest.Mock;
    };
    leaveRequest: {
      aggregate: jest.Mock;
    };
  };
  let identity: {
    resolveMe: jest.Mock;
    assertOwnerAdmin: jest.Mock;
  };
  let tenantContext: {
    getTenantId: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(prisma)),
      attendanceEvent: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      employee: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      workshopSettings: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Vienna' }),
      },
      employeeLeaveBalance: {
        findUnique: jest.fn(),
      },
      leaveRequest: {
        aggregate: jest.fn(),
      },
    };
    identity = {
      resolveMe: jest.fn().mockResolvedValue({
        id: 'emp-1',
        name: 'Ada Lovelace',
        role: 'MECHANIC',
        hired_on: new Date('2024-01-01'),
        annual_leave_days: 25,
      }),
      assertOwnerAdmin: jest.fn(),
    };
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrAttendanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: HrIdentityService, useValue: identity },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get<HrAttendanceService>(HrAttendanceService);
  });

  describe('punchMe & State Transitions', () => {
    it('CLOCK_IN from CLOCKED_OUT succeeds and returns CLOCKED_IN', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue(null);
      const created = {
        id: 'evt-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        type: AttendanceEventType.CLOCK_IN,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
        note: null,
        createdAt: new Date('2026-08-22T08:00:00Z'),
      };
      prisma.attendanceEvent.create.mockResolvedValue(created);

      const result = await service.punchMe(AttendanceEventType.CLOCK_IN);

      expect(result.state).toBe('CLOCKED_IN');
      expect(result.event.id).toBe('evt-1');
      expect(prisma.attendanceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          employee_id: 'emp-1',
          type: AttendanceEventType.CLOCK_IN,
          source: AttendanceEventSource.SELF,
        }),
      });
    });

    it('PAUSE while CLOCKED_OUT returns 409 Conflict', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.CLOCK_OUT,
        occurred_at: new Date('2026-08-21T17:00:00Z'),
      });

      await expect(
        service.punchMe(AttendanceEventType.PAUSE),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('second CLOCK_IN while CLOCKED_IN returns 409 Conflict', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
      });

      await expect(
        service.punchMe(AttendanceEventType.CLOCK_IN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('PAUSE from CLOCKED_IN succeeds and returns PAUSED', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
      });
      prisma.attendanceEvent.create.mockResolvedValue({
        id: 'evt-2',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        type: AttendanceEventType.PAUSE,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T12:00:00Z'),
        note: 'Lunch break',
        createdAt: new Date('2026-08-22T12:00:00Z'),
      });

      const result = await service.punchMe(AttendanceEventType.PAUSE, 'Lunch break');
      expect(result.state).toBe('PAUSED');
      expect(result.event.note).toBe('Lunch break');
    });

    it('DOCTOR from CLOCKED_IN succeeds and returns AT_DOCTOR', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
      });
      prisma.attendanceEvent.create.mockResolvedValue({
        id: 'evt-3',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        type: AttendanceEventType.DOCTOR,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T10:00:00Z'),
        note: null,
        createdAt: new Date('2026-08-22T10:00:00Z'),
      });

      const result = await service.punchMe(AttendanceEventType.DOCTOR);
      expect(result.state).toBe('AT_DOCTOR');
    });

    it('CLOCK_IN from PAUSED resumes to CLOCKED_IN', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.PAUSE,
        occurred_at: new Date('2026-08-22T12:00:00Z'),
      });
      prisma.attendanceEvent.create.mockResolvedValue({
        id: 'evt-4',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        type: AttendanceEventType.CLOCK_IN,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T12:30:00Z'),
        note: null,
        createdAt: new Date('2026-08-22T12:30:00Z'),
      });

      const result = await service.punchMe(AttendanceEventType.CLOCK_IN);
      expect(result.state).toBe('CLOCKED_IN');
    });

    it('CLOCK_OUT from AT_DOCTOR returns CLOCKED_OUT', async () => {
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.DOCTOR,
        occurred_at: new Date('2026-08-22T10:00:00Z'),
      });
      prisma.attendanceEvent.create.mockResolvedValue({
        id: 'evt-5',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T16:00:00Z'),
        note: null,
        createdAt: new Date('2026-08-22T16:00:00Z'),
      });

      const result = await service.punchMe(AttendanceEventType.CLOCK_OUT);
      expect(result.state).toBe('CLOCKED_OUT');
    });
  });

  describe('punchEmployee (Manager)', () => {
    it('creates attendance event with MANAGER source', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-2', is_active: true });
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
      });
      prisma.attendanceEvent.create.mockResolvedValue({
        id: 'evt-mgr-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-2',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.MANAGER,
        occurred_at: new Date('2026-08-22T17:00:00Z'),
        note: 'Manager close',
        createdAt: new Date('2026-08-22T17:00:00Z'),
      });

      const result = await service.punchEmployee({
        employeeId: 'emp-2',
        type: AttendanceEventType.CLOCK_OUT,
        occurredAt: '2026-08-22T17:00:00Z',
        note: 'Manager close',
      });

      expect(identity.assertOwnerAdmin).toHaveBeenCalled();
      expect(result.state).toBe('CLOCKED_OUT');
      expect(prisma.attendanceEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employee_id: 'emp-2',
          source: AttendanceEventSource.MANAGER,
          occurred_at: new Date('2026-08-22T17:00:00Z'),
        }),
      });
    });

    it('throws NotFoundException if target employee is not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.punchEmployee({
          employeeId: 'emp-unknown',
          type: AttendanceEventType.CLOCK_IN,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException if manager occurredAt is <= previous occurred_at', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-2', is_active: true });
      prisma.attendanceEvent.findFirst.mockResolvedValue({
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
      });

      await expect(
        service.punchEmployee({
          employeeId: 'emp-2',
          type: AttendanceEventType.CLOCK_OUT,
          occurredAt: '2026-08-22T07:59:59Z',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getAttendance', () => {
    it('returns attendance events in range for OWNER/ADMIN', async () => {
      const events = [
        {
          id: 'evt-1',
          tenant_id: 'tenant-1',
          employee_id: 'emp-1',
          type: AttendanceEventType.CLOCK_IN,
          source: AttendanceEventSource.SELF,
          occurred_at: new Date('2026-08-22T08:00:00Z'),
          note: null,
          createdAt: new Date('2026-08-22T08:00:00Z'),
        },
      ];
      prisma.attendanceEvent.findMany.mockResolvedValue(events);

      const result = await service.getAttendance({
        from: '2026-08-01',
        to: '2026-08-22',
        employeeId: 'emp-1',
      });

      expect(identity.assertOwnerAdmin).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('evt-1');
    });

    it('throws BadRequestException if date range exceeds 31 days', async () => {
      await expect(
        service.getAttendance({
          from: '2026-07-01',
          to: '2026-08-22',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException if to date is before from date', async () => {
      await expect(
        service.getAttendance({
          from: '2026-08-22',
          to: '2026-08-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
