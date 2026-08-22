import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceEventSource, AttendanceEventType } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service';

describe('HrAttendanceSchedulerService', () => {
  let service: HrAttendanceSchedulerService;
  let systemPrisma: {
    attendanceEvent: {
      findMany: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    systemPrisma = {
      attendanceEvent: {
        findMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'evt-new' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrAttendanceSchedulerService,
        { provide: SystemPrismaService, useValue: systemPrisma },
      ],
    }).compile();

    service = module.get<HrAttendanceSchedulerService>(
      HrAttendanceSchedulerService,
    );
  });

  it('inserts CLOCK_OUT AUTO_SHIFT_CLOSE when latest event is CLOCK_IN', async () => {
    const yesterdayMorning = new Date('2026-08-22T08:00:00Z');
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'a1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
    ]);

    const closeTime = new Date('2026-08-22T23:59:00Z');
    await service.closeOrphanedShifts(closeTime);

    expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
        occurred_at: closeTime,
      },
    });
  });

  it('inserts CLOCK_OUT AUTO_SHIFT_CLOSE when latest event is PAUSE or DOCTOR', async () => {
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'a2',
        tenant_id: 'tenant-2',
        employee_id: 'e2',
        type: AttendanceEventType.PAUSE,
        occurred_at: new Date('2026-08-22T12:00:00Z'),
      },
      {
        id: 'a3',
        tenant_id: 'tenant-1',
        employee_id: 'e3',
        type: AttendanceEventType.DOCTOR,
        occurred_at: new Date('2026-08-22T14:00:00Z'),
      },
    ]);

    const closeTime = new Date('2026-08-22T23:59:00Z');
    await service.closeOrphanedShifts(closeTime);

    expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledTimes(2);
    expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-2',
        employee_id: 'e2',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
        occurred_at: closeTime,
      },
    });
    expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        employee_id: 'e3',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
        occurred_at: closeTime,
      },
    });
  });

  it('skips employees whose latest event is CLOCK_OUT', async () => {
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'a4',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_OUT,
        occurred_at: new Date('2026-08-22T17:00:00Z'),
      },
      {
        id: 'a1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
      },
    ]);

    await service.closeOrphanedShifts(new Date());

    expect(systemPrisma.attendanceEvent.create).not.toHaveBeenCalled();
  });
});
