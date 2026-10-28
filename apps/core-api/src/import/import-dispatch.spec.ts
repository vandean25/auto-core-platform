import { enqueueOrRunImportWorker } from './import-dispatch.js';

describe('enqueueOrRunImportWorker', () => {
  it('runs a delayed inline retry after the delay, not on the current call', async () => {
    jest.useFakeTimers();
    const runInline = jest.fn(async () => undefined);
    const result = await enqueueOrRunImportWorker({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'apply',
      cloudTasks: {
        isEnabled: () => false,
        enqueueImportWorker: async () => undefined,
      },
      targetBaseUrl: undefined,
      nodeEnv: 'test',
      taskIdentity: {
        jobId: 'job-1',
        phase: 'apply',
        chunkSeq: 0,
        claimSeq: 1,
        recoverySeq: 0,
      },
      delaySeconds: 2,
      runInline,
    });

    expect(result.mode).toBe('inline');
    expect(runInline).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1999);
    expect(runInline).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(runInline).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
