import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { randomUUID as cryptoRandomUuid } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
import { assessImportUpload } from './import-upload.util.js';
import { sliceParsedCsv } from './import-csv-batch.util.js';
import { parseCsvFile } from './csv-parse.util.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import { enqueueOrRunImportWorker } from './import-dispatch.js';
import {
  ImportFileStorageService,
  persistMulterUploadToTemp,
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

    const assessed = assessImportUpload(params.file);
    const handler = this.handlers[params.entityType];
    await handler.prepareCreate(tenantId, params.sourceSystem, options);

    if (assessed.useBackground) {
      const { localPath, cleanup } = await persistMulterUploadToTemp(
        params.file,
      );
      try {
        const fileBuffer = await readFile(localPath);
        const headerParsed = parseCsvFile(fileBuffer);
        const placeholderJobId = cryptoRandomUuid();
        const upload = await this.fileStorage.storeUpload({
          tenantId,
          jobId: placeholderJobId,
          fileName: params.file.originalname,
          localPath,
        });
        const job = await this.jobStore.createPendingBackgroundJob({
          tenantId,
          entityType: params.entityType,
          sourceSystem: params.sourceSystem,
          fileName: params.file.originalname,
          fileSha256: headerParsed.sha256,
          mapping: params.mappingJson,
          options,
          actorUserId: currentUser.id,
          upload,
          expectedRows: headerParsed.rows.length,
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
          targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL,
          nodeEnv: process.env.NODE_ENV,
          runInline: () =>
            this.runImportWorkerAttempt({
              tenantId,
              jobId: job.id,
              phase: 'dry_run',
            }),
        });
        return this.serializeJob(job, job.totals_json as ImportJobTotals);
      } finally {
        await cleanup();
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
        targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL,
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
    const result = await this.jobStore.cancelJob(tenantId, jobId);
    if (result.count === 0) {
      throw importJobNotFound();
    }
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    return this.serializeJob(job, job.totals_json as ImportJobTotals);
  }

  async runImportWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: 'dry_run' | 'apply';
  }): Promise<void> {
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
    const bytes = await this.fileStorage.readBytes(upload);
    const parsedFull = parseCsvFile(bytes);
    const startOffset = worker.processed_rows;
    const batchRows = parsedFull.rows.slice(
      startOffset,
      startOffset + IMPORT_WORKER_BATCH_SIZE,
    );
    if (batchRows.length === 0) {
      await this.completeBackgroundDryRun(tenantId, jobId, handler, options);
      return;
    }

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
        const parsedBatch = sliceParsedCsv(parsedFull, startOffset, batchRows);
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
        mergedTotals.rows = parsedFull.rows.length;
        await this.jobStore.appendDryRunRows(
          tenantId,
          jobId,
          rows,
          mergedTotals,
          {
            processed_rows: processed,
            lease_until: new Date(Date.now() + 120_000).toISOString(),
          },
          options,
        );
        if (processed >= parsedFull.rows.length) {
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
          targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL,
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
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: ImportJobStatus.DRY_RUN_DONE,
        totals_json: finalTotals,
        options_json: optionsForPersist,
      },
    });
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
    const rows = await this.jobStore.findApplyRows(tenantId, jobId);
    assertImplementedImportEntityType(job.entity_type);
    const handler = this.handlers[job.entity_type];
    const effectiveOptions = (job.options_json as ImportJobOptions) ?? {};
    const preparation = await handler.prepareApply({
      tenantId,
      job,
      rows,
      effectiveOptions,
    });
    return {
      job,
      worker,
      rows,
      handler,
      effectiveOptions,
      preparation,
      resumeAfter: worker.last_committed_row_no ?? 0,
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
    const pending = params.rows.filter(
      (row) => row.row_no > params.resumeAfter,
    );
    const batchRows = pending.slice(0, IMPORT_APPLY_BATCH_SIZE);
    const lastCommitted = batchRows.at(-1)?.row_no ?? params.resumeAfter;
    const lastRowNo = params.rows.at(-1)?.row_no ?? lastCommitted;
    const done = lastCommitted >= lastRowNo;
    if (done || params.resultStatus !== ImportJobStatus.APPLYING) {
      return;
    }
    await this.jobStore.updateWorkerProgress(
      params.tenantId,
      params.jobId,
      params.worker.lease_token,
      {
        last_committed_row_no: lastCommitted,
        processed_rows: params.rows.filter((row) => row.row_no <= lastCommitted)
          .length,
        lease_until: new Date(Date.now() + 120_000).toISOString(),
      },
    );
    await enqueueOrRunImportWorker({
      tenantId: params.tenantId,
      jobId: params.jobId,
      phase: 'apply',
      cloudTasks: this.cloudTasks,
      targetBaseUrl: process.env.CLOUD_TASKS_TARGET_BASE_URL,
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
