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
import type { ImportTypeHandler } from './import-type-handler.js';
import { ImportVendorResolver } from './import-vendor.resolver.js';
import {
  assessImportUpload,
  openTrustedMulterStagingReadStream,
  unlinkTrustedMulterStagingFile,
} from './import-upload.util.js';
import { pipeImportCsvToStorage } from './import-upload-pipeline.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import { enqueueOrRunImportWorker } from './import-dispatch.js';
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
    decisionHooks: DecisionUseCaseHooksService,
    decisionLive: DecisionLiveApplyService,
    requestContext: RequestContextService,
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
    assertCanonicalMigrationUploadAllowed(params.file, migrationManifest);

    const assessed = await assessImportUpload(params.file);
    const handler = this.handlers[params.entityType];
    await handler.prepareCreate(tenantId, params.sourceSystem, options);

    if (assessed.useBackground) {
      const placeholderJobId = cryptoRandomUuid();
      let uploadRef: { object_key: string } | undefined;
      let fileSha256 = assessed.sha256;
      let expectedRows = assessed.rowCount;
      try {
        if (params.file.path) {
          const piped = await pipeImportCsvToStorage(this.fileStorage, {
            tenantId,
            jobId: placeholderJobId,
            fileName: params.file.originalname,
            source: openTrustedMulterStagingReadStream(params.file),
          });
          uploadRef = piped.ref;
          fileSha256 = piped.sha256;
          expectedRows = piped.dataRowCount;
          await unlinkTrustedMulterStagingFile(params.file);
        } else {
          const content = readMulterUploadContent(params.file);
          uploadRef = await this.fileStorage.storeUpload({
            tenantId,
            jobId: placeholderJobId,
            fileName: params.file.originalname,
            content,
          });
        }
        const job = await this.jobStore.createPendingBackgroundJob({
          tenantId,
          entityType: params.entityType,
          sourceSystem: params.sourceSystem,
          fileName: params.file.originalname,
          fileSha256,
          mapping: params.mappingJson,
          options,
          actorUserId: currentUser.id,
          upload: uploadRef,
          expectedRows,
        });
        await this.audit.writeImportJobAudit(
          this.prisma,
          tenantId,
          currentUser.id,
          job.id,
          'created',
        );
        await enqueueOrRunImportWorker({
          tenantId,
          jobId: job.id,
          phase: 'dry_run',
          cloudTasks: this.cloudTasks,
          targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
          nodeEnv: process.env.NODE_ENV,
          runInline: () =>
            this.runImportWorkerAttempt({
              tenantId,
              jobId: job.id,
              phase: 'dry_run',
            }),
        });
        return this.serializeJob(job, job.totals_json as ImportJobTotals);
      } catch (error) {
        if (uploadRef) {
          await this.fileStorage.deleteUpload(uploadRef).catch(() => undefined);
        }
        await unlinkTrustedMulterStagingFile(params.file);
        throw error;
      }
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
    const rows = await this.jobStore.findApplyRows(tenantId, jobId);
    assertImplementedImportEntityType(job.entity_type);
    const handler = this.handlers[job.entity_type];
    const preparation = await handler.prepareApply({
      tenantId,
      job,
      rows,
      applyOptions,
      effectiveOptions,
    });

    if (rows.length > readImportSyncMaxRowCount()) {
      const lock = await this.jobStore.lockForBackgroundApply(
        tenantId,
        jobId,
        job.options_json as ImportJobOptionsWithWorker,
      );
      if (lock.count === 0) {
        throw applyInProgress();
      }
      await enqueueOrRunImportWorker({
        tenantId,
        jobId,
        phase: 'apply',
        cloudTasks: this.cloudTasks,
        targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
        nodeEnv: process.env.NODE_ENV,
        runInline: () =>
          this.runImportWorkerAttempt({
            tenantId,
            jobId,
            phase: 'apply',
          }),
      });
      const refreshed = await this.jobStore.findJob(tenantId, jobId);
      return this.serializeJob(
        refreshed!,
        refreshed!.totals_json as ImportJobTotals,
      );
    }

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

  private async deleteJobUploadIfPresent(
    options: ImportJobOptionsWithWorker,
  ): Promise<void> {
    const upload = readUploadRef(options);
    if (!upload) {
      return;
    }
    await this.fileStorage.deleteUpload(upload).catch(() => undefined);
  }

  async runImportWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: 'dry_run' | 'apply';
  }): Promise<void> {
    try {
      const claimed = await this.jobStore.claimWorkerLease(
        params.tenantId,
        params.jobId,
        params.phase,
      );
      if (!claimed) {
        return;
      }
      const job = await this.jobStore.findJob(params.tenantId, params.jobId);
      if (!job || job.status !== ImportJobStatus.APPLYING) {
        return;
      }
      const options = job.options_json as ImportJobOptionsWithWorker;
      const worker = readWorkerState(options);
      if (!worker || worker.phase !== params.phase) {
        return;
      }
      if (params.phase === 'dry_run') {
        await this.runBackgroundDryRunBatch(params.tenantId, params.jobId);
        return;
      }
      await this.runBackgroundApplyBatch(params.tenantId, params.jobId);
    } catch (error) {
      await this.jobStore.markFailedIfApplying(params.tenantId, params.jobId);
      const job = await this.jobStore.findJob(params.tenantId, params.jobId);
      if (job) {
        await this.deleteJobUploadIfPresent(
          job.options_json as ImportJobOptionsWithWorker,
        );
      }
      throw error;
    }
  }

  async recoverStaleImportJobs(): Promise<void> {
    await this.systemPrisma.withCronJobLock(
      'import-job-worker-recovery',
      async () => {
        const stale = await this.prisma.importJob.findMany({
          where: { status: ImportJobStatus.APPLYING },
          select: { id: true, tenant_id: true, options_json: true },
          take: 50,
        });
        const now = Date.now();
        for (const row of stale) {
          const options = row.options_json as ImportJobOptionsWithWorker;
          const worker = readWorkerState(options);
          if (!worker) {
            continue;
          }
          const leaseUntil = Date.parse(worker.lease_until);
          if (Number.isFinite(leaseUntil) && leaseUntil > now) {
            continue;
          }
          await this.runImportWorkerAttempt({
            tenantId: row.tenant_id,
            jobId: row.id,
            phase: worker.phase,
          });
        }
      },
      this.logger,
    );
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
    const parsedBatch = await readImportCsvDataRowSlice(
      this.fileStorage.openReadStream(upload),
      startOffset,
      IMPORT_WORKER_BATCH_SIZE,
      job.file_sha256,
    );
    if (!parsedBatch || parsedBatch.rows.length === 0) {
      await this.completeBackgroundDryRun(tenantId, jobId, handler, options);
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
        const rows = planned.map((row, index) => ({
          ...row,
          row_no: startOffset + index + 1,
        }));
        const mergedTotals = { ...totals };
        for (const row of rows) {
          if (row.action === ImportRowAction.CREATE) mergedTotals.create += 1;
          else if (row.action === ImportRowAction.UPDATE)
            mergedTotals.update += 1;
          else if (row.action === ImportRowAction.SKIP) mergedTotals.skip += 1;
          else if (row.action === ImportRowAction.ERROR)
            mergedTotals.error += 1;
        }
        const processed = startOffset + batchRows.length;
        mergedTotals.rows = Math.max(totals.rows, processed);
        const appended = await this.jobStore.appendDryRunRows(
          tenantId,
          jobId,
          rows,
          mergedTotals,
          {
            processed_rows: processed,
            lease_until: new Date(0).toISOString(),
          },
          options,
        );
        if (!appended) {
          return;
        }
        if (processed >= totals.rows) {
          await this.completeBackgroundDryRun(
            tenantId,
            jobId,
            handler,
            options,
          );
          return;
        }
        await enqueueOrRunImportWorker({
          tenantId,
          jobId,
          phase: 'dry_run',
          cloudTasks: this.cloudTasks,
          targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
          nodeEnv: process.env.NODE_ENV,
          runInline: () =>
            this.runImportWorkerAttempt({
              tenantId,
              jobId,
              phase: 'dry_run',
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
  ) {
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      return;
    }
    const storedRows = await this.jobStore.findApplyRows(tenantId, jobId);
    const dryRunRows = storedRows.map((row) => ({
      row_no: row.row_no,
      external_id: row.external_id,
      action: row.action,
      entity_id: row.entity_id,
      errors: (row.errors_json as never[]) ?? [],
      warnings: (row.warnings_json as never[]) ?? [],
      normalized: row.normalized_json as Record<string, unknown> | null,
    }));
    const totals = computeDryRunTotals(dryRunRows);
    const finalTotals = handler.finishCreate
      ? await handler.finishCreate({
          tenantId,
          jobId,
          rows: dryRunRows,
          totals,
        })
      : totals;
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
        resumeAfterRowNo: context.resumeAfter,
        stopAfterBatch: true,
        leaseToken: context.worker.lease_token,
      },
    });
    if (result.status === ImportJobStatus.FAILED) {
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
    const resumeAfter = worker.last_committed_row_no ?? 0;
    const rows = await this.jobStore.findApplyRowsAfter(
      tenantId,
      jobId,
      resumeAfter,
      IMPORT_APPLY_BATCH_SIZE,
    );
    const rowCount = await this.jobStore.countApplyRows(tenantId, jobId);
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
      handler,
      effectiveOptions,
      preparation,
      resumeAfter,
      rowCount,
    };
  }

  private async continueBackgroundApplyIfNeeded(params: {
    tenantId: string;
    jobId: string;
    worker: NonNullable<ReturnType<typeof readWorkerState>>;
    rows: Awaited<ReturnType<ImportJobStore['findApplyRows']>>;
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
      refreshedWorker?.last_committed_row_no ?? params.resumeAfter;
    const hasMore =
      (await this.jobStore.findApplyRowsAfter(
        params.tenantId,
        params.jobId,
        lastCommitted,
        1,
      )).length > 0;
    const done = !hasMore;
    if (done || params.resultStatus !== ImportJobStatus.APPLYING) {
      return;
    }
    const leaseToken = refreshedWorker?.lease_token ?? params.worker.lease_token;
    await this.jobStore.updateWorkerProgress(
      params.tenantId,
      params.jobId,
      leaseToken,
      {
        last_committed_row_no: lastCommitted,
        processed_rows: lastCommitted,
        lease_until: new Date(0).toISOString(),
      },
    );
    await enqueueOrRunImportWorker({
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'apply',
      cloudTasks: this.cloudTasks,
      targetBaseUrl: resolveImportWorkerTargetBaseUrl(),
      nodeEnv: process.env.NODE_ENV,
      runInline: () =>
        this.runImportWorkerAttempt({
          tenantId: params.tenantId,
          jobId: params.jobId,
          phase: 'apply',
        }),
    });
  }
}
