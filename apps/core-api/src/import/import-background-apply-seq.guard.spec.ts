import { Logger } from '@nestjs/common';
import { ImportEntityType, ImportJobStatus } from '@prisma/client';
import type { ImportJobStore } from './import-job.store.js';
import {
  ImportWorkerOrchestration,
  type ImportWorkerOrchestrationDeps,
} from './import-worker-orchestration.js';

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
    const orchestration = new ImportWorkerOrchestration({
      logger: new Logger('test'),
      jobStore,
      handlers: {},
    } as unknown as ImportWorkerOrchestrationDeps);
    const context = await orchestration.loadBackgroundApplyContext(
      'tenant-1',
      'job-1',
    );
    expect(context).toBeNull();
    expect(markFailedIfApplying).toHaveBeenCalledWith(
      'tenant-1',
      'job-1',
      'apply_seq_missing',
    );
  });
});
