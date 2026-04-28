import { LaborPauseReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MechanicSchedulerService } from './mechanic-scheduler.service';

const mockPrisma = {
  laborEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService;

describe('MechanicSchedulerService', () => {
  let scheduler: MechanicSchedulerService;

  beforeEach(() => {
    scheduler = new MechanicSchedulerService(mockPrisma);
    jest.clearAllMocks();
  });

  it('does nothing when no open entries are found', async () => {
    (mockPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([]);

    await scheduler.closeOrphanedLaborEntries();

    expect(mockPrisma.laborEntry.update).not.toHaveBeenCalled();
  });

  it('closes all open entries with AUTO_SHIFT_CLOSE reason', async () => {
    (mockPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([
      { id: 'entry-1' },
      { id: 'entry-2' },
    ]);
    (mockPrisma.laborEntry.update as jest.Mock).mockResolvedValue({});

    await scheduler.closeOrphanedLaborEntries();

    expect(mockPrisma.laborEntry.update).toHaveBeenCalledTimes(2);

    const call1 = (mockPrisma.laborEntry.update as jest.Mock).mock.calls[0][0];
    expect(call1.where.id).toBe('entry-1');
    expect(call1.data.pause_reason).toBe(LaborPauseReason.AUTO_SHIFT_CLOSE);
    expect(call1.data.ended_at).toBeInstanceOf(Date);

    const call2 = (mockPrisma.laborEntry.update as jest.Mock).mock.calls[1][0];
    expect(call2.where.id).toBe('entry-2');
    expect(call2.data.pause_reason).toBe(LaborPauseReason.AUTO_SHIFT_CLOSE);
  });

  it('queries for entries where ended_at IS NULL', async () => {
    (mockPrisma.laborEntry.findMany as jest.Mock).mockResolvedValue([]);

    await scheduler.closeOrphanedLaborEntries();

    expect(mockPrisma.laborEntry.findMany).toHaveBeenCalledWith({
      where: { ended_at: null },
      select: { id: true },
    });
  });
});
