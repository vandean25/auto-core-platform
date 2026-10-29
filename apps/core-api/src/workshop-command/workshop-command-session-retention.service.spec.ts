import type { RequestContextService } from '../common/services/request-context.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { WorkshopCommandSessionService } from './workshop-command-session.service.js';
import { WorkshopCommandSessionRetentionService } from './workshop-command-session-retention.service.js';

function createHarness(purgeResults: Record<string, number | Error> = {}) {
  const tenants = ['tenant-a', 'tenant-b'];
  const purgeExpired = jest.fn(
    async (tenantId: string): Promise<number> => {
      const result = purgeResults[tenantId];
      if (result instanceof Error) throw result;
      return result ?? 0;
    },
  );
  const sessions = { purgeExpired } as unknown as WorkshopCommandSessionService;
  const runAsWorker = jest.fn(
    async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
  );
  const systemPrisma = {
    tenant: { findMany: jest.fn().mockResolvedValue(tenants.map((id) => ({ id }))) },
    withCronJobLock: jest.fn(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
        return true;
      },
    ),
  } as unknown as SystemPrismaService;
  const service = new WorkshopCommandSessionRetentionService(
    sessions,
    systemPrisma,
    { runAsWorker } as unknown as RequestContextService,
  );
  return { service, purgeExpired, runAsWorker, systemPrisma };
}

describe('WorkshopCommandSessionRetentionService', () => {
  it('purges every tenant, including one whose advisor never comes back', async () => {
    const h = createHarness();

    await h.service.run();

    expect(h.purgeExpired).toHaveBeenCalledWith('tenant-a', expect.any(Date));
    expect(h.purgeExpired).toHaveBeenCalledWith('tenant-b', expect.any(Date));
  });

  it('reports the advisory lock outcome so a second instance skips the sweep', async () => {
    const h = createHarness();
    (h.systemPrisma as unknown as { withCronJobLock: jest.Mock }).withCronJobLock.mockResolvedValue(
      false,
    );

    await expect(h.service.run()).resolves.toBe(false);
  });

  it('keeps sweeping the remaining tenants after one purge fails', async () => {
    const h = createHarness({ 'tenant-b': new Error('storage unavailable') });

    await expect(h.service.run()).resolves.toBe(true);

    expect(h.purgeExpired).toHaveBeenCalledWith('tenant-a', expect.any(Date));
    expect(h.purgeExpired).toHaveBeenCalledWith('tenant-b', expect.any(Date));
  });
});
