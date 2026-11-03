import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ImportJobStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import type { ImportFileStorageService } from './import-file.storage.js';
import type { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import type { ImplementedImportEntityType } from './import-entity-type.registry.js';
import type {
  ImportApplyRow,
  ImportTypeHandler,
} from './import-type-handler.js';
import { assertImplementedImportEntityType } from './import-entity-type.guard.js';
import {
  enqueueImportWorkerContinuation,
  enqueueImportWorkerRecoveryHandoff,
  handoffImportWorkerAfterBatch,
  isApplyingImportWorkerForPhase,
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';
import { resolveImportWorkerTargetBaseUrl } from './import-worker-target.js';
import { handleImportWorkerAttemptFailure } from './import-worker-attempt-failure.handler.js';
import { logImportJobFailed } from './import-job-failed-log.util.js';
import { filterExpiredImportWorkerCandidates } from './import-recovery.helpers.js';
import {
  readUploadRef,
  readWorkerState,
  type ImportJobOptionsWithWorker,
  type ImportWorkerPhase,
} from './import-job.worker-state.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import { IMPORT_APPLY_UNIT_BUDGET_MS } from './import-apply-lease.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';
import { IMPORT_APPLY_BATCH_SIZE } from './import.constants.js';
import { readImportWorkerBatchSize } from './import-limits.js';
import {
  mergeDryRunBatchTotals,
  persistDryRunBatchAndHandoff,
} from './import-background-dry-run.batch.js';
import {
  runBackgroundDryRunReconcileChunk,
  scheduleBackgroundDryRunAfterRowBatches,
} from './import-background-dry-run.reconcile.js';
import {
  readWorkerCsvBatchFromRanges,
  byteOffsetAfterPersistedRows,
} from './import-csv-stream.util.js';
import { mergeTechnicalRetryBatch } from './import-technical-retry.js';
import { deleteImportJobUpload } from './import-upload-delete.util.js';

export type ImportWorkerOrchestrationDeps = {
  logger: Logger;
  prisma: PrismaService;
  systemPrisma: SystemPrismaService;
  requestContext: RequestContextService;
  jobStore: ImportJobStore;
  fileStorage: ImportFileStorageService;
  cloudTasks: ImportCloudTasksService;
  audit: ImportAuditWriter;
  handlers: Record<ImplementedImportEntityType, ImportTypeHandler>;
};

/**
 * Runs the background import worker: lease claiming, dry-run batches and apply
 * batches, plus stale-lease recovery. The facade hands each Cloud Task attempt
 * back to `runWorkerAttempt` and runs inline where Cloud Tasks are disabled.
 */
export class ImportWorkerOrchestration {
  constructor(private readonly deps: ImportWorkerOrchestrationDeps) {}

  /** Test seam: the facade replaces this to run attempts in-process. */
  runWorkerInlineForJob(tenantId: string, jobId: string) {
    return (phase: ImportWorkerPhase) =>
      this.runWorkerAttempt({ tenantId, jobId, phase });
  }

  importWorkerFlowDeps(
    runInline: (phase: ImportWorkerPhase) => Promise<void>,
  ): ImportWorkerFlowDeps {
    return {
      jobStore: this.deps.jobStore,
      cloudTasks: this.deps.cloudTasks,
      targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
      nodeEnv: process.env.NODE_ENV,
      runInline,
      logger: this.deps.logger,
    };
  }

  workerFlowForJob(tenantId: string, jobId: string): ImportWorkerFlowDeps {
    return this.importWorkerFlowDeps(
      this.runWorkerInlineForJob(tenantId, jobId),
    );
  }

  workerFlowForRecovery(): ImportWorkerFlowDeps {
    return this.importWorkerFlowDeps(() => {
      throw new Error('Import worker recovery must not run inline');
    });
  }

  async enqueueInitialWorker(
    tenantId: string,
    jobId: string,
    phase: ImportWorkerPhase,
  ): Promise<void> {
    const job = await this.deps.jobStore.findJob(tenantId, jobId);
    if (!job) {
      return;
    }
    await enqueueImportWorkerContinuation(
      this.workerFlowForJob(tenantId, jobId),
      {
        tenantId,
        jobId,
        phase,
        claimSeq: job.worker_claim_seq,
        recoverySeq: job.worker_recovery_seq,
      },
    );
  }

  async runWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  }): Promise<void> {
    try {
      await this.runClaimedWorkerBatch(params);
    } catch (error) {
      await this.failWorkerAttemptUnlessContention(
        { ...params, phase: params.phase },
        error,
      );
    }
  }

  async runClaimedWorkerBatch(params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  }): Promise<void> {
    const { jobStore, logger, prisma } = this.deps;
    const claimed = await jobStore.claimWorkerLease(
      params.tenantId,
      params.jobId,
      params.phase,
    );
    if (!claimed) {
      const jobAfterClaim = await jobStore.findJob(
        params.tenantId,
        params.jobId,
      );
      if (jobAfterClaim?.status === ImportJobStatus.FAILED) {
        const optionsAfterClaim =
          jobAfterClaim.options_json as ImportJobOptions;
        const failureReason = optionsAfterClaim.apply_failure_reason;
        if (failureReason) {
          logImportJobFailed(logger, {
            jobId: params.jobId,
            phase: params.phase,
            attempt: jobAfterClaim.attempts_without_progress,
            reason: failureReason,
            code: optionsAfterClaim.apply_failure_code,
          });
        }
      } else {
        await requeueImportWorkerAfterLeaseSkip(
          this.workerFlowForJob(params.tenantId, params.jobId),
          params,
        );
      }
      return;
    }
    const job = await jobStore.findJob(params.tenantId, params.jobId);
    const options = job?.options_json as ImportJobOptionsWithWorker;
    if (!isApplyingImportWorkerForPhase(job, options, params.phase)) {
      return;
    }
    if (params.phase === 'dry_run') {
      await this.runBackgroundDryRunBatch(params.tenantId, params.jobId);
      return;
    }
    await this.runBackgroundApplyBatch(params.tenantId, params.jobId);
  }

  async failWorkerAttemptUnlessContention(
    params: {
      tenantId: string;
      jobId: string;
      phase: ImportWorkerPhase;
    },
    error: unknown,
  ): Promise<void> {
    await handleImportWorkerAttemptFailure(
      {
        jobStore: this.deps.jobStore,
        logger: this.deps.logger,
        workerFlow: this.workerFlowForJob(params.tenantId, params.jobId),
      },
      params,
      error,
    );
  }

  async recoverStaleImportJobs(): Promise<boolean> {
    const { systemPrisma, requestContext, prisma, logger, jobStore } =
      this.deps;
    return systemPrisma.withCronJobLock(
      'import-job-worker-recovery',
      async () => {
        const tenants = await systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = Date.now();
        const candidates: ReturnType<
          typeof filterExpiredImportWorkerCandidates
        > = [];
        for (const { id: tenantId } of tenants) {
          try {
            await requestContext.runAsWorker(
              tenantId,
              async () => {
                const stale = await prisma.importJob.findMany({
                  where: { status: ImportJobStatus.APPLYING },
                  select: {
                    id: true,
                    tenant_id: true,
                    options_json: true,
                    worker_handoff_at: true,
                  },
                  take: 50,
                });
                candidates.push(
                  ...filterExpiredImportWorkerCandidates(stale, now),
                );
              },
              { workerId: 'import-job-worker-recovery' },
            );
          } catch (cause) {
            logger.warn(
              `Import worker recovery listing failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown'}`,
            );
          }
        }
        for (const candidate of candidates.slice(0, 50)) {
          try {
            await requestContext.runAsWorker(
              candidate.tenantId,
              () =>
                enqueueImportWorkerRecoveryHandoff(
                  this.workerFlowForRecovery(),
                  candidate,
                ),
              { workerId: 'import-job-worker-recovery' },
            );
          } catch (cause) {
            logger.error(
              `Import worker recovery enqueue failed: ${cause instanceof Error ? cause.message : 'unknown'}`,
            );
            throw cause;
          }
        }
      },
      logger,
    );
  }

  async runBackgroundDryRunBatch(
    tenantId: string,
    jobId: string,
  ): Promise<void> {
    const { jobStore, prisma, fileStorage, handlers, logger } = this.deps;
    const job = await jobStore.findJob(tenantId, jobId);
    if (!job) {
      return;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    const worker = readWorkerState(options);
    const upload = readUploadRef(options);
    if (!worker || !upload) {
      return;
    }
    const handler =
      handlers[job.entity_type as ImplementedImportEntityType];
    const mapping = job.mapping_json as Record<string, string>;
    const totals = job.totals_json as ImportJobTotals;
    if (worker.dry_run_reconcile_active) {
      await runBackgroundDryRunReconcileChunk({
        jobStore,
        prisma,
        fileStorage,
        tenantId,
        jobId,
        handler,
        options,
        job,
        flow: this.workerFlowForJob(tenantId, jobId),
        completeDryRun: (finalTotals) =>
          this.completeBackgroundDryRun(
            tenantId,
            jobId,
            handler,
            options,
            finalTotals,
          ),
      });
      return;
    }
    const startOffset = worker.processed_rows;
    const chunkDeadlineMs = Date.now() + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
    const workerBatchSize = readImportWorkerBatchSize();
    const parsedBatch = await readWorkerCsvBatchFromRanges(
      (start, end) => fileStorage.readByteRange(upload, start, end),
      worker,
      workerBatchSize,
      job.file_sha256,
    );
    if (!parsedBatch || parsedBatch.rows.length === 0) {
      const processedRows = worker.processed_rows ?? 0;
      if (processedRows >= totals.rows) {
        await scheduleBackgroundDryRunAfterRowBatches({
          jobStore,
          prisma,
          tenantId,
          jobId,
          entityType: job.entity_type,
          options,
          totals,
          flow: this.workerFlowForJob(tenantId, jobId),
          completeDryRun: () =>
            this.completeBackgroundDryRun(tenantId, jobId, handler, options),
        });
      }
      return;
    }
    const batchRows = parsedBatch.rows;

    await Sentry.startSpan(
      {
        name: 'Import dry-run batch',
        op: 'import.dry_run.batch',
        attributes: {
          jobId,
          batchStart: startOffset,
          batchSize: batchRows.length,
        },
      },
      async () => {
        const rows = await handler.planDryRun(
          {
            tenantId,
            sourceSystem: job.source_system,
            mapping,
            options,
            planBudget: {
              deadlineMs: chunkDeadlineMs,
              rowNoOffset: startOffset + 1,
            },
          },
          parsedBatch,
        );
        const processed = startOffset + rows.length;
        const mergedTotals = mergeDryRunBatchTotals(totals, rows, processed);
        if (rows.length === 0) {
          return;
        }
        await persistDryRunBatchAndHandoff({
          jobStore,
          flow: this.workerFlowForJob(tenantId, jobId),
          tenantId,
          jobId,
          handler,
          options,
          rows,
          mergedTotals,
          processed,
          totalRows: totals.rows,
          csvCheckpoint: {
            csv_next_byte: byteOffsetAfterPersistedRows(
              parsedBatch,
              rows.length,
            ),
            csv_headers: parsedBatch.headers,
            csv_delimiter: parsedBatch.delimiter,
          },
          onAllRowBatchesDone: () =>
            scheduleBackgroundDryRunAfterRowBatches({
              jobStore,
              prisma,
              tenantId,
              jobId,
              entityType: job.entity_type,
              options,
              totals: mergedTotals,
              flow: this.workerFlowForJob(tenantId, jobId),
              completeDryRun: () =>
                this.completeBackgroundDryRun(
                  tenantId,
                  jobId,
                  handler,
                  options,
                ),
            }),
        });
      },
    );
  }

  async completeBackgroundDryRun(
    tenantId: string,
    jobId: string,
    handler: ImportTypeHandler,
    options: ImportJobOptionsWithWorker,
    totalsOverride?: ImportJobTotals,
  ) {
    const { jobStore, prisma } = this.deps;
    const job = await jobStore.findJob(tenantId, jobId);
    if (!job) {
      return;
    }
    let finalTotals = totalsOverride ?? (job.totals_json as ImportJobTotals);
    if (handler.finishCreate) {
      const pageSize = readImportWorkerBatchSize();
      let skip = 0;
      while (true) {
        const [batch] = await jobStore.findRowsPage(
          { tenant_id: tenantId, import_job_id: jobId },
          skip,
          pageSize,
        );
        if (batch.length === 0) {
          break;
        }
        const dryRunRows = batch.map((row) => ({
          row_no: row.row_no,
          external_id: row.external_id,
          action: row.action,
          entity_id: row.entity_id,
          errors: (row.errors_json as never[]) ?? [],
          warnings: (row.warnings_json as never[]) ?? [],
          normalized: row.normalized_json as Record<string, unknown> | null,
        }));
        finalTotals = await handler.finishCreate({
          tenantId,
          jobId,
          rows: dryRunRows,
          totals: finalTotals,
        });
        skip += batch.length;
        if (batch.length < pageSize) {
          break;
        }
      }
    }
    const optionsForPersist = { ...options };
    delete (optionsForPersist as { worker?: unknown }).worker;
    const finished = await jobStore.finishDryRunIfStillApplying(
      tenantId,
      jobId,
      {
        totals_json: finalTotals,
        options_json: optionsForPersist,
      },
    );
    if (finished.count === 0 && job.status === ImportJobStatus.DRY_RUN_DONE) {
      await prisma.importJob.updateMany({
        where: {
          tenant_id: tenantId,
          id: jobId,
          status: ImportJobStatus.DRY_RUN_DONE,
        },
        data: {
          totals_json: finalTotals,
          options_json: optionsForPersist,
        },
      });
    }
  }

  async runBackgroundApplyBatch(
    tenantId: string,
    jobId: string,
  ): Promise<void> {
    const context = await this.loadBackgroundApplyContext(tenantId, jobId);
    if (!context) {
      return;
    }
    const result = await context.handler.apply({
      tenantId,
      job: context.job,
      rows: context.rows,
      actorUserId: context.job.created_by ?? 'import-worker',
      effectiveOptions: context.effectiveOptions,
      preparation: context.preparation,
      batchOptions: {
        resumeAfterApplySeq: context.resumeAfter,
        stopAfterBatch: true,
        hasMoreRowsAfterBatch: context.hasMoreRowsAfterBatch,
        useApplySequence: true,
        maxApplySeq: context.maxApplySeq,
        leaseToken: context.worker.lease_token,
        chunkDeadlineMs: Date.now() + IMPORT_APPLY_UNIT_BUDGET_MS,
      },
    });
    if (result.status === ImportJobStatus.APPLIED) {
      await deleteImportJobUpload(
        this.deps.fileStorage,
        context.job.options_json as ImportJobOptionsWithWorker,
      );
    }
    await this.continueBackgroundApplyIfNeeded({
      tenantId,
      jobId,
      worker: context.worker,
      rows: context.rows,
      resumeAfter: context.resumeAfter,
      resultStatus: result.status,
    });
  }

  async failBackgroundApplyWhenApplySeqMissing(
    tenantId: string,
    jobId: string,
    rowCount: number,
    maxApplySeq: number,
  ): Promise<boolean> {
    if (rowCount === 0 || maxApplySeq !== 0) {
      return false;
    }
    const failed = await this.deps.jobStore.markFailedIfApplying(
      tenantId,
      jobId,
      'apply_seq_missing',
    );
    if (failed.count > 0) {
      const failedJob = await this.deps.jobStore.findJob(tenantId, jobId);
      logImportJobFailed(this.deps.logger, {
        jobId,
        phase: 'apply',
        attempt: failedJob?.attempts_without_progress ?? 0,
        reason: 'apply_seq_missing',
      });
    }
    return true;
  }

  async readBackgroundApplyBatch(
    tenantId: string,
    jobId: string,
    worker: NonNullable<ReturnType<typeof readWorkerState>>,
  ) {
    const jobStore = this.deps.jobStore;
    const resumeAfter = worker.last_committed_apply_seq ?? 0;
    const retryRowNos = worker.technical_retry_row_nos ?? [];
    const retryRows =
      retryRowNos.length === 0
        ? []
        : await jobStore.findApplyRowsByRowNos(tenantId, jobId, retryRowNos);
    const page = await jobStore.findApplyRowsAfterApplySeq(
      tenantId,
      jobId,
      resumeAfter,
      IMPORT_APPLY_BATCH_SIZE + 1,
    );
    const merged = mergeTechnicalRetryBatch(
      retryRows,
      page,
      IMPORT_APPLY_BATCH_SIZE,
    );
    return {
      resumeAfter,
      rows: merged.rows,
      page,
      hasMoreRowsAfterBatch:
        merged.hasMore || page.length > IMPORT_APPLY_BATCH_SIZE,
    };
  }

  async backgroundApplyHasMore(
    tenantId: string,
    jobId: string,
    lastCommitted: number,
    technicalRetryRowNos: number[] | undefined,
  ): Promise<boolean> {
    if ((technicalRetryRowNos?.length ?? 0) > 0) {
      return true;
    }
    const next = await this.deps.jobStore.findApplyRowsAfterApplySeq(
      tenantId,
      jobId,
      lastCommitted,
      1,
    );
    return next.length > 0;
  }

  async loadBackgroundApplyContext(tenantId: string, jobId: string) {
    const { jobStore, handlers } = this.deps;
    const job = await jobStore.findJob(tenantId, jobId);
    if (!job) {
      return null;
    }
    const options = job.options_json as ImportJobOptionsWithWorker;
    const worker = readWorkerState(options);
    if (!worker || worker.phase !== 'apply') {
      return null;
    }
    const batch = await this.readBackgroundApplyBatch(tenantId, jobId, worker);
    const { resumeAfter, rows, page, hasMoreRowsAfterBatch } = batch;
    const maxApplySeq = await jobStore.maxApplySeq(tenantId, jobId);
    const rowCount = await jobStore.countApplyRows(tenantId, jobId);
    if (
      await this.failBackgroundApplyWhenApplySeqMissing(
        tenantId,
        jobId,
        rowCount,
        maxApplySeq,
      )
    ) {
      return null;
    }
    assertImplementedImportEntityType(job.entity_type);
    const handler = handlers[job.entity_type];
    const effectiveOptions = (job.options_json as ImportJobOptions) ?? {};
    const preparation = await handler.prepareApply({
      tenantId,
      job,
      rows,
      applyOptions: effectiveOptions,
      effectiveOptions,
    });
    const jobForApply = {
      ...job,
      totals_json: {
        ...(job.totals_json as ImportJobTotals),
        rows: rowCount,
      },
    };
    return {
      job: jobForApply,
      worker,
      rows,
      page,
      handler,
      effectiveOptions,
      preparation,
      resumeAfter,
      rowCount,
      hasMoreRowsAfterBatch,
      maxApplySeq,
    };
  }

  async continueBackgroundApplyIfNeeded(params: {
    tenantId: string;
    jobId: string;
    worker: NonNullable<ReturnType<typeof readWorkerState>>;
    rows: ImportApplyRow[];
    resumeAfter: number;
    resultStatus: ImportJobStatus;
  }): Promise<void> {
    const { jobStore } = this.deps;
    const refreshedJob = await jobStore.findJob(params.tenantId, params.jobId);
    const refreshedWorker = readWorkerState(
      refreshedJob?.options_json as ImportJobOptionsWithWorker,
    );
    const lastCommitted =
      refreshedWorker?.last_committed_apply_seq ?? params.resumeAfter;
    const hasMore = await this.backgroundApplyHasMore(
      params.tenantId,
      params.jobId,
      lastCommitted,
      refreshedWorker?.technical_retry_row_nos,
    );
    const done = !hasMore;
    if (done || params.resultStatus !== ImportJobStatus.APPLYING) {
      return;
    }
    const leaseToken =
      refreshedWorker?.lease_token ?? params.worker.lease_token;
    await handoffImportWorkerAfterBatch(
      this.workerFlowForJob(params.tenantId, params.jobId),
      {
        tenantId: params.tenantId,
        jobId: params.jobId,
        phase: 'apply',
        leaseToken,
        nextChunkSeq: lastCommitted,
      },
    );
  }
}
