import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ImportEntityType } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { assessImportCsvFromReadable } from './import-csv-stream.util.js';
import {
  assertDirectUploadFileName,
  assertDirectUploadId,
  assertDirectUploadSize,
  assertDirectUploadStagingKeyForTenant,
  buildDirectUploadStagingObjectKey,
  importDirectUploadInvalid,
  importDirectUploadNotFound,
  importDirectUploadTooLarge,
  IMPORT_DIRECT_UPLOAD_URL_TTL_MS,
  normalizeDirectUploadContentType,
} from './import-direct-upload.js';
import { ImportDirectUploadStorageService } from './import-direct-upload.storage.js';
import {
  buildGcsImportObjectKey,
  ImportFileStorageService,
} from './import-file.storage.js';
import { readImportDirectUploadMaxFileBytes } from './import-limits.js';
import { assertImportCsvContentUsable } from './import-upload.util.js';
import { ImportService } from './import.service.js';
import type { ImportJobOptions } from './import.types.js';

const IMPORT_DIRECT_UPLOAD_LOGGER = 'ImportDirectUploadService';

export type StartedDirectImportUpload = {
  upload_id: string;
  upload_url: string;
  method: 'POST';
  headers: Record<string, string>;
  content_type: string;
  max_bytes: number;
  expires_at: string;
};

@Injectable()
export class ImportDirectUploadService {
  private readonly logger = new Logger(IMPORT_DIRECT_UPLOAD_LOGGER);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly directStorage: ImportDirectUploadStorageService,
    private readonly fileStorage: ImportFileStorageService,
    private readonly importService: ImportService,
  ) {}

  /** Issues a tenant-scoped staging key and a short-lived resumable session URL. */
  async start(params: {
    fileName: string;
    size: number;
    contentType?: string;
  }): Promise<StartedDirectImportUpload> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const fileName = assertDirectUploadFileName(params.fileName);
    const maxBytes = readImportDirectUploadMaxFileBytes();
    const declaredBytes = assertDirectUploadSize(params.size, maxBytes);
    const contentType = normalizeDirectUploadContentType(params.contentType);
    const uploadId = randomUUID();
    const objectKey = buildDirectUploadStagingObjectKey({
      tenantId,
      uploadId,
      fileName,
    });
    const expiresAt = new Date(Date.now() + IMPORT_DIRECT_UPLOAD_URL_TTL_MS);
    const { signedUrl } = await this.directStorage.signResumableUpload({
      objectKey,
      contentType,
      maxBytes: declaredBytes,
      expiresAt,
    });

    return {
      upload_id: uploadId,
      upload_url: signedUrl,
      method: 'POST',
      headers: {
        'x-goog-resumable': 'start',
        'Content-Type': contentType,
        'x-goog-content-length-range': `0,${declaredBytes}`,
      },
      content_type: contentType,
      max_bytes: declaredBytes,
      expires_at: expiresAt.toISOString(),
    };
  }

  /**
   * Verifies the staged object belongs to the caller's tenant and fits the
   * caps, then promotes it to the normal job location and starts the dry-run.
   */
  async finalize(params: {
    uploadId: string;
    fileName: string;
    size: number;
    entityType: ImportEntityType;
    sourceSystem: string;
    mapping: Record<string, string>;
    options?: ImportJobOptions;
  }) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const uploadId = assertDirectUploadId(params.uploadId);
    const fileName = assertDirectUploadFileName(params.fileName);
    const maxBytes = readImportDirectUploadMaxFileBytes();
    const declaredBytes = assertDirectUploadSize(params.size, maxBytes);
    const stagingKey = buildDirectUploadStagingObjectKey({
      tenantId,
      uploadId,
      fileName,
    });
    assertDirectUploadStagingKeyForTenant(stagingKey, tenantId);

    const staged = await this.directStorage.statStagingObject(stagingKey);
    if (!staged) {
      throw importDirectUploadNotFound();
    }
    if (!Number.isFinite(staged.size) || staged.size <= 0) {
      throw importDirectUploadInvalid();
    }
    if (staged.size > maxBytes || staged.size > declaredBytes) {
      throw importDirectUploadTooLarge();
    }

    const jobId = randomUUID();
    const destinationKey = buildGcsImportObjectKey({
      tenantId,
      jobId,
      fileName,
    });
    await this.directStorage.copyStagingToJobObject({
      sourceKey: stagingKey,
      destinationKey,
    });
    await this.deleteStaging(stagingKey);

    const ref = { object_key: destinationKey };
    try {
      const assessed = await assessImportCsvFromReadable(
        this.fileStorage.openReadStream(ref),
      );
      assertImportCsvContentUsable(assessed.headers, assessed.dataRowCount);
      return await this.importService.createDryRunFromStoredUpload({
        jobId,
        ref,
        fileName,
        entityType: params.entityType,
        sourceSystem: params.sourceSystem,
        mappingJson: params.mapping,
        optionsJson: params.options ?? {},
        fileSha256: assessed.sha256,
        rowCount: assessed.dataRowCount,
      });
    } catch (error) {
      await this.fileStorage.deleteUpload(ref).catch(() => undefined);
      throw error;
    }
  }

  private async deleteStaging(stagingKey: string): Promise<void> {
    try {
      await this.directStorage.deleteStagingObject(stagingKey);
    } catch (error) {
      this.logger.warn(
        `Direct import staging object could not be deleted: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
