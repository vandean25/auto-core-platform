import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { setupImportHarness } from './import.service.spec.support.js';

describe('ImportService.recoverStaleImportJobs', () => {
  const h = setupImportHarness();
  let activeTenant = '';

  beforeEach(() => {
    activeTenant = '';
    h.systemPrisma.withCronJobLock.mockImplementation(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
        return true;
      },
    );
    h.requestContext.runAsWorker = jest.fn(
      async (tenantId: string, fn: () => Promise<void>) => {
        activeTenant = tenantId;
        await fn();
      },
    );
    h.systemPrisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-a' },
      { id: 'tenant-b' },
    ]);
    h.prisma.importJob.findMany = jest.fn().mockImplementation(() => {
      if (activeTenant === 'tenant-a') {
        return Promise.resolve([
          {
            id: 'job-a',
            tenant_id: 'tenant-a',
            options_json: {
              worker: {
                phase: 'dry_run',
                lease_token: 'lease',
                lease_until: new Date(0).toISOString(),
                processed_rows: 0,
                started_at: new Date().toISOString(),
              },
            },
          },
        ]);
      }
      if (activeTenant === 'tenant-b') {
        return Promise.reject(new Error('tenant-b listing failed'));
      }
      return Promise.resolve([]);
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest
      .spyOn(h.service, 'runImportWorkerAttempt')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recovers stale jobs per tenant and continues when one tenant fails', async () => {
    await h.service.recoverStaleImportJobs();

    expect(h.service.runImportWorkerAttempt).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      jobId: 'job-a',
      phase: 'dry_run',
    });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
