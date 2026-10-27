import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ImportJobStatus } from '@prisma/client';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import { handleImportWorkerAttemptFailure } from './import-worker-attempt-failure.handler.js';
import type { ImportJobStore } from './import-job.store.js';

describe('handleImportWorkerAttemptFailure retry_exhausted', () => {
  it('logs import.job.failed when the job is already FAILED', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const jobStore = {
      findJob: jest.fn(async () => ({
        status: ImportJobStatus.FAILED,
        attempts_without_progress: 2,
        options_json: { apply_failure_reason: 'retry_exhausted' },
      })),
    } as unknown as ImportJobStore;
    await handleImportWorkerAttemptFailure(
      {
        jobStore,
        logger: new Logger('test'),
        workerFlow: {} as never,
      },
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'dry_run' },
      new ImportApplyRetryExhaustedError(new Error('P2028')),
    );
    expect(errorLog).toHaveBeenCalledWith(
      'import.job.failed jobId=job-1 phase=dry_run attempt=2 reason=retry_exhausted',
    );
  });
});
