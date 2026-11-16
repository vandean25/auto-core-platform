import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InventoryPriceOperationState } from '@prisma/client';

const mockCaptureCheckIn = jest.fn<(...args: unknown[]) => string>();
const mockCaptureMessage = jest.fn<(...args: unknown[]) => string>();

jest.unstable_mockModule('@sentry/node', () => ({
  captureCheckIn: mockCaptureCheckIn,
  captureMessage: mockCaptureMessage,
}));

const {
  GuardedPriceOpsJobService,
  INVENTORY_PRICE_OPS_JOB_NAME,
  isFinalOperationPastRetention,
} = await import('./guarded-price-ops-job.service.js');
const { GUARDED_PRICE_RETENTION_MS } = await import(
  './guarded-price.constants.js'
);
const { testUuidV7At } = await import('./guarded-price.test-keys.js');

function createServiceMocks() {
  const tx = {
    $executeRaw: jest.fn(async () => 0),
    $queryRaw: jest.fn(async () => [] as Array<{ id: string }>),
    inventoryPriceOperation: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    ),
    inventoryPriceOperation: {
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      count: jest.fn(async () => 0),
    },
  };

  const systemPrisma = {
    withCronJobLock: jest.fn(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
        return true;
      },
    ),
    tenant: {
      findMany: jest.fn(async () => [{ id: 'tenant-1' }]),
    },
  };

  const requestContext = {
    runAsWorker: jest.fn(async (_tenantId: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  };

  return { tx, prisma, systemPrisma, requestContext };
}

describe('GuardedPriceOpsJobService', () => {
  beforeEach(() => {
    mockCaptureCheckIn.mockReset();
    mockCaptureCheckIn.mockReturnValue('check-in-id-1');
    mockCaptureMessage.mockReset();
  });

  it('cron monitor check-in', async () => {
    const { prisma, systemPrisma, requestContext } = createServiceMocks();
    const service = new GuardedPriceOpsJobService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
    );

    const ran = await service.run();

    expect(ran).toBe(true);
    expect(mockCaptureCheckIn).toHaveBeenNthCalledWith(
      1,
      {
        monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
        status: 'in_progress',
      },
      expect.objectContaining({
        schedule: { type: 'crontab', value: '0 * * * *' },
      }),
    );
    expect(mockCaptureCheckIn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        checkInId: 'check-in-id-1',
        monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
        status: 'ok',
        duration: expect.any(Number),
      }),
      expect.objectContaining({
        schedule: { type: 'crontab', value: '0 * * * *' },
      }),
    );

    mockCaptureCheckIn.mockReset();
    mockCaptureCheckIn.mockReturnValue('check-in-id-2');
    prisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(service.run()).rejects.toThrow('db down');
    expect(mockCaptureCheckIn).toHaveBeenNthCalledWith(
      1,
      {
        monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
        status: 'in_progress',
      },
      expect.objectContaining({
        schedule: { type: 'crontab', value: '0 * * * *' },
      }),
    );
    expect(mockCaptureCheckIn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        checkInId: 'check-in-id-2',
        monitorSlug: INVENTORY_PRICE_OPS_JOB_NAME,
        status: 'error',
        duration: expect.any(Number),
      }),
      expect.objectContaining({
        schedule: { type: 'crontab', value: '0 * * * *' },
      }),
    );
  });

  it('emits Sentry error alert when ACCEPTED rows older than 25h remain', async () => {
    const { prisma, systemPrisma, requestContext } = createServiceMocks();
    prisma.inventoryPriceOperation.count.mockResolvedValue(2);

    const service = new GuardedPriceOpsJobService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
    );
    const report = await service.runSweep(new Date());

    expect(report.staleAcceptedCount).toBe(2);
    expect(report.staleAlertEmitted).toBe(true);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('25h'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('retries transient batch errors before succeeding', async () => {
    const { prisma, systemPrisma, requestContext, tx } = createServiceMocks();
    let attempts = 0;
    prisma.$transaction.mockImplementation(async (fn) => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('lock timeout') as Error & { code?: string };
        err.code = '55P03';
        throw err;
      }
      return fn(tx);
    });

    const service = new GuardedPriceOpsJobService(
      prisma as never,
      systemPrisma as never,
      requestContext as never,
    );
    const report = await service.runSweep(new Date());

    expect(attempts).toBe(2);
    expect(report.fencedCount).toBe(0);
  });

  it('evaluates retention using max(final_at, key time) for final rows only', () => {
    const now = Date.now();
    const cutoffMs = now - GUARDED_PRICE_RETENTION_MS;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    const twentyNineDaysAgo = now - 29 * 24 * 60 * 60 * 1000;

    expect(
      isFinalOperationPastRetention(
        {
          state: InventoryPriceOperationState.ACCEPTED,
          key: testUuidV7At(thirtyOneDaysAgo),
          final_at: new Date(thirtyOneDaysAgo),
          accepted_at: new Date(thirtyOneDaysAgo),
        },
        cutoffMs,
      ),
    ).toBe(false);

    expect(
      isFinalOperationPastRetention(
        {
          state: InventoryPriceOperationState.FENCED,
          key: testUuidV7At(twentyNineDaysAgo),
          final_at: new Date(thirtyOneDaysAgo),
          accepted_at: new Date(thirtyOneDaysAgo),
        },
        cutoffMs,
      ),
    ).toBe(false);

    expect(
      isFinalOperationPastRetention(
        {
          state: InventoryPriceOperationState.APPLIED,
          key: testUuidV7At(thirtyOneDaysAgo),
          final_at: new Date(thirtyOneDaysAgo),
          accepted_at: new Date(thirtyOneDaysAgo),
        },
        cutoffMs,
      ),
    ).toBe(true);
  });
});
