import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { setupImportHarness } from './import.service.spec.support.js';

describe('ImportService.recoverStaleImportJobs', () => {
  const h = setupImportHarness();
  let activeTenant = '';

  beforeEach(() => {
    activeTenant = '';
    h.cloudTasks.isEnabled.mockReturnValue(true);
    h.cloudTasks.enqueueImportWorker.mockResolvedValue(undefined);
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
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
            worker_handoff_at: new Date(0),
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
    h.prisma.importJob.findFirst = jest.fn(async () => ({
      id: 'job-a',
      tenant_id: 'tenant-a',
      worker_claim_seq: 2,
      worker_recovery_seq: 1,
      options_json: {
        worker: {
          phase: 'dry_run',
          lease_token: 'lease',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          started_at: new Date().toISOString(),
        },
      },
    }));
    h.prisma.importJob.updateMany = jest.fn(async () => ({ count: 1 }));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest
      .spyOn(h.service, 'runImportWorkerAttempt')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
  });

  it('enqueues recovery tasks per tenant and never runs the worker inline', async () => {
    await h.service.recoverStaleImportJobs();

    expect(h.cloudTasks.enqueueImportWorker).toHaveBeenCalled();
    expect(h.service.runImportWorkerAttempt).not.toHaveBeenCalled();
    expect(h.prisma.importJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ worker_recovery_seq: 2 }),
      }),
    );
  });
});
