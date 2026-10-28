import { ImportJobStatus } from '@prisma/client';
import {
  IMPORT_WORKER_LEASE_MS,
  readWorkerState,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';

/** A sync or background apply unit stops around this budget, then the lease is extended. */
export const IMPORT_APPLY_UNIT_BUDGET_MS = 30_000;

/** APPLYING with no lease is stale once the row has not been written for this long. */
export const IMPORT_STALE_APPLY_WITHOUT_LEASE_MS = 5 * 60 * 1000;

export function leaseExpiresAtOf(
  options: ImportJobOptionsWithWorker | null | undefined,
): string | null {
  const worker = readWorkerState(options);
  return worker?.lease_until ?? null;
}

export function isStaleApplyingImportJob(
  job: {
    status: ImportJobStatus;
    options_json: unknown;
    updatedAt?: Date | string | null;
  },
  nowMs: number,
): boolean {
  if (job.status !== ImportJobStatus.APPLYING) {
    return false;
  }
  const worker = readWorkerState(
    job.options_json as ImportJobOptionsWithWorker,
  );
  if (worker) {
    const leaseUntil = Date.parse(worker.lease_until);
    return !Number.isFinite(leaseUntil) || leaseUntil < nowMs;
  }
  const updatedMs = readUpdatedAtMs(job.updatedAt);
  if (updatedMs === null) {
    return false;
  }
  return nowMs - updatedMs >= IMPORT_STALE_APPLY_WITHOUT_LEASE_MS;
}

export function applyLeaseHolderPrefix(
  leaseToken: string | null | undefined,
): string {
  if (!leaseToken) {
    return 'none';
  }
  return leaseToken.slice(0, 8);
}

export function nextApplyLeaseUntil(nowMs: number): string {
  return new Date(nowMs + IMPORT_WORKER_LEASE_MS).toISOString();
}

function readUpdatedAtMs(
  updatedAt: Date | string | null | undefined,
): number | null {
  if (!updatedAt) {
    return null;
  }
  const ms =
    updatedAt instanceof Date ? updatedAt.getTime() : Date.parse(updatedAt);
  return Number.isFinite(ms) ? ms : null;
}
