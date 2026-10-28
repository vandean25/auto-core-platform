import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { randomUUID as cryptoRandomUuid } from 'node:crypto';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import { CustomerImportHandler } from './customer-import.handler.js';
import {
  assertFailedImportJobCanReApply,
  assertJobCanBeApplied,
  importJobCannotCancel,
  importJobNotFound,
} from './import-job.errors.js';
import {
  IMPORT_APPLY_UNIT_BUDGET_MS,
  isStaleApplyingImportJob,
} from './import-apply-lease.js';
import {
  mergeTechnicalRetryBatch,
  mergeTechnicalRetryRowNos,
  planTechnicalRetry,
  technicalRetryRowNos,
} from './import-technical-retry.js';
import {
  buildImportErrorReportCsv,
  serializeImportJob,
  serializeImportRow,
  type ImportJobView,
  type SerializedImportJob,
} from './import-job.serializer.js';
import { ImportJobStore } from './import-job.store.js';
import { logImportJobFailed } from './import-job-failed-log.util.js';
import { handleImportWorkerAttemptFailure } from './import-worker-attempt-failure.handler.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import {
  mergeApplyOptions,
  normalizeImportOptions,
} from './import-options.util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { traceImportParse, traceImportValidate } from './import-trace.js';
import {
  assertImplementedImportEntityType,
  type ImplementedImportEntityType,
} from './import-entity-type.guard.js';
import type {
  ImportApplyRow,
  ImportTypeHandler,
} from './import-type-handler.js';
import { ImportVendorResolver } from './import-vendor.resolver.js';
import {
  assessImportUpload,
  openImportMulterStagingReadStream,
  type ImportUploadStats,
  unlinkImportMulterStagingFile,
} from './import-upload.util.js';
import { getImportStagingKey } from './import-staging-path.js';
import { pipeImportCsvToStorage } from './import-upload-pipeline.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import {
  enqueueImportWorkerContinuation,
  enqueueImportWorkerRecoveryHandoff,
  handoffImportWorkerAfterBatch,
  isApplyingImportWorkerForPhase,
  requeueImportWorkerAfterLeaseSkip,
  type ImportWorkerFlowDeps,
} from './import-worker.flow.js';
import {
  mergeDryRunBatchTotals,
  persistDryRunBatchAndHandoff,
} from './import-background-dry-run.batch.js';
import {
  runBackgroundDryRunReconcileChunk,
  scheduleBackgroundDryRunAfterRowBatches,
} from './import-background-dry-run.reconcile.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';
import {
  readWorkerCsvBatchFromRanges,
  byteOffsetAfterPersistedRows,
} from './import-csv-stream.util.js';
import { rethrowImportStorageFailure } from './import-gcs-retry.js';
import { resolveImportWorkerTargetBaseUrl } from './import-worker-target.js';
import {
  ImportFileStorageService,
  readMulterUploadContent,
} from './import-file.storage.js';
import {
  readUploadRef,
  readWorkerState,
  type ImportJobOptionsWithWorker,
} from './import-job.worker-state.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  IMPORT_LOGGER_CONTEXT,
  IMPORT_APPLY_BATCH_SIZE,
} from './import.constants.js';
import { readImportWorkerBatchSize } from './import-limits.js';
import { computeDryRunTotals } from './import-totals.util.js';
import { buildTemplateCsv, getImportTemplate } from './import.templates.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import { parseMigrationManifestFromDryRunOptions } from './canonical-migration-import/canonical-migration-import.options.js';
import { assertCanonicalMigrationUploadAllowed } from './migration-manifest-upload.guard.js';
import { filterExpiredImportWorkerCandidates } from './import-recovery.helpers.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { SupplierPriceListImportHandler } from './supplier-price-list-import.handler.js';
import { LaborOperationImportHandler } from './labor-operation-import.handler.js';
import { VehicleDueDateImportHandler } from './vehicle-due-date-import.handler.js';
import { VehicleImportHandler } from './vehicle-import.handler.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

function statusRetriesTechnicalRows(status: ImportJobStatus): boolean {
  return (
    status === ImportJobStatus.FAILED || status === ImportJobStatus.APPLIED
  );
}

function buildRowsWhere(
  tenantId: string,
  jobId: string,
  query: { action?: ImportRowAction; hasErrors?: boolean },
): Prisma.ImportJobRowWhereInput {
  return {
    tenant_id: tenantId,
    import_job_id: jobId,
    ...(query.action ? { action: query.action } : {}),
    ...(query.hasErrors === true ? { action: ImportRowAction.ERROR } : {}),
  };
}

/**
 * Entry point for CSV imports. The work is split by stage: parsing, per-type dry runs and
 * apply handlers, job storage, audit and reporting. Every method runs the same tenant and
 * role checks as before.
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(IMPORT_LOGGER_CONTEXT);
  private readonly audit: ImportAuditWriter;
  private readonly jobStore: ImportJobStore;
  private readonly handlers: Record<
    ImplementedImportEntityType,
    ImportTypeHandler
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly fileStorage: ImportFileStorageService,
    private readonly cloudTasks: ImportCloudTasksService,
    private readonly requestContext: RequestContextService,
    decisionHooks: DecisionUseCaseHooksService,
    decisionLive: DecisionLiveApplyService,
  ) {
    this.audit = new ImportAuditWriter(tenantContext);
    this.jobStore = new ImportJobStore(prisma);
    const serialize = (job: ImportJobView, totals: ImportJobTotals) =>
      this.serializeJob(job, totals);
    const rowRunner = new RowByRowApplyRunner(prisma, this.audit, serialize);
    const supplierRunner = new SupplierChunkedApplyRunner(
      prisma,
      this.audit,
      serialize,
    );
    this.handlers = {
      [ImportEntityType.CUSTOMER]: new CustomerImportHandler(
        prisma,
        this.audit,
        rowRunner,
        decisionHooks,
        decisionLive,
        requestContext,
      ),
      [ImportEntityType.VEHICLE]: new VehicleImportHandler(
        prisma,
        this.audit,
        rowRunner,
      ),
      [ImportEntityType.SUPPLIER_PRICE_LIST]:
        new SupplierPriceListImportHandler(
          prisma,
          new ImportVendorResolver(prisma),
          supplierRunner,
        ),
      [ImportEntityType.LABOR_OPERATION]: new LaborOperationImportHandler(
        prisma,
        this.audit,
        rowRunner,
      ),
      [ImportEntityType.VEHICLE_PARTY]: new VehiclePartyImportHandler(
        prisma,
        this.audit,
        rowRunner,
      ),
      [ImportEntityType.VEHICLE_DUE_DATE]: new VehicleDueDateImportHandler(
        prisma,
        this.audit,
        rowRunner,
      ),
    };
  }

  async createDryRunFromUpload(params: {
    uploadRequest?: object;
    file: Express.Multer.File;
    entityType: ImportEntityType;
    sourceSystem: string;
    mappingJson: Record<string, string>;
    optionsJson: ImportJobOptions;
  }) {
    assertTenantAdmin(this.tenantContext);
    assertImplementedImportEntityType(params.entityType);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const migrationManifest = parseMigrationManifestFromDryRunOptions(
      params.optionsJson,
    );
    const options: ImportJobOptions = {
      ...normalizeImportOptions(params.optionsJson),
      ...(migrationManifest
        ? { cutover_date: migrationManifest.cutover_date }
        : {}),
    };
    const stagingRequest =
      params.uploadRequest && getImportStagingKey(params.uploadRequest)
        ? params.uploadRequest
        : undefined;
    const assessed = await assessImportUpload(params.file, stagingRequest);
    if (migrationManifest) {
      assertCanonicalMigrationUploadAllowed(params.file, migrationManifest, {
        sha256: assessed.sha256,
        dataRowCount: assessed.rowCount,
      });
    }
    const handler = this.handlers[params.entityType];
    await handler.prepareCreate(tenantId, params.sourceSystem, options);

    if (assessed.useBackground) {
      return this.createBackgroundDryRunFromUpload({
        tenantId,
        actorUserId: currentUser.id,
        file: params.file,
        entityType: params.entityType,
        sourceSystem: params.sourceSystem,
        mappingJson: params.mappingJson,
        options,
        stagingRequest,
        assessed,
      });
    }

    const syncParsed = assessed.parsed;
    if (!syncParsed) {
      throw new Error('Sync import path requires a parsed CSV buffer');
    }
    const parsed = traceImportParse(params.entityType, () => syncParsed);
    const dryRunRows = await traceImportValidate(params.entityType, () =>
      handler.planDryRun(
        {
          tenantId,
          sourceSystem: params.sourceSystem,
          mapping: params.mappingJson,
          options,
        },
        parsed,
      ),
    );
    const totals = computeDryRunTotals(dryRunRows);

    const job = await this.jobStore.createDryRunJob({
      tenantId,
      entityType: params.entityType,
      sourceSystem: params.sourceSystem,
      fileName: params.file.originalname,
      fileSha256: parsed.sha256,
      mapping: params.mappingJson,
      options,
      totals,
      actorUserId: currentUser.id,
      rows: dryRunRows,
    });
    await this.audit.writeImportJobAudit(
      this.prisma,
      tenantId,
      currentUser.id,
      job.id,
      'created',
    );

    const jobTotals = handler.finishCreate
      ? await handler.finishCreate({
          tenantId,
          jobId: job.id,
          rows: dryRunRows,
          totals,
        })
      : totals;
    return this.serializeJob(job, jobTotals);
  }

  async getJob(jobId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    return this.annotateTechnicalErrors(
      tenantId,
      this.serializeJob(job, job.totals_json as ImportJobTotals),
    );
  }

  async listJobRows(
    jobId: string,
    query: {
      page?: number;
      limit?: number;
      action?: ImportRowAction;
      hasErrors?: boolean;
    },
  ) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await this.getJob(jobId);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;
    const where = buildRowsWhere(tenantId, jobId, query);

    const [rows, total] = await this.jobStore.findRowsPage(where, skip, limit);
    return {
      data: rows.map((row) => serializeImportRow(row)),
      meta: { total, page, limit },
    };
  }

  async downloadErrorRowsCsv(jobId: string): Promise<string> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    const rows = await this.jobStore.findErrorRows(tenantId, jobId);
    return buildImportErrorReportCsv(rows);
  }

  private async resetTechnicalRowsForReapply(
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
      assertJobCanBeApplied(status);
      return { kind: 'options', options };
    }
    const errorRows =
      (await this.jobStore.findErrorRows(tenantId, jobId)) ?? [];
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

  private finishReapplyWithoutTechnicalRows(
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
    assertJobCanBeApplied(status);
    if (status === ImportJobStatus.FAILED) {
      this.logTechnicalRetry(jobId, plan);
    }
    return { kind: 'options', options };
  }

  private logTechnicalRetry(
    jobId: string,
    plan: { count: number; codes: string[] },
  ): void {
    this.logger.log(
      JSON.stringify({
        event: 'import.reapply.technical_rows_reset',
        jobId,
        technicalRowsReset: plan.count,
        codes: plan.codes,
      }),
    );
  }

  async applyJob(jobId: string, applyOptions?: ImportJobOptions) {
    const outcome = await this.applyJobHttp(jobId, applyOptions);
    return outcome.job;
  }

  async applyJobHttp(
    jobId: string,
    applyOptions?: ImportJobOptions,
  ): Promise<{ httpStatus: 200 | 202; job: SerializedImportJob }> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    const prepared = await this.prepareApplyJob(tenantId, jobId, job);
    if (prepared.outcome === 'current') {
      return {
        httpStatus: prepared.httpStatus,
        job: await this.annotateTechnicalErrors(
          tenantId,
          this.serializeJob(
            prepared.job,
            prepared.job.totals_json as ImportJobTotals,
          ),
        ),
      };
    }
    const applyingJob = prepared.job;
    if (applyingJob.status === ImportJobStatus.FAILED) {
      await assertFailedImportJobCanReApply({
        uploadPresent: Boolean(
          readUploadRef(applyingJob.options_json as ImportJobOptionsWithWorker),
        ),
        countApplyRows: () => this.jobStore.countApplyRows(tenantId, jobId),
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

  private async annotateTechnicalErrors(
    tenantId: string,
    job: SerializedImportJob,
  ): Promise<SerializedImportJob> {
    if (job.status !== ImportJobStatus.APPLIED) {
      return job;
    }
    const technical_error_rows = await this.jobStore.countTechnicalErrorRows(
      tenantId,
      job.id,
    );
    return {
      ...job,
      options: { ...job.options, technical_error_rows },
    };
  }

  private async prepareApplyJob(
    tenantId: string,
    jobId: string,
    job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>,
  ) {
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

  private async persistTechnicalRetryOptions(
    tenantId: string,
    jobId: string,
    job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>,
  ): Promise<
    NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>> | 'applied'
  > {
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

  private async finishApplyTakeover(
    tenantId: string,
    jobId: string,
    job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>,
  ) {
    const staleTakeover = await this.takeOverStaleApplyIfNeeded(tenantId, job);
    if (staleTakeover === 'busy') {
      return { outcome: 'current' as const, httpStatus: 202 as const, job };
    }
    const applyingJob =
      staleTakeover === 'taken'
        ? await this.jobStore.findJob(tenantId, jobId)
        : job;
    if (!applyingJob) {
      throw importJobNotFound();
    }
    if (
      staleTakeover !== 'taken' &&
      applyingJob.status !== ImportJobStatus.APPLIED
    ) {
      assertJobCanBeApplied(applyingJob.status);
    }
    return { outcome: 'run' as const, job: applyingJob };
  }

  private async dispatchImportApply(params: {
    tenantId: string;
    jobId: string;
    job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>;
    actorUserId: string;
    applyOptions: ImportJobOptions | undefined;
    alreadyLocked: boolean;
  }): Promise<SerializedImportJob> {
    const effectiveOptions = mergeApplyOptions(
      (params.job.options_json as ImportJobOptions) ?? {},
      params.applyOptions,
    );
    assertImplementedImportEntityType(params.job.entity_type);
    const handler = this.handlers[params.job.entity_type];
    const dryRunTotals = params.job.totals_json as ImportJobTotals;
    return this.dispatchBackgroundApply(
      params,
      handler,
      dryRunTotals,
      effectiveOptions,
    );
  }

  private async dispatchBackgroundApply(
    params: {
      tenantId: string;
      jobId: string;
      job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>;
      applyOptions: ImportJobOptions | undefined;
      alreadyLocked: boolean;
      actorUserId: string;
    },
    handler: ImportTypeHandler,
    dryRunTotals: ImportJobTotals,
    effectiveOptions: ImportJobOptions,
  ): Promise<SerializedImportJob> {
    if (params.alreadyLocked) {
      const locked = await this.jobStore.findJob(params.tenantId, params.jobId);
      const token = readWorkerState(
        locked?.options_json as ImportJobOptionsWithWorker,
      )?.lease_token;
      if (token) {
        await this.jobStore.releaseWorkerLeaseForHandoff(
          params.tenantId,
          params.jobId,
          token,
        );
      }
      await this.enqueueInitialImportWorker(
        params.tenantId,
        params.jobId,
        'apply',
      );
      const refreshed = await this.jobStore.findJob(
        params.tenantId,
        params.jobId,
      );
      return this.serializeJob(
        refreshed!,
        refreshed!.totals_json as ImportJobTotals,
      );
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

  private async takeOverStaleApplyIfNeeded(
    tenantId: string,
    job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>,
  ): Promise<'taken' | 'busy' | 'not-applying'> {
    if (job.status !== ImportJobStatus.APPLYING) {
      return 'not-applying';
    }
    if (!isStaleApplyingImportJob(job, Date.now())) {
      return 'busy';
    }
    const taken = await this.jobStore.claimWorkerLease(
      tenantId,
      job.id,
      'apply',
    );
    return taken ? 'taken' : 'busy';
  }

  private async queueBackgroundImportApply(
    tenantId: string,
    jobId: string,
    job: NonNullable<Awaited<ReturnType<ImportJobStore['findJob']>>>,
    handler: ImportTypeHandler,
    dryRunTotals: ImportJobTotals,
    applyOptions: ImportJobOptions | undefined,
    effectiveOptions: ImportJobOptions,
    actorUserId: string,
  ): Promise<SerializedImportJob> {
    const rows = await this.jobStore.findApplyRowsAfter(tenantId, jobId, 0);
    await handler.prepareApply({
      tenantId,
      job,
      rows,
      applyOptions,
      effectiveOptions,
    });
    const lock = await this.jobStore.lockForBackgroundApply(
      tenantId,
      jobId,
      effectiveOptions,
      dryRunTotals,
      handler.applySequenceOrderKey(),
    );
    if (lock.count === 0) {
      const current = await this.jobStore.findJob(tenantId, jobId);
      if (!current) {
        throw importJobNotFound();
      }
      return this.serializeJob(current, current.totals_json as ImportJobTotals);
    }
    await this.enqueueInitialImportWorker(tenantId, jobId, 'apply');
    const refreshed = await this.jobStore.findJob(tenantId, jobId);
    if (
      refreshed?.status === ImportJobStatus.APPLIED &&
      dryRunTotals.rows === 0
    ) {
      await this.audit.writeImportJobAudit(
        this.prisma,
        tenantId,
        actorUserId,
        jobId,
        'applied',
        dryRunTotals,
      );
    }
    return this.serializeJob(
      refreshed!,
      refreshed!.totals_json as ImportJobTotals,
    );
  }

  /** Response shape of an import job. Kept on the facade as the single place it is built. */
  private serializeJob(
    job: ImportJobView,
    totals: ImportJobTotals,
  ): SerializedImportJob {
    return serializeImportJob(job, totals);
  }

  getTemplate(entityType: ImportEntityType) {
    assertTenantAdmin(this.tenantContext);
    assertImplementedImportEntityType(entityType);
    const template = getImportTemplate(entityType);
    return {
      entity_type: template.entity_type,
      fields: template.fields,
      csv: buildTemplateCsv(entityType),
    };
  }

  async cancelJob(jobId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.jobStore.findJob(tenantId, jobId);
    if (!existing) {
      throw importJobNotFound();
    }
    const result = await this.jobStore.cancelBackgroundDryRun(tenantId, jobId);
    if (result.count === 0) {
      throw importJobCannotCancel();
    }
    await this.deleteJobUploadIfPresent(
      existing.options_json as ImportJobOptionsWithWorker,
    );
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    return this.serializeJob(job, job.totals_json as ImportJobTotals);
  }

  private async createBackgroundDryRunFromUpload(params: {
    tenantId: string;
    actorUserId: string;
    file: Express.Multer.File;
    entityType: ImportEntityType;
    sourceSystem: string;
    mappingJson: Record<string, string>;
    options: ImportJobOptions;
    stagingRequest?: object;
    assessed: ImportUploadStats;
  }) {
    const placeholderJobId = cryptoRandomUuid();
    let uploadRef: { object_key: string } | undefined;
    let fileSha256 = params.assessed.sha256;
    let expectedRows = params.assessed.rowCount;
    try {
      if (params.stagingRequest) {
        const piped = await pipeImportCsvToStorage(this.fileStorage, {
          tenantId: params.tenantId,
          jobId: placeholderJobId,
          fileName: params.file.originalname,
          openSource: () =>
            openImportMulterStagingReadStream(params.stagingRequest!),
          contentLength: params.file.size,
        });
        uploadRef = piped.ref;
        fileSha256 = piped.sha256;
        expectedRows = piped.dataRowCount;
        await unlinkImportMulterStagingFile(params.stagingRequest);
      } else {
        const content = readMulterUploadContent(params.file);
        uploadRef = await this.fileStorage.storeUpload({
          tenantId: params.tenantId,
          jobId: placeholderJobId,
          fileName: params.file.originalname,
          content,
        });
      }
      if (!uploadRef) {
        throw new Error(
          'Import upload storage did not return a file reference',
        );
      }
      const job = await this.jobStore.createPendingBackgroundJob({
        tenantId: params.tenantId,
        entityType: params.entityType,
        sourceSystem: params.sourceSystem,
        fileName: params.file.originalname,
        fileSha256,
        mapping: params.mappingJson,
        options: params.options,
        actorUserId: params.actorUserId,
        upload: uploadRef,
        expectedRows,
      });
      await this.audit.writeImportJobAudit(
        this.prisma,
        params.tenantId,
        params.actorUserId,
        job.id,
        'created',
      );
      await this.enqueueInitialImportWorker(params.tenantId, job.id, 'dry_run');
      const refreshed = await this.jobStore.findJob(params.tenantId, job.id);
      const finished = refreshed ?? job;
      return this.serializeJob(
        finished,
        finished.totals_json as ImportJobTotals,
      );
    } catch (error) {
      if (uploadRef) {
        await this.fileStorage.deleteUpload(uploadRef).catch(() => undefined);
      }
      if (params.stagingRequest) {
        await unlinkImportMulterStagingFile(params.stagingRequest);
      }
      rethrowImportStorageFailure(error);
    }
  }

  private async deleteJobUploadIfPresent(
    options: ImportJobOptionsWithWorker,
  ): Promise<void> {
    const upload = readUploadRef(options);
    if (!upload) {
      return;
    }
    await this.fileStorage.deleteUpload(upload).catch(() => undefined);
  }

  private runWorkerInlineForJob(tenantId: string, jobId: string) {
    return (phase: 'dry_run' | 'apply') =>
      this.runImportWorkerAttempt({ tenantId, jobId, phase });
  }

  private importWorkerFlowDeps(
    runInline: (phase: 'dry_run' | 'apply') => Promise<void>,
  ): ImportWorkerFlowDeps {
    return {
      jobStore: this.jobStore,
      cloudTasks: this.cloudTasks,
      targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
      nodeEnv: process.env.NODE_ENV,
      runInline,
      logger: this.logger,
    };
  }

  private workerFlowForJob(
    tenantId: string,
    jobId: string,
  ): ImportWorkerFlowDeps {
    return this.importWorkerFlowDeps(
      this.runWorkerInlineForJob(tenantId, jobId),
    );
  }

  private async enqueueInitialImportWorker(
    tenantId: string,
    jobId: string,
    phase: 'dry_run' | 'apply',
  ): Promise<void> {
    const job = await this.jobStore.findJob(tenantId, jobId);
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

  async runImportWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: 'dry_run' | 'apply';
  }): Promise<void> {
    try {
      await this.runClaimedImportWorkerBatch(params);
    } catch (error) {
      await this.failImportWorkerAttemptUnlessContention(
        { ...params, phase: params.phase },
        error,
      );
    }
  }

  private async runClaimedImportWorkerBatch(params: {
    tenantId: string;
    jobId: string;
    phase: 'dry_run' | 'apply';
  }): Promise<void> {
    const claimed = await this.jobStore.claimWorkerLease(
      params.tenantId,
      params.jobId,
      params.phase,
    );
    if (!claimed) {
      const jobAfterClaim = await this.jobStore.findJob(
        params.tenantId,
        params.jobId,
      );
      if (jobAfterClaim?.status === ImportJobStatus.FAILED) {
        const optionsAfterClaim =
          jobAfterClaim.options_json as ImportJobOptions;
        const failureReason = optionsAfterClaim.apply_failure_reason;
        if (failureReason) {
          logImportJobFailed(this.logger, {
            jobId: params.jobId,
            phase: params.phase,
            attempt: jobAfterClaim.attempts_without_progress,
            reason: failureReason,
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
    const job = await this.jobStore.findJob(params.tenantId, params.jobId);
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

  private async failImportWorkerAttemptUnlessContention(
    params: {
      tenantId: string;
      jobId: string;
      phase: 'dry_run' | 'apply';
    },
    error: unknown,
  ): Promise<void> {
    await handleImportWorkerAttemptFailure(
      {
        jobStore: this.jobStore,
        logger: this.logger,
        workerFlow: this.workerFlowForJob(params.tenantId, params.jobId),
      },
      params,
      error,
    );
  }

  async recoverStaleImportJobs(): Promise<boolean> {
    return this.systemPrisma.withCronJobLock(
      'import-job-worker-recovery',
      async () => {
        const tenants = await this.systemPrisma.tenant.findMany({
          select: { id: true },
        });
        const now = Date.now();
        const candidates: ReturnType<
          typeof filterExpiredImportWorkerCandidates
        > = [];
        for (const { id: tenantId } of tenants) {
          try {
            await this.requestContext.runAsWorker(
              tenantId,
              async () => {
                const stale = await this.prisma.importJob.findMany({
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
            this.logger.warn(
              `Import worker recovery listing failed for one tenant: ${cause instanceof Error ? cause.name : 'unknown'}`,
            );
          }
        }
        for (const candidate of candidates.slice(0, 50)) {
          try {
            await this.requestContext.runAsWorker(
              candidate.tenantId,
              () =>
                enqueueImportWorkerRecoveryHandoff(
                  this.workerFlowForRecovery(),
                  candidate,
                ),
              { workerId: 'import-job-worker-recovery' },
            );
          } catch (cause) {
            this.logger.error(
              `Import worker recovery enqueue failed: ${cause instanceof Error ? cause.message : 'unknown'}`,
            );
            throw cause;
          }
        }
      },
      this.logger,
    );
  }

  private workerFlowForRecovery(): ImportWorkerFlowDeps {
    return this.importWorkerFlowDeps(() => {
      throw new Error('Import worker recovery must not run inline');
    });
  }

  private async runBackgroundDryRunBatch(
    tenantId: string,
    jobId: string,
  ): Promise<void> {
    const job = await this.jobStore.findJob(tenantId, jobId);
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
      this.handlers[job.entity_type as ImplementedImportEntityType];
    const mapping = job.mapping_json as Record<string, string>;
    const totals = job.totals_json as ImportJobTotals;
    if (worker.dry_run_reconcile_active) {
      await runBackgroundDryRunReconcileChunk({
        jobStore: this.jobStore,
        prisma: this.prisma,
        fileStorage: this.fileStorage,
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
      (start, end) => this.fileStorage.readByteRange(upload, start, end),
      worker,
      workerBatchSize,
      job.file_sha256,
    );
    if (!parsedBatch || parsedBatch.rows.length === 0) {
      const processedRows = worker.processed_rows ?? 0;
      if (processedRows >= totals.rows) {
        await scheduleBackgroundDryRunAfterRowBatches({
          jobStore: this.jobStore,
          prisma: this.prisma,
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
          jobStore: this.jobStore,
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
              jobStore: this.jobStore,
              prisma: this.prisma,
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

  private async completeBackgroundDryRun(
    tenantId: string,
    jobId: string,
    handler: ImportTypeHandler,
    options: ImportJobOptionsWithWorker,
    totalsOverride?: ImportJobTotals,
  ) {
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      return;
    }
    let finalTotals = totalsOverride ?? (job.totals_json as ImportJobTotals);
    if (handler.finishCreate) {
      const pageSize = readImportWorkerBatchSize();
      let skip = 0;
      while (true) {
        const [batch] = await this.jobStore.findRowsPage(
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
    const finished = await this.jobStore.finishDryRunIfStillApplying(
      tenantId,
      jobId,
      {
        totals_json: finalTotals,
        options_json: optionsForPersist,
      },
    );
    if (finished.count === 0 && job.status === ImportJobStatus.DRY_RUN_DONE) {
      await this.prisma.importJob.updateMany({
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

  private async runBackgroundApplyBatch(
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
      await this.deleteJobUploadIfPresent(
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

  private async failBackgroundApplyWhenApplySeqMissing(
    tenantId: string,
    jobId: string,
    rowCount: number,
    maxApplySeq: number,
  ): Promise<boolean> {
    if (rowCount === 0 || maxApplySeq !== 0) {
      return false;
    }
    const failed = await this.jobStore.markFailedIfApplying(
      tenantId,
      jobId,
      'apply_seq_missing',
    );
    if (failed.count > 0) {
      const failedJob = await this.jobStore.findJob(tenantId, jobId);
      logImportJobFailed(this.logger, {
        jobId,
        phase: 'apply',
        attempt: failedJob?.attempts_without_progress ?? 0,
        reason: 'apply_seq_missing',
      });
    }
    return true;
  }

  private async readBackgroundApplyBatch(
    tenantId: string,
    jobId: string,
    worker: NonNullable<ReturnType<typeof readWorkerState>>,
  ) {
    const resumeAfter = worker.last_committed_apply_seq ?? 0;
    const retryRowNos = worker.technical_retry_row_nos ?? [];
    const retryRows =
      retryRowNos.length === 0
        ? []
        : await this.jobStore.findApplyRowsByRowNos(
            tenantId,
            jobId,
            retryRowNos,
          );
    const page = await this.jobStore.findApplyRowsAfterApplySeq(
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

  private async backgroundApplyHasMore(
    tenantId: string,
    jobId: string,
    lastCommitted: number,
    technicalRetryRowNos: number[] | undefined,
  ): Promise<boolean> {
    if ((technicalRetryRowNos?.length ?? 0) > 0) {
      return true;
    }
    const next = await this.jobStore.findApplyRowsAfterApplySeq(
      tenantId,
      jobId,
      lastCommitted,
      1,
    );
    return next.length > 0;
  }

  private async loadBackgroundApplyContext(tenantId: string, jobId: string) {
    const job = await this.jobStore.findJob(tenantId, jobId);
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
    const maxApplySeq = await this.jobStore.maxApplySeq(tenantId, jobId);
    const rowCount = await this.jobStore.countApplyRows(tenantId, jobId);
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
    const handler = this.handlers[job.entity_type];
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

  private async continueBackgroundApplyIfNeeded(params: {
    tenantId: string;
    jobId: string;
    worker: NonNullable<ReturnType<typeof readWorkerState>>;
    rows: ImportApplyRow[];
    resumeAfter: number;
    resultStatus: ImportJobStatus;
  }): Promise<void> {
    const refreshedJob = await this.jobStore.findJob(
      params.tenantId,
      params.jobId,
    );
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
