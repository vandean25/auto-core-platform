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
  applyInProgress,
  assertJobCanBeApplied,
  importJobCannotCancel,
  importJobNotFound,
} from './import-job.errors.js';
import {
  buildImportErrorReportCsv,
  serializeImportJob,
  serializeImportRow,
  type ImportJobView,
  type SerializedImportJob,
} from './import-job.serializer.js';
import { ImportJobStore } from './import-job.store.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import {
  mergeApplyOptions,
  normalizeImportOptions,
} from './import-options.util.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import {
  traceImportCommit,
  traceImportParse,
  traceImportValidate,
} from './import-trace.js';
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
  importWorkerRetryDelaySeconds,
  isRetryableImportWorkerError,
} from './import-worker-retry.js';
import { IMPORT_WORKER_CHUNK_TIME_BUDGET_MS } from './import-worker-handoff.constants.js';
import { readImportCsvDataRowSlice } from './import-csv-stream.util.js';
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
  IMPORT_WORKER_BATCH_SIZE,
} from './import.constants.js';
import { readImportSyncMaxRowCount } from './import-limits.js';
import { computeDryRunTotals } from './import-totals.util.js';
import { buildTemplateCsv, getImportTemplate } from './import.templates.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import { parseMigrationManifestFromDryRunOptions } from './canonical-migration-import/canonical-migration-import.options.js';
import { assertCanonicalMigrationUploadAllowed } from './migration-manifest-upload.guard.js';
import { isImportWorkerContentionError } from './import-worker.errors.js';
import { filterExpiredImportWorkerCandidates } from './import-recovery.helpers.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { SupplierPriceListImportHandler } from './supplier-price-list-import.handler.js';
import { LaborOperationImportHandler } from './labor-operation-import.handler.js';
import { VehicleDueDateImportHandler } from './vehicle-due-date-import.handler.js';
import { VehicleImportHandler } from './vehicle-import.handler.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

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
    return this.serializeJob(job, job.totals_json as ImportJobTotals);
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

  async applyJob(jobId: string, applyOptions?: ImportJobOptions) {
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
    assertJobCanBeApplied(job.status);

    const effectiveOptions = mergeApplyOptions(
      (job.options_json as ImportJobOptions) ?? {},
      applyOptions,
    );
    const rowCount = await this.jobStore.countApplyRows(tenantId, jobId);
    assertImplementedImportEntityType(job.entity_type);
    const handler = this.handlers[job.entity_type];
    const dryRunTotals = job.totals_json as ImportJobTotals;

    if (rowCount > readImportSyncMaxRowCount()) {
      const rows = await this.jobStore.findApplyRowsAfter(
        tenantId,
        jobId,
        0,
        IMPORT_APPLY_BATCH_SIZE,
      );
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
        job.options_json as ImportJobOptionsWithWorker,
        dryRunTotals,
        handler.applySequenceOrderKey(),
      );
      if (lock.count === 0) {
        throw applyInProgress();
      }
      await this.enqueueInitialImportWorker(tenantId, jobId, 'apply');
      const refreshed = await this.jobStore.findJob(tenantId, jobId);
      return this.serializeJob(
        refreshed!,
        refreshed!.totals_json as ImportJobTotals,
      );
    }

    const rows = await this.jobStore.findApplyRows(tenantId, jobId);
    const preparation = await handler.prepareApply({
      tenantId,
      job,
      rows,
      applyOptions,
      effectiveOptions,
    });

    const lock = await this.jobStore.lockForApply(tenantId, jobId);
    if (lock.count === 0) {
      throw applyInProgress();
    }

    return traceImportCommit(job.entity_type, rows.length, () =>
      handler.apply({
        tenantId,
        job,
        rows,
        actorUserId: currentUser.id,
        effectiveOptions,
        preparation,
      }),
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
          source: openImportMulterStagingReadStream(params.stagingRequest),
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
      return this.serializeJob(job, job.totals_json as ImportJobTotals);
    } catch (error) {
      if (uploadRef) {
        await this.fileStorage.deleteUpload(uploadRef).catch(() => undefined);
      }
      if (params.stagingRequest) {
        await unlinkImportMulterStagingFile(params.stagingRequest);
      }
      throw error;
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
      await requeueImportWorkerAfterLeaseSkip(
        this.workerFlowForJob(params.tenantId, params.jobId),
        params,
      );
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
    if (isRetryableImportWorkerError(error)) {
      const job = await this.jobStore.findJob(params.tenantId, params.jobId);
      if (job && job.status === ImportJobStatus.APPLYING) {
        await enqueueImportWorkerContinuation(
          this.workerFlowForJob(params.tenantId, params.jobId),
          {
            tenantId: params.tenantId,
            jobId: params.jobId,
            phase: params.phase,
            claimSeq: job.worker_claim_seq,
            recoverySeq: job.worker_recovery_seq,
            delaySeconds: importWorkerRetryDelaySeconds(),
            recordHandoffAfterSuccess: true,
          },
        );
      }
      return;
    }
    if (isImportWorkerContentionError(error)) {
      await requeueImportWorkerAfterLeaseSkip(
        this.workerFlowForJob(params.tenantId, params.jobId),
        params,
      );
      return;
    }
    await this.jobStore.markFailedIfApplying(params.tenantId, params.jobId);
    throw error;
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
                  this.workerFlowForRecovery(
                    candidate.tenantId,
                    candidate.jobId,
                  ),
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

  private workerFlowForRecovery(
    tenantId: string,
    jobId: string,
  ): ImportWorkerFlowDeps {
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
    const startOffset = worker.processed_rows;
    const chunkDeadlineMs = Date.now() + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS;
    const parsedBatch = await readImportCsvDataRowSlice(
      this.fileStorage.openReadStream(upload),
      startOffset,
      IMPORT_WORKER_BATCH_SIZE,
      job.file_sha256,
    );
    if (!parsedBatch || parsedBatch.rows.length === 0) {
      const processedRows = worker.processed_rows ?? 0;
      if (processedRows >= totals.rows) {
        await this.completeBackgroundDryRun(tenantId, jobId, handler, options);
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
        const planned = await handler.planDryRun(
          {
            tenantId,
            sourceSystem: job.source_system,
            mapping,
            options,
          },
          parsedBatch,
        );
        let rows = planned.map((row, index) => ({
          ...row,
          row_no: startOffset + index + 1,
        }));
        if (Date.now() >= chunkDeadlineMs) {
          rows = rows.slice(0, 0);
        }
        const processed = startOffset + rows.length;
        const mergedTotals = mergeDryRunBatchTotals(totals, rows, processed);
        if (rows.length === 0 && batchRows.length > 0) {
          await handoffImportWorkerAfterBatch(
            this.workerFlowForJob(tenantId, jobId),
            {
              tenantId,
              jobId,
              phase: 'dry_run',
              leaseToken: worker.lease_token,
              nextChunkSeq: startOffset,
            },
          );
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
          completeDryRun: () =>
            this.completeBackgroundDryRun(tenantId, jobId, handler, options),
        });
      },
    );
  }

  private async completeBackgroundDryRun(
    tenantId: string,
    jobId: string,
    handler: ImportTypeHandler,
    options: ImportJobOptionsWithWorker,
  ) {
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      return;
    }
    let finalTotals = job.totals_json as ImportJobTotals;
    if (handler.finishCreate) {
      const pageSize = IMPORT_WORKER_BATCH_SIZE;
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
    await this.jobStore.finishDryRunIfStillApplying(tenantId, jobId, {
      totals_json: finalTotals,
      options_json: optionsForPersist,
    });
    await this.deleteJobUploadIfPresent(options);
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
        chunkDeadlineMs: Date.now() + IMPORT_WORKER_CHUNK_TIME_BUDGET_MS,
      },
    });
    await this.continueBackgroundApplyIfNeeded({
      tenantId,
      jobId,
      worker: context.worker,
      rows: context.rows,
      resumeAfter: context.resumeAfter,
      resultStatus: result.status,
    });
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
    const resumeAfter = worker.last_committed_apply_seq ?? 0;
    const page = await this.jobStore.findApplyRowsAfterApplySeq(
      tenantId,
      jobId,
      resumeAfter,
      IMPORT_APPLY_BATCH_SIZE + 1,
    );
    const hasMoreRowsAfterBatch = page.length > IMPORT_APPLY_BATCH_SIZE;
    const rows = page.slice(0, IMPORT_APPLY_BATCH_SIZE);
    const maxApplySeq = await this.jobStore.maxApplySeq(tenantId, jobId);
    const rowCount = await this.jobStore.countApplyRows(tenantId, jobId);
    if (rowCount > 0 && maxApplySeq === 0) {
      await this.jobStore.markFailedIfApplying(tenantId, jobId);
      return null;
    }
    assertImplementedImportEntityType(job.entity_type);
    const handler = this.handlers[job.entity_type];
    const effectiveOptions = (job.options_json as ImportJobOptions) ?? {};
    const preparation = await handler.prepareApply({
      tenantId,
      job,
      rows,
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
    const hasMore =
      (
        await this.jobStore.findApplyRowsAfterApplySeq(
          params.tenantId,
          params.jobId,
          lastCommitted,
          1,
        )
      ).length > 0;
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
