import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  type DisplayLanguage,
} from '../common/i18n/display-language.js';
import { createImportErrorReportStream } from './import-error-report.stream.js';
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
import { assertTenantAdmin } from '../site/site.authorization.js';
import {
  importJobCannotCancel,
  importJobNotFound,
} from './import-job.errors.js';
import {
  serializeImportJob,
  serializeImportJobListItem,
  serializeImportRow,
  type ImportJobView,
  type SerializedImportJob,
} from './import-job.serializer.js';
import { findUndoableJobIds } from './import-undo.helpers.js';
import { ImportJobStore } from './import-job.store.js';
import { ImportAuditWriter } from './import-audit.writer.js';
import { RowByRowApplyRunner } from './import-row-apply.runner.js';
import { assertImplementedImportEntityType } from './import-entity-type.guard.js';
import {
  createImportHandlers,
  getImportTemplate,
  listImportEntityTypes,
  type ImplementedImportEntityType,
} from './import-entity-type.registry.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import type { ImportWorkerFlowDeps } from './import-worker.flow.js';
import type {
  ImportJobOptionsWithWorker,
  ImportWorkerPhase,
} from './import-job.worker-state.js';
import {
  ImportFileStorageService,
  type StoredImportFileRef,
} from './import-file.storage.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { IMPORT_LOGGER_CONTEXT } from './import.constants.js';
import { buildTemplateCsv } from './import.templates.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { ImportWorkerOrchestration } from './import-worker-orchestration.js';
import { ImportApplyDispatcher } from './import-apply-dispatcher.js';
import { ImportUploadFlow } from './import-upload-flow.js';
import { deleteImportJobUpload } from './import-upload-delete.util.js';

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
 * Entry point for CSV imports. The stages live in dedicated collaborators —
 * uploads (ImportUploadFlow), apply dispatching (ImportApplyDispatcher) and the
 * background worker (ImportWorkerOrchestration) — while this class keeps the
 * stable public surface and the job read endpoints. Every method runs the same
 * tenant and role checks as before.
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
  private readonly orchestration: ImportWorkerOrchestration;
  private readonly dispatcher: ImportApplyDispatcher;
  private readonly uploadFlow: ImportUploadFlow;

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
    this.handlers = createImportHandlers({
      prisma,
      audit: this.audit,
      rowRunner,
      supplierRunner,
      decisionHooks,
      decisionLive,
      requestContext,
    });
    this.orchestration = new ImportWorkerOrchestration({
      logger: this.logger,
      prisma,
      systemPrisma,
      requestContext,
      jobStore: this.jobStore,
      fileStorage,
      cloudTasks,
      audit: this.audit,
      handlers: this.handlers,
    });
    this.dispatcher = new ImportApplyDispatcher({
      logger: this.logger,
      prisma,
      tenantContext,
      jobStore: this.jobStore,
      handlers: this.handlers,
      audit: this.audit,
      serialize,
      orchestration: this.orchestration,
    });
    this.uploadFlow = new ImportUploadFlow({
      prisma,
      tenantContext,
      jobStore: this.jobStore,
      fileStorage,
      handlers: this.handlers,
      audit: this.audit,
      serialize,
      orchestration: this.orchestration,
    });
  }

  async createDryRunFromUpload(params: {
    uploadRequest?: object;
    file: Express.Multer.File;
    entityType: ImportEntityType;
    sourceSystem: string;
    mappingJson: Record<string, string>;
    optionsJson: ImportJobOptions;
  }) {
    return this.uploadFlow.createDryRunFromUpload(params);
  }

  async getJob(jobId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    return this.dispatcher.annotateTechnicalErrors(
      tenantId,
      this.serializeJob(job, job.totals_json as ImportJobTotals),
    );
  }

  async listJobs(query: {
    page?: number;
    limit?: number;
    status?: ImportJobStatus;
    entityType?: ImportEntityType;
    source?: string;
  }) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Prisma.ImportJobWhereInput = {
      tenant_id: tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.entityType ? { entity_type: query.entityType } : {}),
      ...(query.source ? { source_system: query.source } : {}),
    };
    const [jobs, total] = await this.jobStore.findJobsPage(where, skip, limit);
    const undoableIds = await findUndoableJobIds(this.prisma, tenantId, jobs);
    return {
      data: jobs.map((job) =>
        serializeImportJobListItem(job, undoableIds.has(job.id)),
      ),
      meta: { total, page, limit },
    };
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

  async downloadErrorRowsCsv(
    jobId: string,
    locale?: DisplayLanguage,
  ): Promise<Readable> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.jobStore.findJob(tenantId, jobId);
    if (!job) {
      throw importJobNotFound();
    }
    const user = locale
      ? null
      : await this.prisma.user.findUnique({
          where: {
            firebaseUid: this.tenantContext.getAuthenticatedUser()!.userId,
          },
          select: { locale: true },
        });
    return createImportErrorReportStream({
      jobStore: this.jobStore,
      storage: this.fileStorage,
      tenantId,
      job,
      locale: locale ?? user?.locale ?? DEFAULT_DISPLAY_LANGUAGE,
    });
  }

  async applyJob(jobId: string, applyOptions?: ImportJobOptions) {
    const outcome = await this.applyJobHttp(jobId, applyOptions);
    return outcome.job;
  }

  async applyJobHttp(
    jobId: string,
    applyOptions?: ImportJobOptions,
  ): Promise<{ httpStatus: 200 | 202; job: SerializedImportJob }> {
    return this.dispatcher.applyJobHttp(jobId, applyOptions);
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
      csv: buildTemplateCsv(template),
    };
  }

  listEntityTypes() {
    assertTenantAdmin(this.tenantContext);
    return listImportEntityTypes();
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

  async createDryRunFromStoredUpload(params: {
    jobId: string;
    ref: StoredImportFileRef;
    fileName: string;
    entityType: ImportEntityType;
    sourceSystem: string;
    mappingJson: Record<string, string>;
    optionsJson: ImportJobOptions;
    fileSha256: string;
    rowCount: number;
  }) {
    return this.uploadFlow.createDryRunFromStoredUpload(params);
  }

  private async deleteJobUploadIfPresent(
    options: ImportJobOptionsWithWorker,
  ): Promise<void> {
    await deleteImportJobUpload(this.fileStorage, options);
  }

  private workerFlowForJob(
    tenantId: string,
    jobId: string,
  ): ImportWorkerFlowDeps {
    return this.orchestration.workerFlowForJob(tenantId, jobId);
  }

  private async enqueueInitialImportWorker(
    tenantId: string,
    jobId: string,
    phase: ImportWorkerPhase,
  ): Promise<void> {
    await this.orchestration.enqueueInitialWorker(tenantId, jobId, phase);
  }

  async runImportWorkerAttempt(params: {
    tenantId: string;
    jobId: string;
    phase: ImportWorkerPhase;
  }): Promise<void> {
    await this.orchestration.runWorkerAttempt(params);
  }

  async recoverStaleImportJobs(): Promise<boolean> {
    return this.orchestration.recoverStaleImportJobs();
  }
}
