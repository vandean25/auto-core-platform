import { ImportEntityType, ImportJobStatus } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { ImportService } from './import.service.js';

describe('background apply missing apply_seq guard', () => {
  it('marks the job failed when rows exist but apply_seq was never filled', async () => {
    const markFailedIfApplying = jest.fn(async () => ({ count: 1 }));
    const jobStore = {
      findJob: jest.fn(async () => ({
        id: 'job-1',
        tenant_id: 'tenant-1',
        status: ImportJobStatus.APPLYING,
        entity_type: ImportEntityType.VEHICLE_PARTY,
        source_system: 'legacy',
        options_json: {
          worker: {
            phase: 'apply',
            lease_token: 't',
            lease_until: new Date(0).toISOString(),
            processed_rows: 0,
            last_committed_apply_seq: 0,
            started_at: new Date().toISOString(),
          },
        },
        totals_json: { rows: 3, create: 0, update: 0, skip: 0, error: 0 },
        created_by: 'user-1',
      })),
      maxApplySeq: jest.fn(async () => 0),
      countApplyRows: jest.fn(async () => 3),
      markFailedIfApplying,
      findApplyRowsAfterApplySeq: jest.fn(async () => []),
    } as unknown as ImportJobStore;
    const service = Object.create(ImportService.prototype) as ImportService;
    Object.assign(service, {
      jobStore,
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    });
    const context = await (
      service as unknown as {
        loadBackgroundApplyContext: (
          tenantId: string,
          jobId: string,
        ) => Promise<unknown>;
      }
    ).loadBackgroundApplyContext('tenant-1', 'job-1');
    expect(context).toBeNull();
    expect(markFailedIfApplying).toHaveBeenCalledWith(
      'tenant-1',
      'job-1',
      'apply_seq_missing',
    );
  });
});
