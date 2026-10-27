import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ImportJobStatus } from '@prisma/client';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';
import { ImportJobStore } from './import-job.store.js';
import { setupImportHarness } from './import.service.spec.support.js';

describe('ImportService import.job.failed logging', () => {
  const h = setupImportHarness();

  beforeEach(() => {
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'http://127.0.0.1:3000/api/';
    h.cloudTasks.isEnabled.mockReturnValue(true);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  it('logs when poison cap marks the job FAILED', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const jobStore = (h.service as unknown as { jobStore: ImportJobStore })
      .jobStore;
    const job = {
      id: 'job-poison-log',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.FAILED,
      worker_claim_seq: 0,
      worker_recovery_seq: 0,
      attempts_without_progress: IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS,
      options_json: {
        apply_failure_reason: 'poison_cap',
        worker: {
          phase: 'dry_run',
          lease_token: 'token',
          lease_until: new Date(0).toISOString(),
          processed_rows: 0,
          claimed_processed_rows: 0,
          dry_run_reconcile_active: true,
          dry_run_reconcile_cursor: 0,
          started_at: new Date().toISOString(),
        },
      },
    };
    jest.spyOn(jobStore, 'claimWorkerLease').mockResolvedValue(null);
    jest.spyOn(jobStore, 'findJob').mockResolvedValue(job as never);

    await h.service.runImportWorkerAttempt({
      tenantId: 'tenant-1',
      jobId: 'job-poison-log',
      phase: 'dry_run',
    });

    expect(errorLog).toHaveBeenCalledWith(
      'import.job.failed jobId=job-poison-log phase=dry_run attempt=5 reason=poison_cap',
    );
  });
});
