import { ImportJobStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ImportWorkerLeaseLostError } from './import-worker.errors.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobTotals } from './import.types.js';

export async function assertApplyWorkerLease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  jobId: string,
  leaseToken: string,
): Promise<void> {
  const job = await tx.importJob.findFirst({
    where: {
      tenant_id: tenantId,
      id: jobId,
      status: ImportJobStatus.APPLYING,
    },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  if (options.worker?.lease_token !== leaseToken) {
    throw new ImportWorkerLeaseLostError();
  }
}

/** Persists cursor, totals, and optionally APPLIED in the same transaction as the row write. */
export async function commitBackgroundApplyRowInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    jobId: string;
    leaseToken: string;
    applySeq: number;
    totals: ImportJobTotals;
    maxApplySeq: number;
  },
): Promise<boolean> {
  await assertApplyWorkerLease(
    tx,
    params.tenantId,
    params.jobId,
    params.leaseToken,
  );
  const job = await tx.importJob.findFirst({
    where: { tenant_id: params.tenantId, id: params.jobId },
  });
  if (!job) {
    throw new ImportWorkerLeaseLostError();
  }
  const options = job.options_json as ImportJobOptionsWithWorker;
  const worker = options.worker;
  if (!worker) {
    throw new ImportWorkerLeaseLostError();
  }
  const finished = params.applySeq >= params.maxApplySeq;
  const workerNext = {
    ...worker,
    last_committed_apply_seq: params.applySeq,
    processed_rows: params.applySeq,
  };
  await tx.importJob.update({
    where: { id: params.jobId },
    data: {
      totals_json: params.totals,
      options_json: { ...options, worker: workerNext },
      ...(finished
        ? {
            status: ImportJobStatus.APPLIED,
            appliedAt: new Date(),
          }
        : {}),
    },
  });
  return finished;
}
