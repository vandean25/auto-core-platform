import { Injectable } from '@nestjs/common';
import { ImportEntityType, ImportRowAction, Prisma } from '@prisma/client';
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
import { parseImportUpload } from './import-upload.util.js';
import { computeDryRunTotals } from './import-totals.util.js';
import { buildTemplateCsv, getImportTemplate } from './import.templates.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { SupplierPriceListImportHandler } from './supplier-price-list-import.handler.js';
import { LaborOperationImportHandler } from './labor-operation-import.handler.js';
import { VehicleImportHandler } from './vehicle-import.handler.js';

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
  private readonly audit: ImportAuditWriter;
  private readonly jobStore: ImportJobStore;
  private readonly handlers: Record<
    ImplementedImportEntityType,
    ImportTypeHandler
  >;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
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

    const parsed = traceImportParse(params.entityType, () =>
      parseImportUpload(params.file),
    );
    const options = normalizeImportOptions(params.optionsJson);
    const handler =
      this.handlers[params.entityType as ImplementedImportEntityType];
    await handler.prepareCreate(tenantId, params.sourceSystem, options);
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
    const handler =
      this.handlers[job.entity_type as ImplementedImportEntityType];
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
}
