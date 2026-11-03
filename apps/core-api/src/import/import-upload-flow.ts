import { randomUUID as cryptoRandomUuid } from 'node:crypto';
import { Readable } from 'node:stream';
import { ImportEntityType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import type {
  ImportJobView,
  SerializedImportJob,
} from './import-job.serializer.js';
import type {
  CreateDryRunJobInput,
  ImportJobStore,
} from './import-job.store.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import { normalizeImportOptions } from './import-options.util.js';
import { traceImportParse, traceImportValidate } from './import-trace.js';
import { assertImplementedImportEntityType } from './import-entity-type.guard.js';
import type { ImplementedImportEntityType } from './import-entity-type.registry.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import {
  assessImportUpload,
  openImportMulterStagingReadStream,
  type ImportUploadStats,
  unlinkImportMulterStagingFile,
} from './import-upload.util.js';
import { getImportStagingKey } from './import-staging-path.js';
import { pipeImportCsvToStorage } from './import-upload-pipeline.js';
import { rethrowImportStorageFailure } from './import-gcs-retry.js';
import {
  ImportFileStorageService,
  readMulterUploadContent,
  type StoredImportFileRef,
} from './import-file.storage.js';
import { openImportSourceRows } from './import-error-report.source.js';
import type { ImportJobOptions, ImportJobTotals } from './import.types.js';
import { computeDryRunTotals } from './import-totals.util.js';
import { parseMigrationManifestFromDryRunOptions } from './canonical-migration-import/canonical-migration-import.options.js';
import { assertCanonicalMigrationUploadAllowed } from './migration-manifest-upload.guard.js';
import type { ImportWorkerOrchestration } from './import-worker-orchestration.js';

export type ImportUploadFlowDeps = {
  prisma: PrismaService;
  tenantContext: TenantContextService;
  jobStore: ImportJobStore;
  fileStorage: ImportFileStorageService;
  handlers: Record<ImplementedImportEntityType, ImportTypeHandler>;
  audit: ImportAuditWriter;
  serialize: (
    job: ImportJobView,
    totals: ImportJobTotals,
  ) => SerializedImportJob;
  orchestration: ImportWorkerOrchestration;
};

/**
 * Turns an upload (HTTP multipart, staged request, or already-stored object)
 * into an import job: sync dry runs finish inline, large files become
 * background jobs whose first batch the worker runner picks up.
 */
export class ImportUploadFlow {
  constructor(private readonly deps: ImportUploadFlowDeps) {}

  async createDryRunFromUpload(params: {
    uploadRequest?: object;
    file: Express.Multer.File;
    entityType: ImportEntityType;
    sourceSystem: string;
    mappingJson: Record<string, string>;
    optionsJson: ImportJobOptions;
  }) {
    const { tenantContext, prisma, handlers, audit, serialize } = this.deps;
    assertTenantAdmin(tenantContext);
    assertImplementedImportEntityType(params.entityType);
    const tenantId = await tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      prisma,
      tenantContext,
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
    const handler = handlers[params.entityType];
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

    const job = await this.createSyncDryRunJob(
      {
        tenantId,
        jobId: cryptoRandomUuid(),
        entityType: params.entityType,
        sourceSystem: params.sourceSystem,
        fileName: params.file.originalname,
        fileSha256: parsed.sha256,
        mapping: params.mappingJson,
        options,
        totals,
        actorUserId: currentUser.id,
        rows: dryRunRows,
      },
      assessed.content ?? readMulterUploadContent(params.file),
    );
    await audit.writeImportJobAudit(
      prisma,
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
    return serialize(job, jobTotals);
  }

  /**
   * Starts the background dry-run for an object already copied into the job
   * import location, reusing the same job/audit/enqueue path as HTTP uploads.
   */
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
    const { tenantContext, prisma, handlers } = this.deps;
    assertTenantAdmin(tenantContext);
    assertImplementedImportEntityType(params.entityType);
    const tenantId = await tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      prisma,
      tenantContext,
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
    if (migrationManifest) {
      assertCanonicalMigrationUploadAllowed(
        { originalname: params.fileName },
        migrationManifest,
        { sha256: params.fileSha256, dataRowCount: params.rowCount },
      );
    }
    const handler = handlers[params.entityType];
    await handler.prepareCreate(tenantId, params.sourceSystem, options);
    return this.startBackgroundDryRunJob({
      tenantId,
      actorUserId: currentUser.id,
      entityType: params.entityType,
      sourceSystem: params.sourceSystem,
      fileName: params.fileName,
      fileSha256: params.fileSha256,
      mappingJson: params.mappingJson,
      options,
      uploadRef: params.ref,
      expectedRows: params.rowCount,
      jobId: params.jobId,
    });
  }

  private async createSyncDryRunJob(
    input: CreateDryRunJobInput & { jobId: string },
    content: Buffer,
  ) {
    const { fileStorage, jobStore } = this.deps;
    const source = await openImportSourceRows(Readable.from([content]));
    await source.close();
    const upload = await fileStorage.storeUpload({
      tenantId: input.tenantId,
      jobId: input.jobId,
      fileName: input.fileName ?? 'import.csv',
      content,
    });
    try {
      return await jobStore.createDryRunJob({
        ...input,
        options: {
          ...input.options,
          upload: { ...upload, headers: source.headers },
        },
      });
    } catch (error) {
      await fileStorage.deleteUpload(upload).catch(() => undefined);
      throw error;
    }
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
    const { fileStorage } = this.deps;
    const placeholderJobId = cryptoRandomUuid();
    let uploadRef: { object_key: string } | undefined;
    let fileSha256 = params.assessed.sha256;
    let expectedRows = params.assessed.rowCount;
    try {
      if (params.stagingRequest) {
        const piped = await pipeImportCsvToStorage(fileStorage, {
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
        uploadRef = await fileStorage.storeUpload({
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
      return await this.startBackgroundDryRunJob({
        tenantId: params.tenantId,
        actorUserId: params.actorUserId,
        entityType: params.entityType,
        sourceSystem: params.sourceSystem,
        fileName: params.file.originalname,
        fileSha256,
        mappingJson: params.mappingJson,
        options: params.options,
        uploadRef,
        expectedRows,
      });
    } catch (error) {
      if (uploadRef) {
        await fileStorage.deleteUpload(uploadRef).catch(() => undefined);
      }
      if (params.stagingRequest) {
        await unlinkImportMulterStagingFile(params.stagingRequest);
      }
      rethrowImportStorageFailure(error);
    }
  }

  private async startBackgroundDryRunJob(params: {
    tenantId: string;
    actorUserId: string;
    entityType: ImportEntityType;
    sourceSystem: string;
    fileName: string;
    fileSha256: string;
    mappingJson: Record<string, string>;
    options: ImportJobOptions;
    uploadRef: StoredImportFileRef;
    expectedRows: number;
    jobId?: string;
  }) {
    const { jobStore, fileStorage, audit, prisma, serialize, orchestration } =
      this.deps;
    const source = await openImportSourceRows(
      fileStorage.openReadStream(params.uploadRef) as Readable,
    );
    await source.close();
    const job = await jobStore.createPendingBackgroundJob({
      tenantId: params.tenantId,
      entityType: params.entityType,
      sourceSystem: params.sourceSystem,
      fileName: params.fileName,
      fileSha256: params.fileSha256,
      mapping: params.mappingJson,
      options: params.options,
      actorUserId: params.actorUserId,
      upload: { ...params.uploadRef, headers: source.headers },
      expectedRows: params.expectedRows,
      jobId: params.jobId,
    });
    await audit.writeImportJobAudit(
      prisma,
      params.tenantId,
      params.actorUserId,
      job.id,
      'created',
    );
    await orchestration.enqueueInitialWorker(
      params.tenantId,
      job.id,
      'dry_run',
    );
    return serialize(job, job.totals_json as ImportJobTotals);
  }
}
