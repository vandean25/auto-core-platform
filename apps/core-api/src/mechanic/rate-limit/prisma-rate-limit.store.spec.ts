import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaRateLimitStore } from './prisma-rate-limit.store';
import type { Clock } from './rate-limit.store';

class FakeClock implements Clock {
  constructor(private currentMs: number) {}

  now(): number {
    return this.currentMs;
  }
}

const SCOPE = { tenantId: 'tenant-a', mechanicId: 'mechanic-1' };
const WINDOW = { max: 2, ttlMs: 60_000 };
const NOW_MS = 1_700_000_000_000;

function createStore(prisma: {
  voiceNoteRateLimit: {
    updateMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
  };
}) {
  return new PrismaRateLimitStore(
    prisma as unknown as PrismaService,
    new FakeClock(NOW_MS),
  );
}

describe('PrismaRateLimitStore', () => {
  let prisma: {
    voiceNoteRateLimit: {
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      voiceNoteRateLimit: {
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
  });

  it('allows a consume when an unexpired counter is incremented', async () => {
    prisma.voiceNoteRateLimit.updateMany.mockResolvedValue({ count: 1 });

    await expect(createStore(prisma).consume(SCOPE, WINDOW)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    expect(prisma.voiceNoteRateLimit.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: SCOPE.tenantId,
        mechanic_id: SCOPE.mechanicId,
        expires_at: { gt: new Date(NOW_MS) },
        count: { lt: WINDOW.max },
      },
      data: { count: { increment: 1 } },
    });
  });

  it('rejects when the shared counter is already at the max', async () => {
    prisma.voiceNoteRateLimit.updateMany.mockResolvedValue({ count: 0 });
    prisma.voiceNoteRateLimit.findFirst.mockResolvedValue({
      count: 2,
      expires_at: new Date(NOW_MS + 45_000),
    });

    await expect(createStore(prisma).consume(SCOPE, WINDOW)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 45,
    });
  });

  it('creates a new shared counter when none exists', async () => {
    prisma.voiceNoteRateLimit.updateMany.mockResolvedValue({ count: 0 });
    prisma.voiceNoteRateLimit.findFirst.mockResolvedValue(null);
    prisma.voiceNoteRateLimit.create.mockResolvedValue({ count: 1 });

    await expect(createStore(prisma).consume(SCOPE, WINDOW)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    expect(prisma.voiceNoteRateLimit.create).toHaveBeenCalledWith({
      data: {
        tenant_id: SCOPE.tenantId,
        mechanic_id: SCOPE.mechanicId,
        window_start: new Date(NOW_MS),
        expires_at: new Date(NOW_MS + WINDOW.ttlMs),
        count: 1,
      },
    });
  });

  it('resets an expired shared counter instead of rejecting', async () => {
    prisma.voiceNoteRateLimit.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.voiceNoteRateLimit.findFirst.mockResolvedValue({
      count: 2,
      expires_at: new Date(NOW_MS - 1),
    });

    await expect(createStore(prisma).consume(SCOPE, WINDOW)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    expect(prisma.voiceNoteRateLimit.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        tenant_id: SCOPE.tenantId,
        mechanic_id: SCOPE.mechanicId,
        expires_at: { lte: new Date(NOW_MS) },
      },
      data: {
        count: 1,
        window_start: new Date(NOW_MS),
        expires_at: new Date(NOW_MS + WINDOW.ttlMs),
      },
    });
  });

  it('retries create after a unique-constraint race and then increments', async () => {
    prisma.voiceNoteRateLimit.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.voiceNoteRateLimit.findFirst.mockResolvedValue(null);
    prisma.voiceNoteRateLimit.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(createStore(prisma).consume(SCOPE, WINDOW)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
