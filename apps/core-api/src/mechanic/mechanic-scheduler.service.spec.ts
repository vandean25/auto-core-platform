import { LaborPauseReason } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { MechanicSchedulerService } from './mechanic-scheduler.service';

const mockSystemPrisma = {
  laborEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
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

    expect(mockSystemPrisma.laborEntry.update).not.toHaveBeenCalled();
  });

  it('closes all open entries with AUTO_SHIFT_CLOSE reason', async () => {
    (mockSystemPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([
      { id: 'entry-1' },
      { id: 'entry-2' },
    ]);
    (mockSystemPrisma.laborEntry.update as jest.Mock).mockResolvedValue({});

    await scheduler.closeOrphanedLaborEntries();

    expect(mockSystemPrisma.laborEntry.update).toHaveBeenCalledTimes(2);

    const call1 = (mockSystemPrisma.laborEntry.update as jest.Mock).mock.calls[0][0];
    expect(call1.where.id).toBe('entry-1');
    expect(call1.data.pause_reason).toBe(LaborPauseReason.AUTO_SHIFT_CLOSE);
    expect(call1.data.ended_at).toBeInstanceOf(Date);

    const call2 = (mockSystemPrisma.laborEntry.update as jest.Mock).mock.calls[1][0];
    expect(call2.where.id).toBe('entry-2');
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
});
