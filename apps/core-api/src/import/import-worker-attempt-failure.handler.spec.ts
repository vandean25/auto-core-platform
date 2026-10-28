import { BadRequestException, Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ImportJobStatus } from '@prisma/client';
import { ImportApplyRetryExhaustedError } from './import-apply.errors.js';
import { handleImportWorkerAttemptFailure } from './import-worker-attempt-failure.handler.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportJobStore } from './import-job.store.js';

describe('handleImportWorkerAttemptFailure retry_exhausted', () => {
  it('logs import.job.failed when marking the job failed for a worker error', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const markFailedIfApplying = jest.fn(async () => ({ count: 1 }));
    const findJob = jest.fn(async () => ({
      attempts_without_progress: 2,
    }));
    await handleImportWorkerAttemptFailure(
      {
        jobStore: { markFailedIfApplying, findJob } as never,
        logger: new Logger('test'),
        workerFlow: {} as never,
      },
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'apply' },
      new Error('worker blew up'),
    ).catch(() => {});
    expect(markFailedIfApplying).toHaveBeenCalledWith(
      'tenant-1',
      'job-1',
      'apply_error',
      undefined,
      undefined,
    );
    expect(errorLog).toHaveBeenCalledWith(
      'import.job.failed jobId=job-1 phase=apply attempt=2 reason=apply_error cause=Error',
    );
    errorLog.mockRestore();
  });

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
      'import.job.failed jobId=job-1 phase=dry_run attempt=2 reason=retry_exhausted cause=ImportApplyRetryExhaustedError',
    );
  });
});

describe('handleImportWorkerAttemptFailure error detail', () => {
  function failedJobStore() {
    const markFailedIfApplying = jest.fn(async () => ({ count: 1 }));
    const findJob = jest.fn(async () => ({ attempts_without_progress: 0 }));
    return {
      markFailedIfApplying,
      findJob,
      store: { markFailedIfApplying, findJob } as never,
    };
  }

  async function failWith(error: unknown, jobStore: never) {
    await handleImportWorkerAttemptFailure(
      { jobStore, logger: new Logger('test'), workerFlow: {} as never },
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'dry_run' },
      error,
    ).catch(() => {});
  }

  it('stores the error code and message of a rejected worker request', async () => {
    const jobStore = failedJobStore();
    await failWith(
      new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_ENCODING,
        message: 'CSV must be UTF-8 encoded',
      }),
      jobStore.store,
    );
    expect(jobStore.markFailedIfApplying).toHaveBeenCalledWith(
      'tenant-1',
      'job-1',
      'apply_error',
      undefined,
      {
        code: IMPORT_ERROR_CODES.INVALID_ENCODING,
        message: 'CSV must be UTF-8 encoded',
      },
    );
  });

  it('logs the error code next to the failure reason', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    await failWith(
      new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_ENCODING,
        message: 'CSV must be UTF-8 encoded',
      }),
      failedJobStore().store,
    );
    expect(errorLog).toHaveBeenCalledWith(
      'import.job.failed jobId=job-1 phase=dry_run attempt=0 reason=apply_error cause=BadRequestException code=IMPORT_INVALID_ENCODING',
    );
    errorLog.mockRestore();
  });

  it('stores no detail for an error without an import error code', async () => {
    const jobStore = failedJobStore();
    await failWith(new Error('worker blew up'), jobStore.store);
    expect(jobStore.markFailedIfApplying).toHaveBeenCalledWith(
      'tenant-1',
      'job-1',
      'apply_error',
      undefined,
      undefined,
    );
  });
});
