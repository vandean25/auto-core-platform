import { Test, TestingModule } from '@nestjs/testing';
import {
  AttendanceEventSource,
  AttendanceEventType,
  Prisma,
} from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';
import { HrAttendanceSchedulerService } from './hr-attendance-scheduler.service.js';

describe('HrAttendanceSchedulerService', () => {
  let service: HrAttendanceSchedulerService;
  let systemPrisma: {
    $transaction: jest.Mock;
    attendanceEvent: {
      groupBy: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    systemPrisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(systemPrisma),
      ),
      attendanceEvent: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'evt-new' }),
      },
      ...cronJobLockTestStub(),
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
    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: yesterdayMorning },
      },
    ]);
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'a1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
    ]);
    systemPrisma.attendanceEvent.findFirst.mockResolvedValue({
      type: AttendanceEventType.CLOCK_IN,
      occurred_at: yesterdayMorning,
    });

    const closeTime = new Date('2026-08-22T23:59:00Z');
    await service.run(closeTime);

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
    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-2',
        employee_id: 'e2',
        _max: { occurred_at: new Date('2026-08-22T12:00:00Z') },
      },
      {
        tenant_id: 'tenant-1',
        employee_id: 'e3',
        _max: { occurred_at: new Date('2026-08-22T14:00:00Z') },
      },
    ]);
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
    systemPrisma.attendanceEvent.findFirst
      .mockResolvedValueOnce({
        type: AttendanceEventType.PAUSE,
        occurred_at: new Date('2026-08-22T12:00:00Z'),
      })
      .mockResolvedValueOnce({
        type: AttendanceEventType.DOCTOR,
        occurred_at: new Date('2026-08-22T14:00:00Z'),
      });

    const closeTime = new Date('2026-08-22T23:59:00Z');
    await service.run(closeTime);

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
    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: new Date('2026-08-22T17:00:00Z') },
      },
    ]);
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'a4',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_OUT,
        occurred_at: new Date('2026-08-22T17:00:00Z'),
      },
    ]);

    await service.run(new Date());

    expect(systemPrisma.attendanceEvent.create).not.toHaveBeenCalled();
  });

  it('skips employees whose latest event occurred_at is in the future relative to now', async () => {
    const closeTime = new Date('2026-08-22T23:59:00Z');
    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: new Date('2026-08-23T08:00:00Z') },
      },
    ]);

    await service.run(closeTime);

    expect(systemPrisma.attendanceEvent.findMany).not.toHaveBeenCalled();
    expect(systemPrisma.attendanceEvent.create).not.toHaveBeenCalled();
  });

  it('does not create duplicate CLOCK_OUT when employee clocks out between read and write', async () => {
    const closeTime = new Date('2026-08-22T23:59:00Z');
    const employeeClockOutTime = new Date('2026-08-22T23:58:30Z');

    type EventRow = {
      id: string;
      tenant_id: string;
      employee_id: string;
      type: AttendanceEventType;
      source: AttendanceEventSource;
      occurred_at: Date;
      createdAt: Date;
    };

    const events: EventRow[] = [
      {
        id: 'evt-in-1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T08:00:00Z'),
        createdAt: new Date('2026-08-22T08:00:00Z'),
      },
      {
        id: 'evt-in-2',
        tenant_id: 'tenant-1',
        employee_id: 'e2',
        type: AttendanceEventType.CLOCK_IN,
        source: AttendanceEventSource.SELF,
        occurred_at: new Date('2026-08-22T09:00:00Z'),
        createdAt: new Date('2026-08-22T09:00:00Z'),
      },
    ];

    const findLatestForEmployee = (tenantId: string, employeeId: string) =>
      events
        .filter((e) => e.tenant_id === tenantId && e.employee_id === employeeId)
        .sort(
          (a, b) =>
            b.occurred_at.getTime() - a.occurred_at.getTime() ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )[0] ?? null;

    const attendanceEventDelegate = {
      groupBy: jest.fn(async () => [
        {
          tenant_id: 'tenant-1',
          employee_id: 'e1',
          _max: { occurred_at: events[0].occurred_at },
        },
        {
          tenant_id: 'tenant-1',
          employee_id: 'e2',
          _max: { occurred_at: events[1].occurred_at },
        },
      ]),
      findMany: jest.fn(async () => {
        const snapshot = [events[0], events[1]];
        // Simulate employee e1 clocking out right after the scheduler's read.
        events.push({
          id: 'evt-self-out-1',
          tenant_id: 'tenant-1',
          employee_id: 'e1',
          type: AttendanceEventType.CLOCK_OUT,
          source: AttendanceEventSource.SELF,
          occurred_at: employeeClockOutTime,
          createdAt: employeeClockOutTime,
        });
        return snapshot;
      }),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { tenant_id: string; employee_id: string };
        }) => findLatestForEmployee(where.tenant_id, where.employee_id),
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: {
            tenant_id: string;
            employee_id: string;
            type: AttendanceEventType;
            source: AttendanceEventSource;
            occurred_at: Date;
          };
        }) => {
          const created: EventRow = {
            id: `evt-${events.length + 1}`,
            ...data,
            createdAt: new Date(data.occurred_at),
          };
          events.push(created);
          return created;
        },
      ),
    };

    const racePrisma = {
      attendanceEvent: attendanceEventDelegate,
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ attendanceEvent: attendanceEventDelegate }),
      ),
      ...cronJobLockTestStub(),
    } as unknown as SystemPrismaService;

    const raceService = new HrAttendanceSchedulerService(racePrisma);
    await raceService.run(closeTime);

    const e1ClockOuts = events.filter(
      (e) => e.employee_id === 'e1' && e.type === AttendanceEventType.CLOCK_OUT,
    );
    expect(e1ClockOuts).toHaveLength(1);
    expect(e1ClockOuts[0].source).toBe(AttendanceEventSource.SELF);
    expect(e1ClockOuts[0].occurred_at).toEqual(employeeClockOutTime);

    const e2ClockOuts = events.filter(
      (e) => e.employee_id === 'e2' && e.type === AttendanceEventType.CLOCK_OUT,
    );
    expect(e2ClockOuts).toHaveLength(1);
    expect(e2ClockOuts[0].source).toBe(AttendanceEventSource.AUTO_SHIFT_CLOSE);
  });

  it('retries P2034 serialization failure, sees concurrent CLOCK_OUT on re-read, and skips', async () => {
    const closeTime = new Date('2026-08-22T23:59:00Z');
    const employeeClockOutTime = new Date('2026-08-22T23:58:30Z');
    const yesterdayMorning = new Date('2026-08-22T08:00:00Z');

    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: yesterdayMorning },
      },
    ]);
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'evt-in-1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
    ]);
    systemPrisma.attendanceEvent.findFirst
      .mockResolvedValueOnce({
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      })
      .mockResolvedValueOnce({
        type: AttendanceEventType.CLOCK_OUT,
        occurred_at: employeeClockOutTime,
      });

    const p2034 = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock',
      { code: 'P2034', clientVersion: '7.0.0' },
    );

    let txCalls = 0;
    systemPrisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        txCalls++;
        const result = await cb(systemPrisma);
        if (txCalls === 1) {
          throw p2034;
        }
        return result;
      },
    );

    await service.run(closeTime);

    expect(txCalls).toBe(2);
    expect(systemPrisma.attendanceEvent.findFirst).toHaveBeenCalledTimes(2);
    // First attempt attempted create before P2034 aborted it; second attempt saw CLOCK_OUT and skipped.
    expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledTimes(1);
  });

  it('retries P2034 serialization failure, still sees open shift on re-read, and inserts one AUTO_SHIFT_CLOSE', async () => {
    const closeTime = new Date('2026-08-22T23:59:00Z');
    const yesterdayMorning = new Date('2026-08-22T08:00:00Z');

    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: yesterdayMorning },
      },
    ]);
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'evt-in-1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
    ]);
    systemPrisma.attendanceEvent.findFirst.mockResolvedValue({
      type: AttendanceEventType.CLOCK_IN,
      occurred_at: yesterdayMorning,
    });

    const p2034 = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock',
      { code: 'P2034', clientVersion: '7.0.0' },
    );

    const committedCreates: unknown[] = [];
    let txCalls = 0;
    systemPrisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        txCalls++;
        const stagedCreates: unknown[] = [];
        const tx = {
          attendanceEvent: {
            findFirst: systemPrisma.attendanceEvent.findFirst,
            create: jest.fn(async (args: { data: unknown }) => {
              stagedCreates.push(args.data);
              return { id: `evt-${txCalls}` };
            }),
          },
        };
        const res = await cb(tx);
        if (txCalls === 1) {
          throw p2034;
        }
        committedCreates.push(...stagedCreates);
        return res;
      },
    );

    await service.run(closeTime);

    expect(txCalls).toBe(2);
    expect(systemPrisma.attendanceEvent.findFirst).toHaveBeenCalledTimes(2);
    expect(committedCreates).toHaveLength(1);
    expect(committedCreates[0]).toEqual({
      tenant_id: 'tenant-1',
      employee_id: 'e1',
      type: AttendanceEventType.CLOCK_OUT,
      source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
      occurred_at: closeTime,
    });
  });

  it('logs and continues with the next employee when P2034 retries are exhausted', async () => {
    const closeTime = new Date('2026-08-22T23:59:00Z');
    const yesterdayMorning = new Date('2026-08-22T08:00:00Z');

    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: yesterdayMorning },
      },
      {
        tenant_id: 'tenant-1',
        employee_id: 'e2',
        _max: { occurred_at: yesterdayMorning },
      },
    ]);
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'evt-in-1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
      {
        id: 'evt-in-2',
        tenant_id: 'tenant-1',
        employee_id: 'e2',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
    ]);
    systemPrisma.attendanceEvent.findFirst.mockResolvedValue({
      type: AttendanceEventType.CLOCK_IN,
      occurred_at: yesterdayMorning,
    });

    const p2034 = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock',
      { code: 'P2034', clientVersion: '7.0.0' },
    );

    let e1Attempts = 0;
    systemPrisma.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) => {
        // Distinguish e1 vs e2 by checking the create/findFirst argument via a proxy tx
        let currentEmployeeId: string | undefined;
        const tx = {
          attendanceEvent: {
            findFirst: jest.fn(
              async (args: { where: { employee_id: string } }) => {
                currentEmployeeId = args.where.employee_id;
                return systemPrisma.attendanceEvent.findFirst(args);
              },
            ),
            create: jest.fn(async (args: unknown) =>
              systemPrisma.attendanceEvent.create(args),
            ),
          },
        };
        const res = await cb(tx);
        if (currentEmployeeId === 'e1') {
          e1Attempts++;
          throw p2034;
        }
        return res;
      },
    );

    await expect(service.run(closeTime)).resolves.toBe(true);

    expect(e1Attempts).toBe(3);
    expect(systemPrisma.attendanceEvent.create).toHaveBeenCalledWith({
      data: {
        tenant_id: 'tenant-1',
        employee_id: 'e2',
        type: AttendanceEventType.CLOCK_OUT,
        source: AttendanceEventSource.AUTO_SHIFT_CLOSE,
        occurred_at: closeTime,
      },
    });
  });

  it('does not swallow or retry non-retryable transaction errors', async () => {
    const closeTime = new Date('2026-08-22T23:59:00Z');
    const yesterdayMorning = new Date('2026-08-22T08:00:00Z');

    systemPrisma.attendanceEvent.groupBy.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        _max: { occurred_at: yesterdayMorning },
      },
    ]);
    systemPrisma.attendanceEvent.findMany.mockResolvedValue([
      {
        id: 'evt-in-1',
        tenant_id: 'tenant-1',
        employee_id: 'e1',
        type: AttendanceEventType.CLOCK_IN,
        occurred_at: yesterdayMorning,
      },
    ]);

    systemPrisma.$transaction.mockRejectedValue(
      new Error('Unexpected database error'),
    );

    await expect(service.run(closeTime)).rejects.toThrow(
      'Unexpected database error',
    );
    expect(systemPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
