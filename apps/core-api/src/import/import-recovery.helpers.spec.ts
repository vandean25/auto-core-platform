import { filterExpiredImportWorkerCandidates } from './import-recovery.helpers.js';

describe('filterExpiredImportWorkerCandidates', () => {
  const workerOptions = (leaseUntil: string) => ({
    worker: {
      phase: 'dry_run' as const,
      lease_token: 'lease',
      lease_until: leaseUntil,
      processed_rows: 0,
      started_at: new Date().toISOString(),
    },
  });

  it('returns jobs whose worker lease has expired', () => {
    const candidates = filterExpiredImportWorkerCandidates(
      [
        {
          id: 'job-1',
          tenant_id: 'tenant-a',
          options_json: workerOptions(new Date(0).toISOString()),
        },
      ],
      Date.now(),
    );

    expect(candidates).toEqual([
      { tenantId: 'tenant-a', jobId: 'job-1', phase: 'dry_run' },
    ]);
  });

  it('skips jobs whose lease is still active', () => {
    const candidates = filterExpiredImportWorkerCandidates(
      [
        {
          id: 'job-1',
          tenant_id: 'tenant-a',
          options_json: workerOptions(new Date(Date.now() + 60_000).toISOString()),
        },
      ],
      Date.now(),
    );

    expect(candidates).toEqual([]);
  });
});
