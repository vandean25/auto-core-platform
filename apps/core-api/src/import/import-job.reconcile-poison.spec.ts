import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import { ImportJobStore } from './import-job.store.js';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobTotals } from './import.types.js';

type InMemoryJob = {
  id: string;
  tenant_id: string;
  status: ImportJobStatus;
  worker_claim_seq: number;
  attempts_without_progress: number;
  options_json: ImportJobOptionsWithWorker;
  totals_json: ImportJobTotals;
};

function workerLeaseTokenMatches(
  where: {
    tenant_id?: string;
    id?: string;
    status?: ImportJobStatus;
    options_json?: { path?: string[]; equals?: string };
  },
  job: InMemoryJob,
): boolean {
  const worker = job.options_json.worker;
  if (
    where.tenant_id !== job.tenant_id ||
    where.id !== job.id ||
    where.status !== ImportJobStatus.APPLYING ||
    !worker
  ) {
    return false;
  }
  const path = where.options_json?.path;
  const equals = where.options_json?.equals;
  if (!path || path[0] !== 'worker' || path[1] !== 'lease_token') {
    return true;
  }
  return equals === worker.lease_token;
}

function applyJobUpdate(job: InMemoryJob, data: Record<string, unknown>) {
  if (data.options_json) {
    job.options_json = data.options_json;
  }
  if (typeof data.worker_claim_seq === 'number') {
    job.worker_claim_seq = data.worker_claim_seq;
  }
  if (typeof data.attempts_without_progress === 'number') {
    job.attempts_without_progress = data.attempts_without_progress;
  }
  if (data.status === ImportJobStatus.APPLYING || data.status === ImportJobStatus.FAILED) {
    job.status = data.status;
  }
}

function createStore(job: InMemoryJob) {
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        importJob: {
          findFirst: async () => job,
          updateMany: async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (!workerLeaseTokenMatches(where, job)) {
              return { count: 0 };
            }
            applyJobUpdate(job, data);
            return { count: 1 };
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            applyJobUpdate(job, data);
            return job;
          },
        },
        importJobRow: {
          update: async () => ({}),
          updateMany: async () => ({ count: 1 }),
          findMany: async () => [],
        },
      }),
    importJob: {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (!workerLeaseTokenMatches(where, job)) {
          return { count: 0 };
        }
        applyJobUpdate(job, data);
        return { count: 1 };
      },
    },
  };
  return new ImportJobStore(prisma as never);
}

const reconcileUnits = [
  {
    context_from_row: 1,
    context_to_row: 2,
    replan_row_nos: [1, 2],
  },
  {
    context_from_row: 10,
    context_to_row: 11,
    replan_row_nos: [10, 11],
  },
];

function reconcileWorker(leaseToken: string) {
  return {
    phase: 'dry_run' as const,
    lease_token: leaseToken,
    lease_until: new Date(0).toISOString(),
    processed_rows: 100,
    claimed_processed_rows: 100,
    started_at: new Date().toISOString(),
    dry_run_reconcile_active: true,
    dry_run_reconcile_cursor: 0,
    dry_run_reconcile_units: reconcileUnits,
  };
}

describe('reconcile poison progress', () => {
  it('resets attempts after persist advances the reconcile unit cursor and the next claim', async () => {
    const job: InMemoryJob = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 1,
      attempts_without_progress: 3,
      totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
      options_json: {
        worker: reconcileWorker('lease-before'),
      },
    };
    const store = createStore(job);

    const claimed = await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run');
    expect(claimed).not.toBeNull();
    if (!claimed) {
      return;
    }
    expect(job.attempts_without_progress).toBe(0);
    expect(claimed.claimed_processed_rows).toBe(0);

    const persisted = await store.persistDryRunReconcileChunk(
      'tenant-1',
      'job-1',
      [
        {
          row_no: 1,
          action: ImportRowAction.CREATE,
          external_id: 'a',
          entity_id: null,
          errors: [],
          warnings: [],
          normalized: null,
        },
        {
          row_no: 2,
          action: ImportRowAction.CREATE,
          external_id: 'b',
          entity_id: null,
          errors: [],
          warnings: [],
          normalized: null,
        },
      ],
      { dry_run_reconcile_cursor: 1 },
      job.options_json,
      claimed.lease_token,
    );
    expect(persisted).not.toBeNull();
    expect(job.attempts_without_progress).toBe(0);
    expect(job.options_json.worker?.dry_run_reconcile_cursor).toBe(1);

    const reclaimed = await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run');
    expect(reclaimed).not.toBeNull();
    if (!reclaimed) {
      return;
    }
    expect(job.attempts_without_progress).toBe(0);
    expect(reclaimed.claimed_processed_rows).toBe(1);
  });

  it('increments attempts when reconcile cursor does not advance and eventually fails the job', async () => {
    const job: InMemoryJob = {
      id: 'job-1',
      tenant_id: 'tenant-1',
      status: ImportJobStatus.APPLYING,
      worker_claim_seq: 1,
      attempts_without_progress: 0,
      totals_json: { rows: 4, create: 0, update: 0, skip: 0, error: 0 },
      options_json: {
        worker: reconcileWorker('lease-stuck'),
      },
    };
    const worker = job.options_json.worker;
    if (worker) {
      worker.claimed_processed_rows = 0;
    }
    const store = createStore(job);

    for (let attempt = 0; attempt < IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS - 1; attempt += 1) {
      const claimed = await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run');
      expect(claimed).not.toBeNull();
      expect(job.options_json.worker?.dry_run_reconcile_cursor).toBe(0);
      expect(job.attempts_without_progress).toBe(attempt + 1);
      const loopWorker = job.options_json.worker;
      if (loopWorker) {
        loopWorker.lease_until = new Date(0).toISOString();
      }
    }

    const failed = await store.claimWorkerLease('tenant-1', 'job-1', 'dry_run');
    expect(failed).toBeNull();
    expect(job.status).toBe(ImportJobStatus.FAILED);
    expect(job.attempts_without_progress).toBe(
      IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS,
    );
  });
});
