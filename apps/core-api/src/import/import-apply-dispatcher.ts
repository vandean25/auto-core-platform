import { Logger } from '@nestjs/common';
import { ImportJobStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import {
  assertFailedImportJobCanReApply,
  assertJobCanBeApplied,
  importJobExpired,
  importJobNotFound,
  importJobPurged,
} from './import-job.errors.js';
import {
  isStaleApplyingImportJob,
  leaseExpiresAtOf,
} from './import-apply-lease.js';
import {
  mergeTechnicalRetryRowNos,
  planTechnicalRetry,
  technicalRetryRowNos,
} from './import-technical-retry.js';
import type {
  ImportJobView,
  SerializedImportJob,
} from './import-job.serializer.js';
import type { ImportJobStore } from './import-job.store.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { mergeApplyOptions } from './import-options.util.js';
import { assertImplementedImportEntityType } from './import-entity-type.guard.js';
import { IMPORT_ENTITY_TYPE_REGISTRY } from './import-entity-type.registry.js';
import type { ImplementedImportEntityType } from './import-entity-type.registry.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import { readUploadRef, readWorkerState } from './import-job.worker-state.js';
import type { ImportJobOptionsWithWorker } from './import-job.worker-state.js';
import type { ImportWorkerOrchestration } from './import-worker-orchestration.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';

/** A job row as returned by ImportJobStore.findJob. */
type ImportJobRecord = NonNullable<
  Awaited<ReturnType<ImportJobStore['findJob']>>
>;

export type ImportApplyDispatcherDeps = {
  logger: Logger;
  prisma: PrismaService;
  tenantContext: TenantContextService;
  jobStore: ImportJobStore;
  handlers: Record<ImplementedImportEntityType, ImportTypeHandler>;
  audit: ImportAuditWriter;
  serialize: (
    job: ImportJobView,
    totals: ImportJobTotals,
  ) => SerializedImportJob;
  orchestration: ImportWorkerOrchestration;
};

function statusRetriesTechnicalRows(status: ImportJobStatus): boolean {
  return (
    status === ImportJobStatus.FAILED || status === ImportJobStatus.APPLIED
  );
}

/**
 * Handles the apply side of the import API: HTTP apply requests, technical-row
 * reapply planning, stale-lease takeover and handing the work to the background
 * worker. No rows are written here; the workers runners do that.
 */
export class ImportApplyDispatcher {
  constructor(private readonly deps: ImportApplyDispatcherDeps) {}

  async applyJob(
    jobId: string,
    applyOptions?: ImportJobOptions,
  ): Promise<SerializedImportJob> {
    const outcome = await this.applyJobHttp(jobId, applyOptions);
    return outcome.job;
  }

  async applyJobHttp(
    jobId: string,
    applyOptions?: ImportJobOptions,
  ): Promise<{ httpStatus: 200 | 202; job: SerializedImportJob }> {
    const { tenantContext, prisma, jobStore, serialize } = this.deps;
    assertTenantAdmin(tenantContext);
    const tenantId = await tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      prisma,
      tenantContext,
      tenantId,
    );

    const job = await jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    const prepared = await this.prepareApplyJob(tenantId, jobId, job);
    if (prepared.outcome === 'current') {
      return {
        httpStatus: prepared.httpStatus,
        job: await this.annotateTechnicalErrors(
          tenantId,
          serialize(prepared.job, prepared.job.totals_json as ImportJobTotals),
        ),
      };
    }
    const applyingJob = prepared.job;
    if (applyingJob.status === ImportJobStatus.FAILED) {
      await assertFailedImportJobCanReApply({
        uploadPresent: Boolean(
          readUploadRef(applyingJob.options_json as ImportJobOptionsWithWorker),
        ),
        countApplyRows: () => jobStore.countApplyRows(tenantId, jobId),
        options: applyingJob.options_json,
      });
    }

    const applied = await this.dispatchImportApply({
      tenantId,
      jobId,
      job: applyingJob,
      actorUserId: currentUser.id,
      applyOptions,
      alreadyLocked: applyingJob.status === ImportJobStatus.APPLYING,
    });
    return {
      httpStatus: 202,
      job: await this.annotateTechnicalErrors(tenantId, applied),
    };
  }

  async annotateTechnicalErrors(
    tenantId: string,
    job: SerializedImportJob,
  ): Promise<SerializedImportJob> {
    if (job.status !== ImportJobStatus.APPLIED) {
      return job;
    }
    const technical_error_rows =
      await this.deps.jobStore.countTechnicalErrorRows(tenantId, job.id);
    return {
      ...job,
      options: { ...job.options, technical_error_rows },
    };
  }

  async prepareApplyJob(tenantId: string, jobId: string, job: ImportJobRecord) {
    const jobWithOptions = await this.persistTechnicalRetryOptions(
      tenantId,
      jobId,
      job,
    );
    if (jobWithOptions === 'applied') {
      return {
        outcome: 'current' as const,
        httpStatus: 200 as const,
        job,
      };
    }
    return this.finishApplyTakeover(tenantId, jobId, jobWithOptions);
  }

  async persistTechnicalRetryOptions(
    tenantId: string,
    jobId: string,
    job: ImportJobRecord,
  ): Promise<ImportJobRecord | 'applied'> {
    const options = job.options_json as ImportJobOptionsWithWorker;
    if (!statusRetriesTechnicalRows(job.status)) {
      return job;
    }
    const reapplyOptions = await this.resetTechnicalRowsForReapply(
      tenantId,
      jobId,
      job.status,
      options,
    );
    if (reapplyOptions.kind === 'applied') {
      return 'applied';
    }
    return { ...job, options_json: reapplyOptions.options };
  }

  async finishApplyTakeover(
    tenantId: string,
    jobId: string,
    job: ImportJobRecord,
  ) {
    const staleTakeover = await this.takeOverStaleApplyIfNeeded(tenantId, job);
    if (staleTakeover === 'busy') {
      return { outcome: 'current' as const, httpStatus: 202 as const, job };
    }
    const applyingJob =
      staleTakeover === 'taken'
        ? await this.deps.jobStore.findJob(tenantId, jobId)
        : job;
    if (!applyingJob) {
      throw importJobNotFound();
    }
    if (
      staleTakeover !== 'taken' &&
      applyingJob.status !== ImportJobStatus.APPLIED
    ) {
      assertJobCanBeApplied(
        applyingJob.status,
        leaseExpiresAtOf(
          applyingJob.options_json as ImportJobOptionsWithWorker,
        ),
        applyingJob.options_json,
      );
    }
    return { outcome: 'run' as const, job: applyingJob };
  }

  async dispatchImportApply(params: {
    tenantId: string;
    jobId: string;
    job: ImportJobRecord;
    actorUserId: string;
    applyOptions: ImportJobOptions | undefined;
    alreadyLocked: boolean;
  }): Promise<SerializedImportJob> {
    const effectiveOptions = mergeApplyOptions(
      (params.job.options_json as ImportJobOptions) ?? {},
      params.applyOptions,
    );
    assertImplementedImportEntityType(params.job.entity_type);
    const handler = this.deps.handlers[params.job.entity_type];
    const dryRunTotals = params.job.totals_json as ImportJobTotals;
    return this.dispatchBackgroundApply(
      params,
      handler,
      dryRunTotals,
      effectiveOptions,
    );
  }

  async dispatchBackgroundApply(
    params: {
      tenantId: string;
      jobId: string;
      job: ImportJobRecord;
      applyOptions: ImportJobOptions | undefined;
      alreadyLocked: boolean;
      actorUserId: string;
    },
    handler: ImportTypeHandler,
    dryRunTotals: ImportJobTotals,
    effectiveOptions: ImportJobOptions,
  ): Promise<SerializedImportJob> {
    const { jobStore, serialize, orchestration } = this.deps;
    if (params.alreadyLocked) {
      const locked = await jobStore.findJob(params.tenantId, params.jobId);
      const token = readWorkerState(
        locked?.options_json as ImportJobOptionsWithWorker,
      )?.lease_token;
      if (token) {
        await jobStore.releaseWorkerLeaseForHandoff(
          params.tenantId,
          params.jobId,
          token,
        );
      }
      await orchestration.enqueueInitialWorker(
        params.tenantId,
        params.jobId,
        'apply',
      );
      const refreshed = await jobStore.findJob(params.tenantId, params.jobId);
      return serialize(refreshed!, refreshed!.totals_json as ImportJobTotals);
    }
    return this.queueBackgroundImportApply(
      params.tenantId,
      params.jobId,
      params.job,
      handler,
      dryRunTotals,
      params.applyOptions,
      effectiveOptions,
      params.actorUserId,
    );
  }

  async takeOverStaleApplyIfNeeded(
    tenantId: string,
    job: ImportJobRecord,
  ): Promise<'taken' | 'busy' | 'not-applying'> {
    const { jobStore } = this.deps;
    if (job.status !== ImportJobStatus.APPLYING) {
      return 'not-applying';
    }
    if (!isStaleApplyingImportJob(job, Date.now())) {
      return 'busy';
    }
    const taken = await jobStore.claimWorkerLease(tenantId, job.id, 'apply');
    return taken ? 'taken' : 'busy';
  }

  async queueBackgroundImportApply(
    tenantId: string,
    jobId: string,
    job: ImportJobRecord,
    handler: ImportTypeHandler,
    dryRunTotals: ImportJobTotals,
    applyOptions: ImportJobOptions | undefined,
    effectiveOptions: ImportJobOptions,
    actorUserId: string,
  ): Promise<SerializedImportJob> {
    const { jobStore, audit, prisma, serialize, orchestration } = this.deps;
    const rows = await jobStore.findPriceJumpRows(tenantId, jobId);
    await handler.prepareApply({
      tenantId,
      job,
      rows,
      applyOptions,
      effectiveOptions,
    });
    assertImplementedImportEntityType(job.entity_type);
    const lock = await jobStore.lockForBackgroundApply(
      tenantId,
      jobId,
      effectiveOptions,
      dryRunTotals,
      IMPORT_ENTITY_TYPE_REGISTRY[job.entity_type].applyOrder,
    );
    if (lock.count === 0) {
      const current = await jobStore.findJob(tenantId, jobId);
      if (!current) {
        throw importJobNotFound();
      }
      const currentOpts = (current.options_json ?? {}) as Record<
        string,
        unknown
      >;
      if (currentOpts.rows_purged === true) {
        throw importJobPurged();
      }
      if (currentOpts.cancel_reason === 'expired') {
        throw importJobExpired();
      }
      return serialize(current, current.totals_json as ImportJobTotals);
    }
    await orchestration.enqueueInitialWorker(tenantId, jobId, 'apply');
    const refreshed = await jobStore.findJob(tenantId, jobId);
    if (
      refreshed?.status === ImportJobStatus.APPLIED &&
      dryRunTotals.rows === 0
    ) {
      await audit.writeImportJobAudit(
        prisma,
        tenantId,
        actorUserId,
        jobId,
        'applied',
        dryRunTotals,
      );
    }
    return serialize(refreshed!, refreshed!.totals_json as ImportJobTotals);
  }

  async resetTechnicalRowsForReapply(
    tenantId: string,
    jobId: string,
    status: ImportJobStatus,
    options: ImportJobOptionsWithWorker,
  ): Promise<
    | { kind: 'options'; options: ImportJobOptionsWithWorker }
    | { kind: 'applied' }
  > {
    if (
      status !== ImportJobStatus.FAILED &&
      status !== ImportJobStatus.APPLIED
    ) {
      assertJobCanBeApplied(status, leaseExpiresAtOf(options), options);
      return { kind: 'options', options };
    }
    const errorRows =
      (await this.deps.jobStore.findErrorRows(tenantId, jobId)) ?? [];
    const plan = planTechnicalRetry(errorRows);
    const rowNos = mergeTechnicalRetryRowNos(
      technicalRetryRowNos(options, options.worker ?? null),
      plan.rowNos,
    );
    if (rowNos.length === 0) {
      return this.finishReapplyWithoutTechnicalRows(
        status,
        options,
        jobId,
        plan,
      );
    }
    this.logTechnicalRetry(jobId, plan);
    const worker = options.worker
      ? { ...options.worker, technical_retry_row_nos: rowNos }
      : undefined;
    return {
      kind: 'options',
      options: {
        ...options,
        ...(worker ? { worker } : {}),
        technical_retry_row_nos: rowNos,
      },
    };
  }

  finishReapplyWithoutTechnicalRows(
    status: ImportJobStatus,
    options: ImportJobOptionsWithWorker,
    jobId: string,
    plan: { count: number; codes: string[] },
  ):
    | { kind: 'options'; options: ImportJobOptionsWithWorker }
    | { kind: 'applied' } {
    if (status === ImportJobStatus.APPLIED) {
      return { kind: 'applied' };
    }
    assertJobCanBeApplied(status, leaseExpiresAtOf(options), options);
    if (status === ImportJobStatus.FAILED) {
      this.logTechnicalRetry(jobId, plan);
    }
    return { kind: 'options', options };
  }

  logTechnicalRetry(
    jobId: string,
    plan: { count: number; codes: string[] },
  ): void {
    this.deps.logger.log(
      JSON.stringify({
        event: 'import.reapply.technical_rows_reset',
        jobId,
        technicalRowsReset: plan.count,
        codes: plan.codes,
      }),
    );
  }
}
