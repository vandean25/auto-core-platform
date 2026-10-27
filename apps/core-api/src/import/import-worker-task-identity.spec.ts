import { deterministicImportWorkerTaskId } from './import-worker-task-identity.js';

describe('deterministicImportWorkerTaskId', () => {
  it('is stable for the same handoff identity', () => {
    const identity = {
      jobId: 'job-1',
      phase: 'apply' as const,
      chunkSeq: 50,
      claimSeq: 2,
      recoverySeq: 0,
    };
    expect(deterministicImportWorkerTaskId(identity)).toBe(
      deterministicImportWorkerTaskId(identity),
    );
  });

  it('changes when claim_seq or recovery_seq changes', () => {
    const base = {
      jobId: 'job-1',
      phase: 'apply' as const,
      chunkSeq: 50,
      claimSeq: 2,
      recoverySeq: 0,
    };
    expect(deterministicImportWorkerTaskId(base)).not.toBe(
      deterministicImportWorkerTaskId({ ...base, claimSeq: 3 }),
    );
    expect(deterministicImportWorkerTaskId(base)).not.toBe(
      deterministicImportWorkerTaskId({ ...base, recoverySeq: 1 }),
    );
  });

  it('uses the import-worker prefix and a 40 character digest', () => {
    expect(
      deterministicImportWorkerTaskId({
        jobId: 'job-1',
        phase: 'dry_run',
        chunkSeq: 0,
        claimSeq: 0,
        recoverySeq: 0,
      }),
    ).toMatch(/^import-worker-[a-f0-9]{40}$/);
  });
});
