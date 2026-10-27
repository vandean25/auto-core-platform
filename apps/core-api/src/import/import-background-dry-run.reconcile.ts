import { ImportEntityType, ImportJobStatus } from '@prisma/client';
import type { DryRunRowResult, ImportJobTotals } from './import.types.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import { readImportCsvDataRowSlice } from './import-csv-stream.util.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { IMPORT_WORKER_BATCH_SIZE } from './import.constants.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';
import { computeImportDryRunReconcileRanges } from './import-dry-run-reconcile.groups.js';
import { tallyImportDryRunTotalsFromRows } from './import-dry-run-reconcile.totals.js';
import {
  enqueueImportWorkerContinuation,
  importWorkerTaskClaimSeqForHandoff,
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';
import { readUploadRef } from './import-job.worker-state.js';

export async function scheduleBackgroundDryRunAfterRowBatches(params: {
  jobStore: ImportJobStore;
  prisma: PrismaService;
  tenantId: string;
  jobId: string;
  entityType: ImportEntityType;
  options: ImportJobOptionsWithWorker;
  totals: ImportJobTotals;
  completeDryRun: () => Promise<void>;
  flow: ImportWorkerFlowDeps;
}): Promise<void> {
  const leaseToken = params.options.worker?.lease_token;
  if (!leaseToken) {
    return;
  }
  const ranges = await computeImportDryRunReconcileRanges(params.prisma, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    entityType: params.entityType,
    batchSize: IMPORT_WORKER_BATCH_SIZE,
  });
  if (ranges.length === 0) {
    await params.completeDryRun();
    return;
  }
  const began = await params.jobStore.beginBackgroundDryRunReconcile(
    params.tenantId,
    params.jobId,
    ranges,
    params.options,
    leaseToken,
  );
  if (!began) {
    await requeueImportWorkerAfterLeaseSkip(params.flow, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'dry_run',
    });
    return;
  }
  const refreshed = await params.jobStore.findJob(params.tenantId, params.jobId);
  if (!refreshed) {
    return;
  }
  await enqueueImportWorkerContinuation(params.flow, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: 'dry_run',
    claimSeq: refreshed.worker_claim_seq,
    recoverySeq: refreshed.worker_recovery_seq,
    chunkSeq: 0,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(refreshed.worker_claim_seq),
  });
}

export async function runBackgroundDryRunReconcileChunk(params: {
  jobStore: ImportJobStore;
  prisma: PrismaService;
  fileStorage: ImportFileStorageService;
  tenantId: string;
  jobId: string;
  handler: ImportTypeHandler;
  options: ImportJobOptionsWithWorker;
  job: {
    source_system: string;
    file_sha256: string;
    mapping_json: unknown;
    totals_json: unknown;
  };
  flow: ImportWorkerFlowDeps;
  completeDryRun: (totals: ImportJobTotals) => Promise<void>;
}): Promise<void> {
  const worker = params.options.worker;
  const upload = readUploadRef(params.options);
  const leaseToken = worker?.lease_token;
  const ranges = worker?.dry_run_reconcile_ranges ?? [];
  const startCursor = worker?.dry_run_reconcile_cursor ?? 0;
  if (!worker || !upload || !leaseToken || !worker.dry_run_reconcile_active) {
    return;
  }
  const chunkDeadlineMs = Date.now() + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
  const mapping = params.job.mapping_json as Record<string, string>;
  const totals = params.job.totals_json as ImportJobTotals;
  const replanned: DryRunRowResult[] = [];
  let cursor = startCursor;
  while (cursor < ranges.length && Date.now() < chunkDeadlineMs) {
    const range = ranges[cursor];
    const rowCount = range.to_row - range.from_row + 1;
    const parsed = await readImportCsvDataRowSlice(
      params.fileStorage.openReadStream(upload),
      range.from_row - 1,
      rowCount,
      params.job.file_sha256,
    );
    if (!parsed || parsed.rows.length === 0) {
      cursor += 1;
      continue;
    }
    const rows = await params.handler.planDryRun(
      {
        tenantId: params.tenantId,
        sourceSystem: params.job.source_system,
        mapping,
        options: params.options,
        planBudget: {
          deadlineMs: chunkDeadlineMs,
          rowNoOffset: range.from_row,
        },
      },
      parsed,
    );
    replanned.push(...rows);
    cursor += 1;
  }

  if (cursor === startCursor) {
    return;
  }

  const appended = await params.jobStore.overwriteDryRunRows(
    params.tenantId,
    params.jobId,
    replanned,
    { dry_run_reconcile_cursor: cursor },
    params.options,
    leaseToken,
  );
  if (!appended) {
    await requeueImportWorkerAfterLeaseSkip(params.flow, {
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'dry_run',
    });
    return;
  }

  if (cursor >= ranges.length) {
    const finalTotals = await tallyImportDryRunTotalsFromRows(
      params.prisma,
      params.tenantId,
      params.jobId,
      totals.rows,
    );
    await params.prisma.importJob.updateMany({
      where: {
        tenant_id: params.tenantId,
        id: params.jobId,
        status: ImportJobStatus.APPLYING,
      },
      data: { totals_json: finalTotals },
    });
    await params.completeDryRun(finalTotals);
    return;
  }

  await enqueueImportWorkerContinuation(params.flow, {
    tenantId: params.tenantId,
    jobId: params.jobId,
    phase: 'dry_run',
    claimSeq: appended.worker_claim_seq,
    recoverySeq: appended.worker_recovery_seq,
    chunkSeq: cursor,
    taskClaimSeq: importWorkerTaskClaimSeqForHandoff(appended.worker_claim_seq),
  });
}
