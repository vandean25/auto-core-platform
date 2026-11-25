import { LaborPauseReason } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { cronJobLockTestStub } from '../scheduler/cron-job-lock.test-helpers.js';
import { MechanicSchedulerService } from './mechanic-scheduler.service.js';

const mockSystemPrisma = {
  laborEntry: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  ...cronJobLockTestStub(),
} as unknown as SystemPrismaService;

describe('MechanicSchedulerService', () => {
  let scheduler: MechanicSchedulerService;

  beforeEach(() => {
    scheduler = new MechanicSchedulerService(mockSystemPrisma);
    jest.clearAllMocks();
  });

  it('does nothing when no open entries are found', async () => {
    (mockSystemPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([]);

    await scheduler.closeOrphanedLaborEntries();

    expect(mockSystemPrisma.laborEntry.updateMany).not.toHaveBeenCalled();
  });

  it('closes all open entries with AUTO_SHIFT_CLOSE reason', async () => {
    (mockSystemPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([
      { id: 'entry-1' },
      { id: 'entry-2' },
    ]);
    (mockSystemPrisma.laborEntry.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    });

    await scheduler.closeOrphanedLaborEntries();

    expect(mockSystemPrisma.laborEntry.updateMany).toHaveBeenCalledTimes(2);

    const call1 = (mockSystemPrisma.laborEntry.updateMany as jest.Mock).mock
      .calls[0][0];
    expect(call1.where).toEqual({ id: 'entry-1', ended_at: null });
    expect(call1.data.pause_reason).toBe(LaborPauseReason.AUTO_SHIFT_CLOSE);
    expect(call1.data.ended_at).toBeInstanceOf(Date);

    const call2 = (mockSystemPrisma.laborEntry.updateMany as jest.Mock).mock
      .calls[1][0];
    expect(call2.where).toEqual({ id: 'entry-2', ended_at: null });
    expect(call2.data.pause_reason).toBe(LaborPauseReason.AUTO_SHIFT_CLOSE);
  });

  it('queries for entries where ended_at IS NULL', async () => {
    (mockSystemPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([]);

    await scheduler.closeOrphanedLaborEntries();

    expect(mockSystemPrisma.laborEntry.findMany).toHaveBeenCalledWith({
      where: { ended_at: null },
      select: { id: true },
    });
  });

  it('does not overwrite ended_at or set AUTO_SHIFT_CLOSE when mechanic stops between read and write', async () => {
    const mechanicStoppedAt = new Date('2026-08-22T23:58:30Z');
    const entries = [
      {
        id: 'entry-closed-in-between',
        ended_at: null as Date | null,
        pause_reason: null as LaborPauseReason | null,
      },
      {
        id: 'entry-still-open',
        ended_at: null as Date | null,
        pause_reason: null as LaborPauseReason | null,
      },
    ];

    const matchesWhere = (
      row: (typeof entries)[number],
      where: { id?: string; ended_at?: null | Date },
    ) => {
      if (where.id !== undefined && row.id !== where.id) return false;
      if ('ended_at' in where && row.ended_at !== where.ended_at) return false;
      return true;
    };

    const racePrisma = {
      laborEntry: {
        findMany: jest.fn(async ({ where }: { where: { ended_at: null } }) => {
          const open = entries
            .filter((e) => matchesWhere(e, where))
            .map((e) => ({ id: e.id }));
          // Simulate mechanic stopping entry-closed-in-between right after job read.
          entries[0].ended_at = mechanicStoppedAt;
          entries[0].pause_reason = LaborPauseReason.OTHER;
          return open;
        }),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; ended_at?: null };
            data: { ended_at: Date; pause_reason: LaborPauseReason };
          }) => {
            const row = entries.find((e) => matchesWhere(e, where));
            if (!row) throw new Error('Record not found');
            row.ended_at = data.ended_at;
            row.pause_reason = data.pause_reason;
            return row;
          },
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; ended_at?: null };
            data: { ended_at: Date; pause_reason: LaborPauseReason };
          }) => {
            let count = 0;
            for (const row of entries) {
              if (matchesWhere(row, where)) {
                row.ended_at = data.ended_at;
                row.pause_reason = data.pause_reason;
                count += 1;
              }
            }
            return { count };
          },
        ),
      },
      ...cronJobLockTestStub(),
    } as unknown as SystemPrismaService;

    const raceScheduler = new MechanicSchedulerService(racePrisma);
    await raceScheduler.closeOrphanedLaborEntries();

    expect(entries[0].ended_at).toEqual(mechanicStoppedAt);
    expect(entries[0].pause_reason).toBe(LaborPauseReason.OTHER);
    expect(entries[1].ended_at).toBeInstanceOf(Date);
    expect(entries[1].pause_reason).toBe(LaborPauseReason.AUTO_SHIFT_CLOSE);
  });
});
