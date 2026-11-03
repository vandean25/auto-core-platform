import { randomUUID } from 'node:crypto';
import { ImportJobStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { isRetryableTransactionError } from '../common/prisma/is-retryable-transaction-error.js';
import {
  IMPORT_ROW_TX_MAX_ATTEMPTS,
  IMPORT_SERIALIZABLE_TX,
} from './import.constants.js';
import { importJobOptionsWithFailure } from './import-apply-failure.util.js';
import { advanceContiguousApplySeqWatermark } from './import-apply-sequence.js';
import { withoutTechnicalRetryRow } from './import-technical-retry.js';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import {
  isStaleApplyingImportJob,
  nextApplyLeaseUntil,
} from './import-apply-lease.js';
import {
  IMPORT_WORKER_LEASE_MS,
  importWorkerPoisonProgressCursor,
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportJobWorkerState,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import { IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS } from './import-worker-handoff.constants.js';
import { assertApplyWorkerLease } from './import-background-apply.commit.js';
import {
  delayMs,
  retryableTransactionDelayMs,
} from './import-transaction-retry.util.js';

/** Worker-lease claim, release and poison bookkeeping for APPLYING import jobs. */

export function applyingWorkerLeaseWhere(
  tenantId: string,
  jobId: string,
  leaseToken: string,
) {
  return {
    tenant_id: tenantId,
    id: jobId,
    status: ImportJobStatus.APPLYING,
    options_json: {
      path: ['worker', 'lease_token'],
      equals: leaseToken,
    },
  };
}

export async function lockWorkerLeaseOnApplyingJob(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const locked = await tx.importJob.updateMany({
    where: applyingWorkerLeaseWhere(tenantId, jobId, leaseToken),
    data: {},
  });
  return locked.count > 0;
}

export async function runInCapturedTenantContext<T>(
  fn: () => Promise<T>,
  tenantUser = TenantContextStorage.getUser(),
): Promise<T> {
  if (!tenantUser?.tenantId) {
    return fn();
  }
  return new Promise<T>((resolve, reject) => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setUser(tenantUser);
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

export function isPrismaTransactionExpired(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2028'
  );
}

async function markImportJobFailedInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    where: Prisma.ImportJobWhereInput;
    applyFailureReason: 'poison_cap' | 'retry_exhausted';
    attemptsWithoutProgress?: number;
  },
): Promise<number> {
  const job = await tx.importJob.findFirst({
    where: { tenant_id: params.tenantId, id: params.jobId },
    select: { options_json: true },
  });
  const options = importJobOptionsWithFailure(
    job?.options_json,
    params.applyFailureReason,
  );
  const updated = await tx.importJob.updateMany({
    where: params.where,
    data: {
      status: ImportJobStatus.FAILED,
      failed_at: new Date(),
      options_json: options,
      ...(params.attemptsWithoutProgress !== undefined
        ? { attempts_without_progress: params.attemptsWithoutProgress }
        : {}),
    },
  });
  return updated.count;
}

async function failImportJobForWorkerPoison(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  nextAttempts: number,
): Promise<void> {
  await markImportJobFailedInTransaction(tx, {
    tenantId,
    jobId,
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
    applyFailureReason: 'poison_cap',
    attemptsWithoutProgress: nextAttempts,
  });
}

export async function failImportJobForRetryExhausted(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const count = await markImportJobFailedInTransaction(tx, {
    tenantId,
    jobId,
    where: applyingWorkerLeaseWhere(tenantId, jobId, leaseToken),
    applyFailureReason: 'retry_exhausted',
  });
  return count > 0;
}

async function claimWorkerLeaseInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  phase: ImportWorkerPhase,
): Promise<ImportJobWorkerState | null> {
  const job = await tx.importJob.findFirst({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
  });
  if (!job) {
    return null;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const worker = readWorkerState(options);
  if (!worker) {
    return adoptStaleApplyLease(tx, tenantId, jobId, phase, job, options);
  }
  if (worker.phase !== phase) {
    return null;
  }
  const now = Date.now();
  if (workerLeaseBlocksClaim(worker, now)) {
    return null;
  }
  const cursorAtClaim = importWorkerPoisonProgressCursor(worker);
  const nextAttempts = nextAttemptsWithoutProgress(
    worker,
    cursorAtClaim,
    job.attempts_without_progress,
  );
  if (nextAttempts >= IMPORT_WORKER_POISON_ATTEMPTS_WITHOUT_PROGRESS) {
    await failImportJobForWorkerPoison(tx, tenantId, jobId, nextAttempts);
    return null;
  }
  const refreshed: ImportJobWorkerState = {
    ...worker,
    lease_token: randomUUID(),
    lease_until: new Date(now + IMPORT_WORKER_LEASE_MS).toISOString(),
    claimed_processed_rows: cursorAtClaim,
  };
  const locked = await tx.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
      options_json: {
        path: ['worker', 'lease_token'],
        equals: worker.lease_token,
      },
    },
    data: {
      options_json: { ...options, worker: refreshed },
      worker_claim_seq: job.worker_claim_seq + 1,
      attempts_without_progress: nextAttempts,
    },
  });
  if (locked.count === 0) {
    return null;
  }
  return refreshed;
}

function workerLeaseBlocksClaim(
  worker: ImportJobWorkerState,
  nowMs: number,
): boolean {
  const leaseUntil = Date.parse(worker.lease_until);
  return Number.isFinite(leaseUntil) && leaseUntil > nowMs;
}

function nextAttemptsWithoutProgress(
  worker: ImportJobWorkerState,
  cursorAtClaim: number,
  priorAttempts: number,
): number {
  const noProgressSinceLastClaim =
    worker.claimed_processed_rows !== undefined &&
    cursorAtClaim === worker.claimed_processed_rows;
  return noProgressSinceLastClaim ? priorAttempts + 1 : 0;
}

async function adoptStaleApplyLease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  phase: ImportWorkerPhase,
  job: {
    status: ImportJobStatus;
    options_json: unknown;
    updatedAt?: Date | null;
    worker_claim_seq: number;
  },
  options: ImportJobOptionsWithWorker,
): Promise<ImportJobWorkerState | null> {
  const now = Date.now();
  if (!isStaleApplyingImportJob(job, now)) {
    return null;
  }
  const refreshed: ImportJobWorkerState = {
    phase,
    lease_token: randomUUID(),
    lease_until: nextApplyLeaseUntil(now),
    processed_rows: 0,
    last_committed_apply_seq: 0,
    started_at: new Date(now).toISOString(),
  };
  const locked = await tx.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
      OR: [
        { options_json: { path: ['worker'], equals: Prisma.AnyNull } },
        {
          options_json: {
            path: ['worker', 'lease_token'],
            equals: Prisma.AnyNull,
          },
        },
      ],
    },
    data: {
      options_json: { ...options, worker: refreshed },
      worker_claim_seq: job.worker_claim_seq + 1,
    },
  });
  if (locked.count === 0) {
    return null;
  }
  return refreshed;
}

export async function claimWorkerLease(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  phase: ImportWorkerPhase,
): Promise<ImportJobWorkerState | null> {
  for (let attempt = 0; attempt < IMPORT_ROW_TX_MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => claimWorkerLeaseInTransaction(tx, tenantId, jobId, phase),
        IMPORT_SERIALIZABLE_TX,
      );
    } catch (error) {
      if (!isRetryableTransactionError(error)) {
        throw error;
      }
      if (attempt < IMPORT_ROW_TX_MAX_ATTEMPTS - 1) {
        await delayMs(retryableTransactionDelayMs(attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function releaseWorkerLeaseForRetry(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const job = await prisma.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
  });
  if (!job) {
    return false;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  if (options.worker?.lease_token !== leaseToken) {
    return false;
  }
  const worker = {
    ...options.worker,
    lease_until: new Date(0).toISOString(),
  };
  const updated = await prisma.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
      options_json: {
        path: ['worker', 'lease_token'],
        equals: leaseToken,
      },
    },
    data: { options_json: { ...options, worker } },
  });
  return updated.count > 0;
}

export async function releaseWorkerLeaseForHandoff(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const job = await prisma.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
  });
  if (!job) {
    return false;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  if (options.worker?.lease_token !== leaseToken) {
    return false;
  }
  const worker = {
    ...options.worker,
    lease_until: new Date(0).toISOString(),
  };
  const updated = await prisma.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
      options_json: {
        path: ['worker', 'lease_token'],
        equals: leaseToken,
      },
    },
    data: {
      options_json: { ...options, worker },
      worker_handoff_at: new Date(),
      updatedAt: new Date(),
    },
  });
  return updated.count > 0;
}

export async function extendWorkerLease(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<boolean> {
  const job = await prisma.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
  });
  if (!job) {
    return false;
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  if (options.worker?.lease_token !== leaseToken) {
    return false;
  }
  const leaseUntil = new Date(
    Date.now() + IMPORT_WORKER_LEASE_MS,
  ).toISOString();
  const worker = { ...options.worker, lease_until: leaseUntil };
  const updated = await prisma.importJob.updateMany({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
      options_json: {
        path: ['worker', 'lease_token'],
        equals: leaseToken,
      },
    },
    data: { options_json: { ...options, worker } },
  });
  return updated.count > 0;
}

export function touchWorkerHandoff(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
) {
  return prisma.importJob.updateMany({
    where: { tenant_id: tenantId, id: jobId },
    data: { worker_handoff_at: new Date() },
  });
}

export async function confirmWorkerRecoveryHandoff(
  prisma: PrismaService,
  tenantId: string,
  jobId: string,
  recoverySeq: number,
): Promise<void> {
  await prisma.importJob.updateMany({
    where: { tenant_id: tenantId, id: jobId },
    data: {
      worker_recovery_seq: recoverySeq,
      worker_handoff_at: new Date(),
    },
  });
}

export async function commitApplyWorkerRowInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
  applySeq: number,
  rowNo?: number,
): Promise<void> {
  await assertApplyWorkerLease(tx, tenantId, jobId, leaseToken);
  const job = await tx.importJob.findFirst({
    where: { tenant_id: tenantId, id: jobId },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const workerState = options.worker;
  if (!workerState) {
    return;
  }
  const applyWatermark = advanceContiguousApplySeqWatermark(
    workerState.last_committed_apply_seq ?? 0,
    applySeq,
  );
  const worker = withoutTechnicalRetryRow(
    {
      ...workerState,
      last_committed_apply_seq: applyWatermark,
      processed_rows: applyWatermark,
    },
    rowNo,
  );
  await tx.importJob.update({
    where: { id: jobId },
    data: { options_json: { ...options, worker } },
  });
}
