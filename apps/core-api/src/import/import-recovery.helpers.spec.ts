import {
  filterExpiredImportWorkerCandidates,
  isImportWorkerHandoffStale,
} from './import-recovery.helpers.js';
import { IMPORT_WORKER_HANDOFF_GRACE_MS } from './import-worker-handoff.constants.js';

describe('isImportWorkerHandoffStale', () => {
  it('treats a missing handoff as stale', () => {
    expect(isImportWorkerHandoffStale(null, Date.now())).toBe(true);
  });

  it('treats a fresh handoff as not stale', () => {
    const now = Date.now();
    expect(
      isImportWorkerHandoffStale(new Date(now - 60_000), now),
    ).toBe(false);
  });

  it('treats a handoff older than the grace period as stale', () => {
    const now = Date.now();
    expect(
      isImportWorkerHandoffStale(
        new Date(now - IMPORT_WORKER_HANDOFF_GRACE_MS - 1),
        now,
      ),
    ).toBe(true);
  });
});

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

  it('returns jobs whose worker lease has expired and handoff is stale', () => {
    const candidates = filterExpiredImportWorkerCandidates(
      [
        {
          id: 'job-1',
          tenant_id: 'tenant-a',
          options_json: workerOptions(new Date(0).toISOString()),
          worker_handoff_at: new Date(
            Date.now() - IMPORT_WORKER_HANDOFF_GRACE_MS - 1,
          ),
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
          options_json: workerOptions(
            new Date(Date.now() + 60_000).toISOString(),
          ),
          worker_handoff_at: null,
        },
      ],
      Date.now(),
    );

    expect(candidates).toEqual([]);
  });

  it('skips expired leases with a fresh handoff_at', () => {
    const candidates = filterExpiredImportWorkerCandidates(
      [
        {
          id: 'job-1',
          tenant_id: 'tenant-a',
          options_json: workerOptions(new Date(0).toISOString()),
          worker_handoff_at: new Date(),
        },
      ],
      Date.now(),
    );

    expect(candidates).toEqual([]);
  });
});
